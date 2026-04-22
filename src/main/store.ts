import Store from 'electron-store'
import type { AppSettings, AutoReplyRule, KnowledgeBase, LibraryImage, Message } from './types'

interface StoreSchema {
  settings: AppSettings
  rules: AutoReplyRule[]
  knowledgeBases: KnowledgeBase[]
  messages: Message[]
  images: LibraryImage[]
}

const defaults: StoreSchema = {
  settings: {
    llm: {
      apiKey: '',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5v-turbo',
      systemPrompt: '你是一个微信聊天助手。你会看到微信聊天窗口的截图，需要判断是否有新消息需要回复，并给出合适的回复。回复要简洁自然，像真人聊天一样。',
      temperature: 0.7
    },
    monitor: {
      contacts: [],
      pollingInterval: 3000,
      enabled: false
    }
  },
  rules: [],
  knowledgeBases: [],
  messages: [],
  images: []
}

const store = new Store<StoreSchema>({
  name: 'wechat-auto-config',
  defaults
})

function toPlain<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function getSettings(): AppSettings {
  const s = toPlain(store.get('settings'))
  // 强制迁移到 GLM-5V-Turbo（忽略历史配置中的 OpenAI/Claude 等 baseURL/model）
  s.llm.baseURL = 'https://open.bigmodel.cn/api/paas/v4'
  s.llm.model = 'glm-5v-turbo'
  return s
}

export function updateSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    llm: {
      ...current.llm,
      ...(settings.llm || {}),
      // 强制锁定到 GLM-5V-Turbo
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5v-turbo'
    },
    monitor: { ...current.monitor, ...(settings.monitor || {}) }
  }
  store.set('settings', updated)
  return toPlain(updated)
}

export function getRules(): AutoReplyRule[] {
  const rules = toPlain(store.get('rules') || []) as Array<
    AutoReplyRule & { action: AutoReplyRule['action'] & { template?: string } }
  >
  // 规则按「用户拖拽后的数组顺序」评估，数组靠前优先级更高。
  // 历史遗留迁移：
  //   regex / at_me → all
  //   template / 其它未知 action → llm
  //   favorites 保留；旧 action.template 字段迁移为 prefaceTemplate
  return rules.map((r) => {
    const legacyTrigger = r.trigger?.type as string
    const legacyAction = r.action?.type as string
    const trigger =
      legacyTrigger === 'keyword' || legacyTrigger === 'all'
        ? r.trigger
        : { type: 'all' as const, value: r.trigger?.value }

    const oldTemplate = r.action?.template
    const a = { ...r.action }
    if (oldTemplate && !a.prefaceTemplate) a.prefaceTemplate = oldTemplate
    delete (a as { template?: string }).template

    let action: AutoReplyRule['action']
    if (legacyAction === 'llm' || legacyAction === 'favorites' || legacyAction === 'image') {
      action = { ...a, type: legacyAction }
    } else {
      action = { ...a, type: 'llm' }
    }
    return { ...r, trigger, action }
  })
}

export function saveRules(rules: AutoReplyRule[]): void {
  store.set('rules', toPlain(rules))
}

export function getImages(): LibraryImage[] {
  const raw = store.get('images')
  if (raw == null) return []
  const list = toPlain(raw) as LibraryImage[]
  return Array.isArray(list)
    ? list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    : []
}

export function saveImages(list: LibraryImage[]): void {
  store.set('images', toPlain(list))
}

export function getKnowledgeBases(): KnowledgeBase[] {
  const raw = store.get('knowledgeBases')
  if (raw == null) return []
  const list = toPlain(raw) as KnowledgeBase[]
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export function saveKnowledgeBases(list: KnowledgeBase[]): void {
  store.set('knowledgeBases', toPlain(list))
}

export function getMessages(): Message[] {
  return toPlain(store.get('messages'))
}

/** 某聊天的历史消息（按时间升序），用于拼接对话上下文 */
export function getMessagesForChat(chatName: string, maxMessages: number): Message[] {
  const all = getMessages().filter((m) => m.chatName === chatName)
  all.sort((a, b) => a.timestamp - b.timestamp)
  return all.slice(-Math.max(1, maxMessages))
}

export function addMessage(message: Message): void {
  const messages = getMessages()
  messages.push(message)
  if (messages.length > 500) {
    store.set('messages', messages.slice(-500))
  } else {
    store.set('messages', messages)
  }
}

export function clearMessages(): void {
  store.set('messages', [])
}
