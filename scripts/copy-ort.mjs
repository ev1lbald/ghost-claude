// Copies the onnxruntime-web runtime next to the renderer so Whisper works
// offline and does not depend on a CDN.
import { cpSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const src = 'node_modules/onnxruntime-web/dist'
const dest = 'src/renderer/public/ort'
mkdirSync(dest, { recursive: true })
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  cpSync(join(src, f), join(dest, f))
}
