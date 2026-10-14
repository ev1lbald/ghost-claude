import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Profile = { id: string; name: string; systemPrompt: string }

export type Settings = {
  mode: 'subscription' | 'apiKey'
  model: string
  profileId: string
  profiles: Profile[]
  hideFromCapture: boolean
  opacity: number
  /** Long edge of screenshots in px. Smaller is cheaper on Pro limits. */
  screenshotMaxSide: number
  claudePath: string
  /** API key encrypted with the macOS keychain via safeStorage. */
  apiKeyEncrypted?: string
}

const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'general',
    name: 'Общий',
    systemPrompt:
      'Ты ассистент в маленьком оверлее поверх экрана. Отвечай кратко и по делу, на языке вопроса. Если прислан скриншот, сначала пойми, что на нём, и сразу дай ответ.'
  },
  {
    id: 'code',
    name: 'Код',
    systemPrompt:
      'Ты помогаешь с программированием. По скриншоту задачи или кода дай решение: короткое объяснение подхода, затем код в блоке, затем сложность. Без воды.'
  },
  {
    id: 'meeting',
    name: 'Созвон',
    systemPrompt:
      'Ты помогаешь на созвоне. По расшифровке или скриншоту предложи, что ответить: 2–4 коротких пункта, которые можно сказать вслух.'
  },
  {
    id: 'translate',
    name: 'Перевод',
    systemPrompt: 'Переведи текст со скриншота или из вопроса: на русский, если он не русский, иначе на английский. Только перевод.'
  }
]

const DEFAULTS: Settings = {
  mode: 'subscription',
  model: 'claude-sonnet-5-5',
  profileId: 'general',
  profiles: DEFAULT_PROFILES,
  hideFromCapture: false,
  opacity: 0.92,
  screenshotMaxSide: 1280,
  claudePath: ''
}

const file = () => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  if (!existsSync(file())) return { ...DEFAULTS }
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): void {
  writeFileSync(file(), JSON.stringify(s, null, 2))
}

export function setApiKey(s: Settings, key: string): Settings {
  return { ...s, apiKeyEncrypted: key ? safeStorage.encryptString(key).toString('base64') : undefined }
}

export function getApiKey(s: Settings): string | undefined {
  if (!s.apiKeyEncrypted) return undefined
  return safeStorage.decryptString(Buffer.from(s.apiKeyEncrypted, 'base64'))
}

/** What the renderer may see: everything except the key itself. */
export function publicSettings(s: Settings) {
  const { apiKeyEncrypted, ...rest } = s
  return { ...rest, hasApiKey: !!apiKeyEncrypted }
}
