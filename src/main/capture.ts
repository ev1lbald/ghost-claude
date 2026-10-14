import { BrowserWindow, desktopCapturer, screen, systemPreferences } from 'electron'
import type { ImageInput } from './providers/types'

/**
 * Screenshot of the display under the cursor, downscaled and JPEG-encoded so
 * a single image stays around 1–1.5k tokens.
 */
export async function captureScreen(overlay: BrowserWindow, maxSide: number): Promise<ImageInput> {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
    // Triggers the macOS prompt the first time; the user must allow it in
    // System Settings → Privacy & Security → Screen Recording and restart.
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = display.size
  const scale = Math.min(1, maxSide / Math.max(width, height))
  const size = { width: Math.round(width * scale), height: Math.round(height * scale) }

  // Keep our own window out of the picture unless it is already capture-proof.
  const wasVisible = overlay.isVisible()
  overlay.setOpacity(0)
  await new Promise((r) => setTimeout(r, 60))
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!src || src.thumbnail.isEmpty()) {
      throw new Error('Нет доступа к экрану. Разрешите «Запись экрана» для Ghost Claude в Системных настройках и перезапустите приложение.')
    }
    return { mediaType: 'image/jpeg', base64: src.thumbnail.toJPEG(80).toString('base64') }
  } finally {
    if (wasVisible) overlay.setOpacity(1)
  }
}
