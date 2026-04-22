import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AutoReplyRule } from '../types'

export const useRulesStore = defineStore('rules', () => {
  const rules = ref<AutoReplyRule[]>([])

  async function load(): Promise<void> {
    rules.value = (await window.wechatAPI.getRules()) as AutoReplyRule[]
  }

  async function save(): Promise<void> {
    await window.wechatAPI.saveRules(JSON.parse(JSON.stringify(rules.value)))
  }

  function addRule(): void {
    const newRule: AutoReplyRule = {
      id: `rule_${Date.now()}`,
      name: '新规则',
      enabled: true,
      contacts: [],
      trigger: { type: 'all' },
      action: {
        type: 'llm',
        systemPrompt: '你是一个友好的微信聊天助手，请用简洁自然的中文回复。',
        knowledgeBaseId: ''
      },
      cooldown: 5
    }
    rules.value.push(newRule)
  }

  function removeRule(id: string): void {
    rules.value = rules.value.filter((r) => r.id !== id)
  }

  function toggleRule(id: string): void {
    const rule = rules.value.find((r) => r.id === id)
    if (rule) rule.enabled = !rule.enabled
  }

  return { rules, load, save, addRule, removeRule, toggleRule }
})
