/** Minimal renderer: fenced code blocks get their own box, the rest is plain text. */
export function Answer({ text }: { text: string }) {
  const parts = text.split(/```/)
  return (
    <div className="answer">
      {parts.map((part, i) => {
        if (i % 2 === 0) return <p key={i}>{part}</p>
        const nl = part.indexOf('\n')
        const code = nl === -1 ? part : part.slice(nl + 1)
        return (
          <pre key={i} onClick={() => navigator.clipboard.writeText(code)} title="Нажмите, чтобы скопировать">
            <code>{code}</code>
          </pre>
        )
      })}
    </div>
  )
}
