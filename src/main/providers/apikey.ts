import Anthropic from '@anthropic-ai/sdk'
import type { AskRequest, ClaudeProvider, ProviderStatus, StreamCallbacks } from './types'

type Turn = Anthropic.MessageParam

/** Fallback: a Claude Console API key, billed per token. */
export class ApiKeyProvider implements ClaudeProvider {
  private history: Turn[] = []
  private client: Anthropic

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  reset(): void {
    this.history = []
  }

  async ask(req: AskRequest, cb: StreamCallbacks, signal: AbortSignal): Promise<void> {
    const started = Date.now()
    let ttftMs: number | undefined
    const user: Turn = {
      role: 'user',
      content: [
        ...req.images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 }
        })),
        { type: 'text' as const, text: req.text || 'Посмотри на экран и помоги.' }
      ]
    }
    let answer = ''
    try {
      const stream = this.client.messages.stream(
        { model: req.model, max_tokens: 4096, system: req.systemPrompt, messages: [...this.history, user] },
        { signal }
      )
      stream.on('text', (t) => {
        ttftMs ??= Date.now() - started
        answer += t
        cb.onDelta(t)
      })
      await stream.finalMessage()
      // Keep only text in history: re-sending old screenshots is what eats tokens.
      this.history.push({ role: 'user', content: req.text || '(скриншот)' }, { role: 'assistant', content: answer })
      cb.onDone({ ttftMs, totalMs: Date.now() - started })
    } catch (e) {
      if (signal.aborted) return cb.onDone({ ttftMs, totalMs: Date.now() - started })
      cb.onError(e instanceof Error ? e.message : String(e))
    }
  }

  async status(): Promise<ProviderStatus> {
    try {
      await this.client.models.list({ limit: 1 })
      return { ok: true, detail: 'API-ключ работает' }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  }
}
