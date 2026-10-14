export type ImageInput = { mediaType: 'image/jpeg' | 'image/png'; base64: string }

export type AskRequest = {
  text: string
  images: ImageInput[]
  model: string
  systemPrompt: string
}

export type StreamCallbacks = {
  onDelta: (text: string) => void
  onDone: (info: { ttftMs?: number; totalMs: number }) => void
  onError: (message: string) => void
}

export type ProviderStatus = { ok: boolean; detail: string }

export interface ClaudeProvider {
  ask(req: AskRequest, cb: StreamCallbacks, signal: AbortSignal): Promise<void>
  /** Forget the conversation so the next ask starts fresh. */
  reset(): void
  status(): Promise<ProviderStatus>
}
