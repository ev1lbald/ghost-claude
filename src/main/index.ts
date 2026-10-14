import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { askMicrophoneAccess, enableLoopbackFlags, installAudioHandlers } from './audio'
import { captureScreen } from './capture'
import { ApiKeyProvider } from './providers/apikey'
import { SubscriptionProvider } from './providers/subscription'
import type { ClaudeProvider, ImageInput } from './providers/types'
import { getApiKey, loadSettings, publicSettings, saveSettings, setApiKey, type Settings } from './settings'

const here = dirname(fileURLToPath(import.meta.url))

enableLoopbackFlags()

let win: BrowserWindow
let settings: Settings
let provider: ClaudeProvider
let inflight: AbortController | undefined

function makeProvider(): ClaudeProvider {
  if (settings.mode === 'apiKey') {
    const key = getApiKey(settings)
    if (key) return new ApiKeyProvider(key)
  }
  return new SubscriptionProvider(settings.claudePath)
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  win = new BrowserWindow({
    width: 460,
    height: 560,
    x: workArea.x + workArea.width - 480,
    y: workArea.y + 40,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    webPreferences: { preload: join(here, '../preload/index.mjs'), sandbox: false }
  })
  // Float above full-screen apps and follow the user across Spaces.
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setContentProtection(settings.hideFromCapture)
  win.once('ready-to-show', () => win.showInactive())

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(here, '../renderer/index.html'))
}

function send(channel: string, payload?: unknown) {
  if (!win.isDestroyed()) win.webContents.send(channel, payload)
}

async function ask(text: string, withScreenshot: boolean, profileId?: string, display?: string) {
  inflight?.abort()
  const ctrl = (inflight = new AbortController())
  const images: ImageInput[] = []
  try {
    if (withScreenshot) images.push(await captureScreen(win, settings.screenshotMaxSide))
  } catch (e) {
    return send('claude:error', e instanceof Error ? e.message : String(e))
  }
  const profile = settings.profiles.find((p) => p.id === (profileId ?? settings.profileId)) ?? settings.profiles[0]
  send('claude:start', { text: display ?? text, withScreenshot, label: profileId ? profile.name : undefined })
  await provider.ask(
    { text, images, model: settings.model, systemPrompt: profile.systemPrompt },
    {
      onDelta: (t) => ctrl === inflight && send('claude:delta', t),
      onDone: (info) => ctrl === inflight && send('claude:done', info),
      onError: (m) => ctrl === inflight && send('claude:error', m)
    },
    ctrl.signal
  )
}

function moveBy(dx: number, dy: number) {
  const [x, y] = win.getPosition()
  win.setPosition(x + dx, y + dy)
}

function registerShortcuts() {
  const step = 60
  const map: Record<string, () => void> = {
    'CommandOrControl+Shift+Space': () => (win.isVisible() ? win.hide() : win.showInactive()),
    'CommandOrControl+Shift+Return': () => {
      win.showInactive()
      void ask('', true)
    },
    'CommandOrControl+Shift+I': () => {
      win.show()
      win.focus()
      send('ui:focus-input')
    },
    'CommandOrControl+Shift+A': () => {
      win.showInactive()
      send('ui:suggest')
    },
    'CommandOrControl+Shift+T': () => {
      win.showInactive()
      send('ui:send-transcript')
    },
    'CommandOrControl+Shift+R': () => {
      inflight?.abort()
      provider.reset()
      send('ui:reset')
    },
    'CommandOrControl+Shift+Up': () => moveBy(0, -step),
    'CommandOrControl+Shift+Down': () => moveBy(0, step),
    'CommandOrControl+Shift+Left': () => moveBy(-step, 0),
    'CommandOrControl+Shift+Right': () => moveBy(step, 0)
  }
  for (const [accel, fn] of Object.entries(map)) {
    if (!globalShortcut.register(accel, fn)) console.warn(`Не удалось занять ${accel}`)
  }
}

function registerIpc() {
  ipcMain.handle('claude:ask', (_e, text: string, withScreenshot: boolean, profileId?: string, display?: string) =>
    ask(text, withScreenshot, profileId, display)
  )
  ipcMain.handle('audio:ask-mic', () => askMicrophoneAccess())
  ipcMain.handle('claude:cancel', () => inflight?.abort())
  ipcMain.handle('claude:reset', () => {
    inflight?.abort()
    provider.reset()
  })
  ipcMain.handle('claude:status', () => provider.status())
  ipcMain.handle('settings:get', () => publicSettings(settings))
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings> & { apiKey?: string }) => {
    const { apiKey, apiKeyEncrypted: _ignored, ...rest } = patch
    settings = { ...settings, ...rest }
    if (apiKey !== undefined) settings = setApiKey(settings, apiKey)
    saveSettings(settings)
    win.setContentProtection(settings.hideFromCapture)
    if ('mode' in patch || 'claudePath' in patch || apiKey !== undefined) provider = makeProvider()
    return publicSettings(settings)
  })
  ipcMain.handle('window:hide', () => win.hide())
  ipcMain.handle('window:click-through', (_e, on: boolean) => win.setIgnoreMouseEvents(on, { forward: true }))
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide()
  settings = loadSettings()
  provider = makeProvider()
  installAudioHandlers()
  createWindow()
  registerIpc()
  registerShortcuts()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
