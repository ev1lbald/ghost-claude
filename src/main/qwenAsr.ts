import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type Status = (text: string) => void

/**
 * Runs asr/server.py (Qwen3-ASR on MLX) as a child process and talks to it
 * over localhost HTTP. One server per model; restarted when the model changes.
 */
export class QwenAsr {
  private proc?: ChildProcess
  private model?: string
  private port?: number
  private starting?: Promise<void>
  private readonly token = randomBytes(16).toString('hex')

  constructor(private pythonOverride: () => string) {}

  private python(): string {
    const custom = this.pythonOverride()
    if (custom) return custom
    const venv = join(app.getAppPath(), 'asr/.venv/bin/python')
    if (existsSync(venv)) return venv
    throw new Error('Qwen3-ASR не установлен. В папке проекта выполните: npm run setup:asr')
  }

  start(model: string, onStatus: Status): Promise<void> {
    if (this.model === model && this.starting) return this.starting
    this.stop()
    this.model = model
    this.starting = new Promise<void>((resolve, reject) => {
      let python: string
      try {
        python = this.python()
      } catch (e) {
        this.starting = undefined
        return reject(e)
      }
      const proc = (this.proc = spawn(python, [join(app.getAppPath(), 'asr/server.py')], {
        env: { ...process.env, GHOST_ASR_MODEL: model, GHOST_ASR_TOKEN: this.token, PYTHONUNBUFFERED: '1' }
      }))
      let stderrTail = ''
      onStatus(`Загружаю ${model.split('/').pop()}…`)
      proc.stdout!.on('data', (d: Buffer) => {
        const m = /READY (\d+)/.exec(String(d))
        if (m) {
          this.port = Number(m[1])
          onStatus('Qwen3-ASR готов')
          resolve()
        }
      })
      proc.stderr!.on('data', (d: Buffer) => {
        const s = String(d)
        stderrTail = (stderrTail + s).slice(-2000)
        // huggingface_hub download progress, e.g. " 45%|████"
        const pct = /(\d{1,3})%\|/.exec(s)
        if (pct) onStatus(`Скачиваю модель: ${pct[1]}%`)
      })
      proc.on('exit', (code) => {
        if (this.proc === proc) {
          this.proc = this.port = this.starting = this.model = undefined
        }
        reject(new Error(`Qwen3-ASR завершился (код ${code}): ${stderrTail.trim().split('\n').pop() ?? ''}`))
      })
    })
    return this.starting
  }

  async transcribe(audio: Float32Array, language: string, context = ''): Promise<string> {
    if (!this.port) throw new Error('Qwen3-ASR не запущен')
    const q = new URLSearchParams({ language, context })
    const res = await fetch(`http://127.0.0.1:${this.port}/transcribe?${q}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(audio.buffer as ArrayBuffer, audio.byteOffset, audio.byteLength)
    })
    const json = (await res.json()) as { text?: string; error?: string }
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json.text ?? ''
  }

  stop() {
    this.proc?.kill()
    this.proc = this.port = this.starting = this.model = undefined
  }
}
