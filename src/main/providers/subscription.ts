import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AskRequest, ClaudeProvider, ProviderStatus, StreamCallbacks } from './types'

/**
 * Talks to Claude through the official Agent SDK, which runs Claude Code and
 * uses the login from `claude login`. The app never reads or stores the
 * OAuth token itself: that is what keeps this inside Anthropic's rules.
 */
export class SubscriptionProvider implements ClaudeProvider {
  private sessionId: string | undefined

  constructor(private claudePath?: string) {}

  reset(): void {
    this.sessionId = undefined
  }

  async ask(req: AskRequest, cb: StreamCallbacks, signal: AbortSignal): Promise<void> {
    const started = Date.now()
    let ttftMs: number | undefined
    const abortController = new AbortController()
    signal.addEventListener('abort', () => abortController.abort())

    const content = [
      ...req.images.map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 }
      })),
      { type: 'text' as const, text: req.text || 'Посмотри на экран и помоги.' }
    ]

    async function* prompt(): AsyncIterable<SDKUserMessage> {
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
    }

    try {
      const q = query({
        prompt: prompt(),
        options: {
          model: req.model,
          systemPrompt: req.systemPrompt,
          // Plain Q&A: no file/bash tools and no agent loop, so it is fast and
          // does not burn subscription limits on tool turns.
          tools: [],
          maxTurns: 1,
          settingSources: [],
          includePartialMessages: true,
          resume: this.sessionId,
          abortController,
          env: subscriptionEnv(),
          pathToClaudeCodeExecutable: this.claudePath || undefined
        }
      })
      for await (const msg of q) {
        if (msg.type === 'stream_event') {
          const ev = msg.event
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            ttftMs ??= Date.now() - started
            cb.onDelta(ev.delta.text)
          }
        } else if (msg.type === 'result') {
          this.sessionId = msg.session_id
          if (msg.subtype !== 'success') cb.onError(`Claude завершил с ошибкой: ${msg.subtype}`)
        }
      }
      cb.onDone({ ttftMs, totalMs: Date.now() - started })
    } catch (e) {
      if (signal.aborted) return cb.onDone({ ttftMs, totalMs: Date.now() - started })
      cb.onError(e instanceof Error ? e.message : String(e))
    }
  }

  async status(): Promise<ProviderStatus> {
    // Open an idle session just to ask who we're logged in as; no message is sent.
    let release!: () => void
    const idle = new Promise<void>((r) => (release = r))
    async function* never(): AsyncIterable<SDKUserMessage> {
      await idle
    }
    const q = query({
      prompt: never(),
      options: { tools: [], settingSources: [], env: subscriptionEnv(), pathToClaudeCodeExecutable: this.claudePath || undefined }
    })
    try {
      const info = await q.accountInfo()
      if (info.apiKeySource) return { ok: false, detail: `Используется API-ключ (${info.apiKeySource}), а не подписка` }
      if (!/pro|max|team|enterprise/i.test(info.subscriptionType ?? '')) {
        return { ok: false, detail: `Вход не через подписку (${info.subscriptionType ?? 'нет входа'}). В терминале: claude, затем /login` }
      }
      return { ok: true, detail: `${info.email ?? 'аккаунт'} · ${info.subscriptionType ?? 'подписка'}` }
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    } finally {
      release()
      q.close()
    }
  }
}

/** Inherit the environment, minus any API key that would override the subscription login. */
function subscriptionEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'ghost-claude/0.1.0' }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}
