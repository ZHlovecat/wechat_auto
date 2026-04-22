import { defineStore } from 'pinia'
import { ref, onMounted, onUnmounted } from 'vue'
import type { Message, MonitorStatus } from '../types'

export const useChatStore = defineStore('chat', () => {
  const messages = ref<Message[]>([])
  const status = ref<MonitorStatus>({
    running: false,
    lastCheck: 0,
    messagesProcessed: 0,
    llmCalls: 0,
    errors: []
  })

  let cleanupMessage: (() => void) | null = null
  let cleanupStatus: (() => void) | null = null

  async function loadMessages(): Promise<void> {
    messages.value = await window.wechatAPI.getMessages()
  }

  async function clearMessages(): Promise<void> {
    await window.wechatAPI.clearMessages()
    messages.value = []
  }

  async function refreshStatus(): Promise<void> {
    status.value = await window.wechatAPI.getMonitorStatus()
  }

  async function startMonitor(contacts: string[]): Promise<void> {
    await window.wechatAPI.startMonitor(JSON.parse(JSON.stringify(contacts)))
    status.value.running = true
  }

  async function stopMonitor(): Promise<void> {
    await window.wechatAPI.stopMonitor()
    status.value.running = false
  }

  function setupListeners(): void {
    cleanupMessage = window.wechatAPI.onNewMessage((msg) => {
      messages.value.push(msg as Message)
      if (messages.value.length > 500) {
        messages.value = messages.value.slice(-500)
      }
    })

    cleanupStatus = window.wechatAPI.onStatusChange((s) => {
      status.value = s as MonitorStatus
    })
  }

  function teardownListeners(): void {
    cleanupMessage?.()
    cleanupStatus?.()
  }

  onMounted(() => {
    setupListeners()
    loadMessages()
    refreshStatus()
  })

  onUnmounted(() => {
    teardownListeners()
  })

  return {
    messages,
    status,
    loadMessages,
    clearMessages,
    refreshStatus,
    startMonitor,
    stopMonitor,
    setupListeners,
    teardownListeners
  }
})
