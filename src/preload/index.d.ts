import { ElectronAPI } from '@electron-toolkit/preload'

interface CaptureRegion {
  x: number
  y: number
  w: number
  h: number
}

interface KnowledgeBase {
  id: string
  name: string
  content: string
  updatedAt: number
}

interface LibraryImage {
  id: string
  name: string
  path: string
  size: number
  createdAt: number
}

interface WeChatAPI {
  selectRegion: () => Promise<{ success: boolean; region: CaptureRegion | null; error?: string }>
  startMonitor: (contacts: string[]) => Promise<{ success: boolean; error?: string | null }>
  stopMonitor: () => Promise<{ success: boolean }>
  getMonitorStatus: () => Promise<{
    running: boolean
    lastCheck: number
    messagesProcessed: number
    llmCalls: number
    errors: string[]
  }>

  activateWeChat: () => Promise<{ success: boolean; error: string | null }>
  sendMessage: (chat: string, text: string) => Promise<{ success: boolean; error: string | null }>
  sendImage: (chat: string, imagePath: string) => Promise<{ success: boolean; error: string | null }>
  selectImage: () => Promise<{ path: string | null }>

  chatWithLLM: (
    messages: Array<{ role: string; content: string }>
  ) => Promise<{ reply: string; success: boolean; error: string | null }>
  testLLM: () => Promise<{ reply: string; success: boolean; error: string | null }>

  getSettings: () => Promise<{
    llm: {
      apiKey: string
      baseURL: string
      model: string
      systemPrompt: string
      temperature: number
    }
    monitor: {
      contacts: string[]
      pollingInterval: number
      enabled: boolean
    }
  }>
  updateSettings: (settings: Record<string, unknown>) => Promise<Record<string, unknown>>

  getRules: () => Promise<unknown[]>
  saveRules: (rules: unknown[]) => Promise<{ success: boolean }>

  getKnowledgeBases: () => Promise<KnowledgeBase[]>
  saveKnowledgeBases: (list: KnowledgeBase[]) => Promise<{ success: boolean; error?: string | null }>

  getImages: () => Promise<LibraryImage[]>
  uploadImages: () => Promise<{ success: boolean; added: LibraryImage[] }>
  renameImage: (id: string, name: string) => Promise<{ success: boolean; error?: string }>
  deleteImage: (id: string) => Promise<{ success: boolean; error?: string }>

  getMessages: () => Promise<
    Array<{
      id: string
      sender: string
      content: string
      timestamp: number
      chatName: string
      isFromMe: boolean
    }>
  >
  clearMessages: () => Promise<{ success: boolean }>
  addMessage: (msg: {
    id: string
    sender: string
    content: string
    timestamp: number
    chatName: string
    isFromMe: boolean
    pipeline?: {
      read: string
      plan: string
      execute: string
      verify: string
    }
  }) => Promise<{ success: boolean; error?: string | null }>

  onNewMessage: (callback: (message: unknown) => void) => () => void
  onStatusChange: (callback: (status: unknown) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    wechatAPI: WeChatAPI
  }
}
