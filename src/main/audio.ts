import { app, desktopCapturer, session, systemPreferences } from 'electron'

/**
 * System-audio loopback. On macOS Chromium only captures it behind these
 * feature flags (ScreenCaptureKit, macOS 13+). Must run before app is ready.
 */
export function enableLoopbackFlags() {
  const existing = app.commandLine.getSwitchValue('enable-features')
  const flags = ['MacLoopbackAudioForScreenShare', 'MacSckSystemAudioLoopbackOverride', 'PulseaudioLoopbackForScreenShare']
  app.commandLine.appendSwitch('enable-features', [existing, ...flags].filter(Boolean).join(','))
}

/** Answer the renderer's getDisplayMedia() with the main screen plus system audio. */
export function installAudioHandlers() {
  const ses = session.defaultSession
  ses.setDisplayMediaRequestHandler(async (_req, callback) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] })
    callback(screen ? { video: screen, audio: 'loopback' } : {})
  })
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media' || permission === 'display-capture'))
}

export async function askMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  if (systemPreferences.getMediaAccessStatus('microphone') === 'granted') return true
  return systemPreferences.askForMediaAccess('microphone')
}
