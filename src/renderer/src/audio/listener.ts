import { Segmenter } from './segmenter'

export type Speaker = 'them' | 'me'
export type Line = { id: number; speaker: Speaker; text: string; at: number; pending?: boolean }

type Events = {
  onLine: (line: Line) => void
  onStatus: (status: string) => void
}

/**
 * Captures call audio (system loopback = the other side, microphone = you),
 * cuts it into phrases and transcribes them locally with Whisper.
 */
export class Listener {
  private worker?: Worker
  private ready?: Promise<void>
  private segmenters: Segmenter[] = []
  private streams: MediaStream[] = []
  private nextId = 1
  private pending = new Map<number, Line>()

  constructor(private ev: Events) {}

  private loadModel(model: string): Promise<void> {
    if (this.ready) return this.ready
    const worker = (this.worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' }))
    this.ready = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data
        if (m.type === 'progress' && m.progress != null) this.ev.onStatus(`Загружаю Whisper: ${Math.round(m.progress)}%`)
        else if (m.type === 'ready') {
          this.ev.onStatus(`Whisper готов (${m.device})`)
          resolve()
        } else if (m.type === 'result') {
          const line = this.pending.get(m.id)
          this.pending.delete(m.id)
          if (line) this.ev.onLine({ ...line, text: m.text, pending: false })
        } else if (m.type === 'error') {
          if (m.id != null) {
            const line = this.pending.get(m.id)
            this.pending.delete(m.id)
            if (line) this.ev.onLine({ ...line, text: '', pending: false })
          } else reject(new Error(m.message))
          this.ev.onStatus(`Ошибка Whisper: ${m.message}`)
        }
      }
    })
    worker.postMessage({ type: 'init', model, ortBase: new URL('ort/', document.baseURI).href })
    return this.ready
  }

  async start(opts: { engine: 'qwen' | 'whisper'; model: string; language: string; mic: boolean; system: boolean }) {
    this.ev.onStatus('Запускаю…')
    let transcribe: (id: number, audio: Float32Array) => void
    if (opts.engine === 'qwen') {
      const off = window.ghost.onAsrStatus(this.ev.onStatus)
      try {
        await window.ghost.asrStart(opts.model)
      } finally {
        off()
      }
      transcribe = (id, audio) =>
        window.ghost
          .asrTranscribe(audio, opts.language)
          .then((text) => this.resolve(id, cleanTranscript(text)))
          .catch((e) => {
            this.resolve(id, '')
            this.ev.onStatus(`Ошибка Qwen3-ASR: ${e instanceof Error ? e.message : e}`)
          })
    } else {
      await this.loadModel(opts.model)
      transcribe = (id, audio) => this.worker!.postMessage({ type: 'run', id, audio, language: opts.language }, [audio.buffer])
    }

    const add = (stream: MediaStream, speaker: Speaker) => {
      this.streams.push(stream)
      this.segmenters.push(
        new Segmenter(stream, (audio) => {
          const line: Line = { id: this.nextId++, speaker, text: '…', at: Date.now(), pending: true }
          this.pending.set(line.id, line)
          this.ev.onLine(line)
          transcribe(line.id, audio)
        })
      )
    }

    if (opts.system) {
      const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      display.getVideoTracks().forEach((t) => t.stop())
      if (display.getAudioTracks().length === 0) throw new Error('Системный звук недоступен. Нужен macOS 13+ и разрешение «Запись экрана и системного звука».')
      add(new MediaStream(display.getAudioTracks()), 'them')
    }
    if (opts.mic) {
      await window.ghost.askMic()
      add(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }), 'me')
    }
    this.ev.onStatus('Слушаю')
  }

  private resolve(id: number, text: string) {
    const line = this.pending.get(id)
    this.pending.delete(id)
    if (line) this.ev.onLine({ ...line, text, pending: false })
  }

  stop() {
    this.segmenters.forEach((s) => s.stop())
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    this.segmenters = []
    this.streams = []
    this.ev.onStatus('Остановлено')
  }

  get listening() {
    return this.streams.length > 0
  }
}

// Speech models like to "hear" these in silence, especially in Russian.
const HALLUCINATIONS = [/субтитр/i, /продолжение следует/i, /спасибо за просмотр/i, /подписывайтесь/i, /^\s*[.…!?\s]*$/, /thank you for watching/i]

function cleanTranscript(text: string): string {
  const t = text.trim()
  return HALLUCINATIONS.some((re) => re.test(t)) ? '' : t
}
