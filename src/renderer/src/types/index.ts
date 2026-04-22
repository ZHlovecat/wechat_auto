export interface MessagePipeline {
  read: string
  plan: string
  execute: string
  verify: string
}

export interface Message {
  id: string
  sender: string
  content: string
  timestamp: number
  chatName: string
  isFromMe: boolean
  pipeline?: MessagePipeline
}

export interface UnreadChat {
  name: string
  unreadCount: number
}

export interface AutoReplyRule {
  id: string
  name: string
  enabled: boolean
  contacts: string[]
  trigger: {
    type: 'keyword' | 'all'
    value?: string
  }
  action: {
    type: 'llm' | 'favorites' | 'image'
    systemPrompt?: string
    knowledgeBaseId?: string
    prefaceTemplate?: string
    maxFavorites?: number
    favoritesMode?: 'default' | 'search'
    favoritesKeywords?: string[]
    imageIds?: string[]
    imagePath?: string
  }
  cooldown: number
}

export interface LibraryImage {
  id: string
  name: string
  path: string
  size: number
  createdAt: number
}

export interface KnowledgeBase {
  id: string
  name: string
  content: string
  updatedAt: number
}

export interface LLMSettings {
  apiKey: string
  baseURL: string
  model: string
  systemPrompt: string
  temperature: number
}

export interface MonitorSettings {
  contacts: string[]
  pollingInterval: number
  enabled: boolean
}

export interface AppSettings {
  llm: LLMSettings
  monitor: MonitorSettings
}

export interface MonitorStatus {
  running: boolean
  lastCheck: number
  messagesProcessed: number
  llmCalls: number
  errors: string[]
}

export interface ChatHistoryEntry {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface OcrResult {
  text: string
  x: number
  y: number
  confidence: number
}
