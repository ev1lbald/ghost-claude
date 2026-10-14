import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

type InitMsg = { type: 'init'; model: string; ortBase: string }
type RunMsg = { type: 'run'; id: number; audio: Float32Array; language: string }

let asr: AutomaticSpeechRecognitionPipeline | undefined

// Whisper loves to "hear" these in silence, especially in Russian.
const HALLUCINATIONS = [/субтитр/i, /продолжение следует/i, /редактор субтитров/i, /спасибо за просмотр/i, /подписывайтесь/i, /^\s*[.…!?\s]*$/, /thank you for watching/i, /^\s*\[.*\]\s*$/]

self.onmessage = async (e: MessageEvent<InitMsg | RunMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      env.allowLocalModels = false
      env.useWasmCache = false
      const onnx = env.backends.onnx as { wasm: { wasmPaths: unknown } }
      onnx.wasm.wasmPaths = {
        mjs: msg.ortBase + 'ort-wasm-simd-threaded.asyncify.mjs',
        wasm: msg.ortBase + 'ort-wasm-simd-threaded.asyncify.wasm'
      }
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
      const adapter = gpu ? await gpu.requestAdapter() : null
      const hasGpu = !!adapter
      const f16 = !!adapter?.features.has('shader-f16')
      const progress = (p: { status: string; file?: string; progress?: number }) => {
        if (p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, progress: p.progress })
      }
      asr = (await pipeline('automatic-speech-recognition', msg.model, {
        device: hasGpu ? 'webgpu' : 'wasm',
        dtype: hasGpu ? { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } : 'q8',
        progress_callback: progress
      })) as AutomaticSpeechRecognitionPipeline
      self.postMessage({ type: 'ready', device: hasGpu ? 'webgpu' : 'wasm' })
    } else if (msg.type === 'run') {
      if (!asr) throw new Error('Whisper ещё не загружен')
      const out = await asr(msg.audio, {
        language: msg.language === 'auto' ? undefined : msg.language,
        task: 'transcribe'
      })
      const text = (Array.isArray(out) ? out[0].text : out.text).trim()
      const clean = HALLUCINATIONS.some((re) => re.test(text)) ? '' : text
      self.postMessage({ type: 'result', id: msg.id, text: clean })
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: 'id' in msg ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) })
  }
}
