import { contextBridge, ipcRenderer } from 'electron'

const on = (channel: string) => (fn: (payload: any) => void) => {
  const listener = (_e: unknown, payload: any) => fn(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  ask: (text: string, withScreenshot: boolean, profileId?: string, display?: string) =>
    ipcRenderer.invoke('claude:ask', text, withScreenshot, profileId, display),
  askMic: () => ipcRenderer.invoke('audio:ask-mic'),
  asrStart: (model: string): Promise<void> => ipcRenderer.invoke('asr:start', model),
  asrTranscribe: (audio: Float32Array, language: string): Promise<string> => ipcRenderer.invoke('asr:transcribe', audio, language),
  asrStop: () => ipcRenderer.invoke('asr:stop'),
  onAsrStatus: (fn: (text: string) => void) => {
    const listener = (_e: unknown, t: string) => fn(t)
    ipcRenderer.on('asr:status', listener)
    return () => ipcRenderer.removeListener('asr:status', listener)
  },
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
  onFocusInput: on('ui:focus-input'),
  onSuggest: on('ui:suggest'),
  onSendTranscript: on('ui:send-transcript')
}

contextBridge.exposeInMainWorld('ghost', api)
export type GhostApi = typeof api
