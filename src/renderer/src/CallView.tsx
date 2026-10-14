import { useEffect, useRef } from 'react'
import type { Line } from './audio/listener'

export function CallView({
  lines,
  status,
  listening,
  onToggle,
  onSuggest,
  onSendTranscript,
  onClear
}: {
  lines: Line[]
  status: string
  listening: boolean
  onToggle: () => void
  onSuggest: () => void
  onSendTranscript: () => void
  onClear: () => void
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  const visible = lines.filter((l) => l.pending || l.text)
  return (
    <main className="call">
      <div className="call-bar">
        <button className={listening ? 'rec' : ''} onClick={onToggle}>
          {listening ? '■ Стоп' : '● Слушать'}
        </button>
        <button onClick={onSuggest} disabled={!visible.length} title="⌘⇧A">
          💬 Что ответить
        </button>
        <button onClick={onSendTranscript} disabled={!visible.length} title="Отправить новые фразы в чат как вопрос (⌘⇧T)">
          ↗ В чат
        </button>
        <button onClick={onClear} title="Очистить расшифровку">
          ⌫
        </button>
        <span className="meta">{status}</span>
      </div>
      {visible.length === 0 && (
        <div className="hint">
          Нажмите «Слушать»: звук созвона расшифровывается прямо на Mac, никуда не отправляясь. Затем <b>⌘⇧T</b> («В чат»), чтобы Claude ответил на вопрос из расшифровки, или <b>⌘⇧A</b>
          («Что ответить»), чтобы он подсказал, что сказать собеседнику.
          <br />
          Распознаёт Qwen3-ASR. Один раз установите его командой <code>npm run setup:asr</code> в папке проекта.
        </div>
      )}
      {visible.map((l) => (
        <div key={l.id} className={`line ${l.speaker}`}>
          <span className="who">{l.speaker === 'them' ? 'Собеседник' : 'Я'}</span>
          <span className={l.pending ? 'meta' : ''}>{l.text}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </main>
  )
}

/** Last few minutes of the call, as plain text for the prompt. */
export function transcriptForPrompt(lines: Line[], minutes = 4): string {
  const since = Date.now() - minutes * 60_000
  return lines
    .filter((l) => !l.pending && l.text && l.at >= since)
    .map((l) => `${l.speaker === 'them' ? 'Собеседник' : 'Я'}: ${l.text}`)
    .join('\n')
}
