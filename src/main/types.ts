/** AI 自动回复在后台展示的四个步骤（读取→规划→执行→校验） */
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
  /** 仅 AI 侧展示：后台推理步骤；普通消息可为空 */
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
    /** favorites：可选的引导语模板（支持 {sender} {content} {time}）；留空仅群发收藏 */
    prefaceTemplate?: string
    /** favorites 群发上限（1-50） */
    maxFavorites?: number
    /**
     * favorites 发送方式：
     *  - default：默认，按「全部收藏」顺序发送前 N 条（保持原逻辑）
     *  - search：按关键词在搜索框内逐个搜索，命中则勾选第一条发送，未命中跳过
     * 字段缺省时视为 default，保持向后兼容
     */
    favoritesMode?: 'default' | 'search'
    /** favorites search 模式下的关键词数组（UI 中以英文逗号分隔输入） */
    favoritesKeywords?: string[]
    /** 图片库条目 id 列表：按顺序逐张发送（支持多张） */
    imageIds?: string[]
    /** 旧字段：单张图片路径；新字段为空时回退 */
    imagePath?: string
  }
  cooldown: number
}

/** 图片库条目：文件被复制到 userData/images/ 下，id 稳定指向一张图 */
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

export interface OcrResult {
  text: string
  x: number
  y: number
  confidence: number
}
