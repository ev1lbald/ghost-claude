import type { publicSettings } from '../../main/settings'
import { useEffect, useRef, useState } from 'react'
import { Answer } from './Answer'
import { Listener, type Line } from './audio/listener'
import { CallView, transcriptForPrompt } from './CallView'

type Turn = { q: string; label?: string; screenshot: boolean; a: string; error?: string; meta?: string; done: boolean }
type PublicSettings = ReturnType<typeof publicSettings>

const MODELS = [
  { id: 'claude-haiku-5-5', name: 'Haiku' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet' },
  { id: 'claude-opus-5-5', name: 'Opus' }
]

export function App() {
  const g = window.ghost
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [settings, setSettings] = useState<PublicSettings>()
  const [status, setStatus] = useState<{ ok: boolean; detail: string }>()
  const [showSettings, setShowSettings] = useState(false)
  const [tab, setTab] = useState<'chat' | 'call'>('chat')
  const [lines, setLines] = useState<Line[]>([])
  const [audioStatus, setAudioStatus] = useState('')
  const [listening, setListening] = useState(false)
  const linesRef = useRef<Line[]>([])
  linesRef.current = lines
  const listener = useRef<Listener | null>(null)
  listener.current ??= new Listener({
    onLine: (line) => setLines((ls) => (ls.some((l) => l.id === line.id) ? ls.map((l) => (l.id === line.id ? line : l)) : [...ls, line])),
    onStatus: setAudioStatus
  })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const patchLast = (fn: (t: Turn) => Turn) => setTurns((ts) => (ts.length ? [...ts.slice(0, -1), fn(ts[ts.length - 1])] : ts))

  useEffect(() => {
    g.getSettings().then(setSettings)
    g.status().then(setStatus)
    const offs = [
      g.onStart(({ text, withScreenshot, label }) => setTurns((ts) => [...ts, { q: text, label, screenshot: withScreenshot, a: '', done: false }])),
      g.onDelta((t: string) => patchLast((x) => ({ ...x, a: x.a + t }))),
      g.onDone((info) =>
        patchLast((x) => ({ ...x, done: true, meta: `${info.ttftMs ? `первый токен ${info.ttftMs} мс · ` : ''}${(info.totalMs / 1000).toFixed(1)} с` }))
      ),
      g.onError((m: string) =>
        setTurns((ts) => {
          const last = ts[ts.length - 1]
          if (last && !last.done) return [...ts.slice(0, -1), { ...last, error: m, done: true }]
          return [...ts, { q: '', screenshot: false, a: '', error: m, done: true }]
        })
      ),
      g.onReset(() => setTurns([])),
      g.onFocusInput(() => inputRef.current?.focus()),
      g.onSuggest(() => suggestRef.current()),
      g.onSendTranscript(() => sendTranscriptRef.current())
    ]
    return () => offs.forEach((off) => off())
  }, [])

  useEffect(() => {
    // Braces matter: newer Chromium returns a Promise here, which React would treat as a cleanup.
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turns])

  const suggest = () => {
    const transcript = transcriptForPrompt(linesRef.current)
    if (!transcript) return setAudioStatus('Пока нечего отвечать: расшифровка пустая')
    setTab('chat')
    setShowSettings(false)
    g.ask(`Расшифровка созвона за последние минуты:\n\n${transcript}\n\nЧто мне ответить на последний вопрос или реплику собеседника?`, false, 'meeting')
  }
  const suggestRef = useRef(suggest)
  suggestRef.current = suggest

  // Sends only what was said since the previous send, so repeated presses
  // don't re-ask about old phrases.
  const lastSentId = useRef(0)
  const sendTranscript = () => {
    const fresh = linesRef.current.filter((l) => l.id > lastSentId.current && !l.pending && l.text)
    if (!fresh.length) return setAudioStatus('Нет новых фраз для отправки')
    lastSentId.current = fresh[fresh.length - 1].id
    const transcript = fresh.map((l) => `${l.speaker === 'them' ? 'Собеседник' : 'Я'}: ${l.text}`).join('\n')
    setTab('chat')
    setShowSettings(false)
    g.ask(`Фрагмент расшифровки созвона:\n\n${transcript}\n\nОтветь на вопрос или задачу из этого фрагмента.`, false, undefined, `🎧 ${fresh.map((l) => l.text).join(' ')}`)
  }
  const sendTranscriptRef = useRef(sendTranscript)
  sendTranscriptRef.current = sendTranscript

  const toggleListening = async () => {
    const l = listener.current!
    if (l.listening) {
      l.stop()
      return setListening(false)
    }
    try {
      setListening(true)
      await l.start({ model: settings!.whisperModel, language: settings!.language, mic: settings!.micEnabled, system: true })
    } catch (e) {
      l.stop()
      setListening(false)
      setAudioStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const busy = turns.length > 0 && !turns[turns.length - 1].done
  const submit = (withScreenshot: boolean) => {
    if (!input.trim() && !withScreenshot) return
    g.ask(input.trim(), withScreenshot)
    setInput('')
  }
  const update = async (patch: Record<string, unknown>) => {
    setSettings(await g.setSettings(patch))
    if ('mode' in patch || 'apiKey' in patch || 'claudePath' in patch) g.status().then(setStatus)
  }

  if (!settings) return null
  return (
    <div className="shell" style={{ ['--alpha' as string]: settings.opacity }}>
      <header className="drag">
        <span className={`dot ${status?.ok ? 'ok' : 'bad'}`} title={status?.detail ?? 'Проверяю…'} />
        <div className="tabs nodrag">
          <button className={tab === 'chat' ? 'on' : ''} onClick={() => (setTab('chat'), setShowSettings(false))}>
            Чат
          </button>
          <button className={tab === 'call' ? 'on' : ''} onClick={() => (setTab('call'), setShowSettings(false))}>
            {listening ? '🔴 ' : ''}Созвон
          </button>
        </div>
        <select className="nodrag" value={settings.profileId} onChange={(e) => update({ profileId: e.target.value })}>
          {settings.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="nodrag" value={settings.model} onChange={(e) => update({ model: e.target.value })}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="nodrag" title="Новый разговор (⌘⇧R)" onClick={() => (g.reset(), setTurns([]))}>
          ⟲
        </button>
        <button className="nodrag" title="Настройки" onClick={() => setShowSettings((v) => !v)}>
          ⚙
        </button>
        <button className="nodrag" title="Скрыть (⌘⇧Space)" onClick={() => g.hide()}>
          ✕
        </button>
      </header>

      {showSettings ? (
        <Settings settings={settings} status={status} update={update} />
      ) : tab === 'call' ? (
        <CallView
          lines={lines}
          status={audioStatus}
          listening={listening}
          onToggle={toggleListening}
          onSuggest={suggest}
          onSendTranscript={sendTranscript}
          onClear={() => setLines([])}
        />
      ) : (
        <main>
          {turns.length === 0 && (
            <div className="hint">
              <b>⌘⇧↩</b> скриншот + ответ · <b>⌘⇧I</b> вопрос · <b>⌘⇧Space</b> показать/скрыть · <b>⌘⇧T</b> расшифровку в чат · <b>⌘⇧A</b> что ответить на созвоне · <b>⌘⇧R</b> сброс · <b>⌘⇧стрелки</b> двигать
              {status && !status.ok && <div className="error">{status.detail}</div>}
            </div>
          )}
          {turns.map((t, i) => (
            <section key={i} className="turn">
              {(t.q || t.screenshot) && (
                <div className="q">
                  {t.screenshot && '📷 '}
                  {t.label ? `🎧 Подсказка по созвону` : t.q || 'скриншот'}
                </div>
              )}
              <Answer text={t.a} />
              {t.error && <div className="error">{t.error}</div>}
              {t.meta && <div className="meta">{t.meta}</div>}
            </section>
          ))}
          <div ref={bottomRef} />
        </main>
      )}

      <footer>
        <textarea
          ref={inputRef}
          value={input}
          placeholder="Спросите что-нибудь… (↩ отправить, ⌘↩ со скриншотом)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(e.metaKey)
            }
            if (e.key === 'Escape') busy ? g.cancel() : g.hide()
          }}
        />
        {busy ? (
          <button onClick={() => g.cancel()}>■</button>
        ) : (
          <button title="Со скриншотом" onClick={() => submit(true)}>
            📷
          </button>
        )}
      </footer>
    </div>
  )
}

function Settings({
  settings,
  status,
  update
}: {
  settings: PublicSettings
  status?: { ok: boolean; detail: string }
  update: (p: Record<string, unknown>) => void
}) {
  const [key, setKey] = useState('')
  return (
    <main className="settings">
      <label>
        Режим
        <select value={settings.mode} onChange={(e) => update({ mode: e.target.value })}>
          <option value="subscription">Подписка Claude (через Claude Code)</option>
          <option value="apiKey">API-ключ</option>
        </select>
      </label>
      <div className={status?.ok ? 'meta' : 'error'}>{status?.detail ?? 'Проверяю…'}</div>
      {settings.mode === 'subscription' ? (
        <label>
          Путь к claude (пусто — встроенный)
          <input defaultValue={settings.claudePath} onBlur={(e) => update({ claudePath: e.target.value })} placeholder="/opt/homebrew/bin/claude" />
        </label>
      ) : (
        <label>
          API-ключ {settings.hasApiKey && '(сохранён в связке ключей)'}
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
          <button onClick={() => (update({ apiKey: key }), setKey(''))}>Сохранить</button>
        </label>
      )}
      <label className="row">
        <input type="checkbox" checked={settings.hideFromCapture} onChange={(e) => update({ hideFromCapture: e.target.checked })} />
        Скрывать окно от записи экрана и демонстрации
      </label>
      <label>
        Прозрачность фона: {Math.round(settings.opacity * 100)}%
        <input type="range" min={0.3} max={1} step={0.05} value={settings.opacity} onChange={(e) => update({ opacity: Number(e.target.value) })} />
      </label>
      <label>
        Размер скриншота (длинная сторона, px): {settings.screenshotMaxSide}
        <input type="range" min={640} max={1920} step={64} value={settings.screenshotMaxSide} onChange={(e) => update({ screenshotMaxSide: Number(e.target.value) })} />
      </label>
      <label>
        Модель расшифровки
        <select value={settings.whisperModel} onChange={(e) => update({ whisperModel: e.target.value })}>
          <option value="onnx-community/whisper-base">Whisper base (быстро, ~80 МБ)</option>
          <option value="onnx-community/whisper-small">Whisper small (рекомендую, ~300 МБ)</option>
          <option value="onnx-community/whisper-large-v3-turbo">Whisper large-v3-turbo (точнее, ~800 МБ)</option>
        </select>
      </label>
      <label>
        Язык созвона
        <select value={settings.language} onChange={(e) => update({ language: e.target.value })}>
          <option value="russian">Русский</option>
          <option value="english">English</option>
          <option value="auto">Определять автоматически</option>
        </select>
      </label>
      <label className="row">
        <input type="checkbox" checked={settings.micEnabled} onChange={(e) => update({ micEnabled: e.target.checked })} />
        Расшифровывать и мой микрофон (лучше в наушниках)
      </label>
      <div className="meta">Смена модели расшифровки применится после перезапуска.</div>
      <div className="meta">На Pro лимиты небольшие: меньше скриншот и Haiku/Sonnet расходуют их медленнее.</div>
    </main>
  )
}
