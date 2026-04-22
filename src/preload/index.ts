import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

function toRaw<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

const wechatAPI = {
  selectRegion: () => ipcRenderer.invoke('monitor:select-region'),
  startMonitor: (contacts: string[]) => ipcRenderer.invoke('monitor:start', toRaw(contacts)),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  getMonitorStatus: () => ipcRenderer.invoke('monitor:status'),

  activateWeChat: () => ipcRenderer.invoke('wechat:activate'),
  sendMessage: (chat: string, text: string) => ipcRenderer.invoke('wechat:send', chat, text),
  sendImage: (chat: string, imagePath: string) =>
    ipcRenderer.invoke('wechat:sendImage', chat, imagePath),
  selectImage: () => ipcRenderer.invoke('wechat:selectImage'),

  chatWithLLM: (messages: Array<{ role: string; content: string }>) =>
    ipcRenderer.invoke('llm:chat', toRaw(messages)),
  testLLM: () => ipcRenderer.invoke('llm:test'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke('settings:update', toRaw(settings)),

  getRules: () => ipcRenderer.invoke('rules:get'),
  saveRules: (rules: unknown[]) => ipcRenderer.invoke('rules:save', toRaw(rules)),

  getKnowledgeBases: () => ipcRenderer.invoke('kb:get'),
  saveKnowledgeBases: (list: unknown[]) => ipcRenderer.invoke('kb:save', toRaw(list)),

  getImages: () => ipcRenderer.invoke('images:get'),
  uploadImages: () => ipcRenderer.invoke('images:upload'),
  renameImage: (id: string, name: string) => ipcRenderer.invoke('images:rename', id, name),
  deleteImage: (id: string) => ipcRenderer.invoke('images:delete', id),

  getMessages: () => ipcRenderer.invoke('messages:get'),
  clearMessages: () => ipcRenderer.invoke('messages:clear'),
  addMessage: (msg: unknown) => ipcRenderer.invoke('messages:add', toRaw(msg)),

  onNewMessage: (callback: (message: unknown) => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('message:new', handler)
    return () => ipcRenderer.removeListener('message:new', handler)
  },
  onStatusChange: (callback: (status: unknown) => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('status:change', handler)
    return () => ipcRenderer.removeListener('status:change', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('wechatAPI', wechatAPI)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.wechatAPI = wechatAPI
}
