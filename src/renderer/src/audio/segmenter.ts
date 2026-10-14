const RATE = 16000

/**
 * Turns a live MediaStream into speech segments (16 kHz mono Float32) using a
 * simple energy gate: a segment ends after ~0.7 s of quiet or at 15 s.
 */
export class Segmenter {
  private ctx: AudioContext
  private node: ScriptProcessorNode
  private source: MediaStreamAudioSourceNode
  private buf: Float32Array[] = []
  private len = 0
  private voiced = 0
  private silent = 0

  constructor(
    stream: MediaStream,
    private onSegment: (audio: Float32Array) => void,
    private threshold = 0.008
  ) {
    this.ctx = new AudioContext({ sampleRate: RATE })
    this.source = this.ctx.createMediaStreamSource(stream)
    this.node = this.ctx.createScriptProcessor(4096, 1, 1)
    this.node.onaudioprocess = (e) => this.push(e.inputBuffer.getChannelData(0))
    this.source.connect(this.node)
    // A ScriptProcessor only runs when connected; route it to a muted gain.
    const mute = this.ctx.createGain()
    mute.gain.value = 0
    this.node.connect(mute).connect(this.ctx.destination)
  }

  private push(chunk: Float32Array) {
    let sum = 0
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
    const loud = Math.sqrt(sum / chunk.length) > this.threshold

    if (loud) {
      this.voiced += chunk.length
      this.silent = 0
    } else if (this.len > 0) {
      this.silent += chunk.length
    }
    if (loud || this.len > 0) {
      this.buf.push(new Float32Array(chunk))
      this.len += chunk.length
    }
    if (this.len > 0 && (this.silent > RATE * 0.7 || this.len > RATE * 15)) this.flush()
  }

  flush() {
    if (this.voiced > RATE * 0.4) {
      const out = new Float32Array(this.len)
      let off = 0
      for (const b of this.buf) {
        out.set(b, off)
        off += b.length
      }
      this.onSegment(out)
    }
    this.buf = []
    this.len = this.voiced = this.silent = 0
  }

  stop() {
    this.flush()
    this.node.disconnect()
    this.source.disconnect()
    void this.ctx.close()
  }
}
