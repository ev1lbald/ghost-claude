import type { GhostApi } from '../../preload'

declare global {
  interface Window {
    ghost: GhostApi
  }
}
