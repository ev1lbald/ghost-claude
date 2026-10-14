import { contextBridge, ipcRenderer } from 'electron'

const on = (channel: string) => (fn: (payload: any) => void) => {
  const listener = (_e: unknown, payload: any) => fn(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  ask: (text: string, withScreenshot: boolean) => ipcRenderer.invoke('claude:ask', text, withScreenshot),
  cancel: () => ipcRenderer.invoke('claude:cancel'),
  reset: () => ipcRenderer.invoke('claude:reset'),
  status: () => ipcRenderer.invoke('claude:status'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  hide: () => ipcRenderer.invoke('window:hide'),
  onStart: on('claude:start'),
  onDelta: on('claude:delta'),
  onDone: on('claude:done'),
  onError: on('claude:error'),
  onReset: on('ui:reset'),
  onFocusInput: on('ui:focus-input')
}

contextBridge.exposeInMainWorld('ghost', api)
export type GhostApi = typeof api
