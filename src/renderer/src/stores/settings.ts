import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings } from '../types'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({
    llm: {
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      systemPrompt: '你是一个微信聊天助手。你会看到微信聊天窗口的截图，需要判断是否有新消息需要回复，并给出合适的回复。回复要简洁自然，像真人聊天一样。',
      temperature: 0.7
    },
    monitor: {
      contacts: [],
      pollingInterval: 3000,
      enabled: false
    }
  })

  async function load(): Promise<void> {
    settings.value = await window.wechatAPI.getSettings()
  }

  async function save(partial: Partial<AppSettings>): Promise<void> {
    const result = await window.wechatAPI.updateSettings(JSON.parse(JSON.stringify(partial)))
    settings.value = result as unknown as AppSettings
  }

  async function testConnection(): Promise<string> {
    const { reply } = await window.wechatAPI.testLLM()
    return reply
  }

  return { settings, load, save, testConnection }
})
