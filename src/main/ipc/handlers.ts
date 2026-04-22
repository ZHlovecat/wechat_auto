import { BrowserWindow, ipcMain, dialog, app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, copyFileSync, statSync, unlinkSync } from 'fs'
import { extname, join } from 'path'
import { wechatController } from '../wechat/controller'
import { wechatMonitor } from '../wechat/monitor'
import { llmClient } from '../llm/client'
import { selectRegion } from '../regionSelector'
import {
  getSettings,
  updateSettings,
  getRules,
  saveRules,
  getKnowledgeBases,
  saveKnowledgeBases,
  getMessages,
  clearMessages,
  addMessage,
  getImages,
  saveImages
} from '../store'
import type { AppSettings, AutoReplyRule, KnowledgeBase, LibraryImage, Message } from '../types'

function getImagesDir(): string {
  const dir = join(app.getPath('userData'), 'images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function registerIpcHandlers(): void {
  // Region selection
  ipcMain.handle('monitor:select-region', async () => {
    console.log('[IPC] monitor:select-region called')
    try {
      const region = await selectRegion()
      if (region) {
        wechatMonitor.setCaptureRegion(region)
        return { success: true, region }
      }
      return { success: false, region: null, error: '未选择区域' }
    } catch (err: unknown) {
      return { success: false, region: null, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Monitor
  ipcMain.handle('monitor:start', (_, contacts: string[]) => {
    console.log('[IPC] monitor:start called with contacts:', contacts)
    const region = wechatMonitor.getCaptureRegion()
    if (!region) {
      return { success: false, error: '请先框选截图区域' }
    }
    const settings = getSettings()
    llmClient.configure(settings.llm)
    wechatMonitor.setPollingInterval(settings.monitor.pollingInterval)
    wechatMonitor.setWatchList(contacts)
    wechatMonitor.start()
    return { success: true, error: null }
  })

  ipcMain.handle('monitor:stop', () => {
    console.log('[IPC] monitor:stop called')
    wechatController.stopMonitor()
    return { success: true }
  })

  ipcMain.handle('monitor:status', () => {
    return JSON.parse(JSON.stringify(wechatMonitor.getStatus()))
  })

  // WeChat operations
  ipcMain.handle('wechat:activate', async () => {
    try {
      await wechatController.activate()
      return { success: true, error: null }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wechat:send', async (_, chatName: string, text: string) => {
    try {
      await wechatController.sendMessage(chatName, text)
      return { success: true, error: null }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wechat:sendImage', async (_, chatName: string, imagePath: string) => {
    try {
      await wechatController.sendImage(chatName, imagePath)
      return { success: true, error: null }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wechat:selectImage', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return { path: null }
    return { path: result.filePaths[0] }
  })

  // LLM
  ipcMain.handle(
    'llm:chat',
    async (_, messages: Array<{ role: 'user' | 'assistant'; content: string }>) => {
      try {
        const reply = await llmClient.chat(messages)
        wechatMonitor.incrementLLMCalls()
        return { reply, success: true, error: null }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return { reply: '', success: false, error: msg }
      }
    }
  )

  ipcMain.handle('llm:test', async () => {
    try {
      const reply = await llmClient.simpleChat('你好，请简单回复以测试连接是否正常。')
      return { reply, success: true, error: null }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { reply: '', success: false, error: msg }
    }
  })

  // Settings
  ipcMain.handle('settings:get', () => {
    return JSON.parse(JSON.stringify(getSettings()))
  })

  ipcMain.handle('settings:update', (_, settings: Partial<AppSettings>) => {
    try {
      const updated = updateSettings(settings)
      llmClient.configure(updated.llm)
      if (wechatMonitor.getStatus().running) {
        wechatMonitor.setPollingInterval(updated.monitor.pollingInterval)
        wechatMonitor.setWatchList(updated.monitor.contacts)
      }
      return JSON.parse(JSON.stringify(updated))
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Rules
  ipcMain.handle('rules:get', () => {
    return JSON.parse(JSON.stringify(getRules()))
  })

  ipcMain.handle('rules:save', (_, rules: AutoReplyRule[]) => {
    saveRules(rules)
    return { success: true }
  })

  // Knowledge Bases
  ipcMain.handle('kb:get', () => {
    return JSON.parse(JSON.stringify(getKnowledgeBases()))
  })

  ipcMain.handle('kb:save', (_, list: KnowledgeBase[]) => {
    try {
      saveKnowledgeBases(list)
      return { success: true, error: null as string | null }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] kb:save failed:', msg)
      return { success: false, error: msg }
    }
  })

  // Messages
  ipcMain.handle('messages:get', () => {
    return JSON.parse(JSON.stringify(getMessages()))
  })

  ipcMain.handle('messages:clear', () => {
    clearMessages()
    return { success: true }
  })

  // Image Library
  ipcMain.handle('images:get', () => JSON.parse(JSON.stringify(getImages())))

  ipcMain.handle('images:upload', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, added: [] as LibraryImage[] }
    }
    const dir = getImagesDir()
    const added: LibraryImage[] = []
    const existing = getImages()
    for (const src of result.filePaths) {
      try {
        const ext = (extname(src) || '.png').toLowerCase()
        const id = `img_${Date.now()}_${randomUUID().slice(0, 8)}`
        const dest = join(dir, `${id}${ext}`)
        copyFileSync(src, dest)
        const size = statSync(dest).size
        const origName = src.split('/').pop() || id
        added.push({ id, name: origName, path: dest, size, createdAt: Date.now() })
      } catch (err) {
        console.error('[IPC] images:upload copy failed:', err)
      }
    }
    saveImages([...added, ...existing])
    return { success: true, added: JSON.parse(JSON.stringify(added)) }
  })

  ipcMain.handle('images:rename', (_, id: string, name: string) => {
    const list = getImages()
    const entry = list.find((e) => e.id === id)
    if (!entry) return { success: false, error: '未找到该图片' }
    entry.name = name.trim() || entry.name
    saveImages(list)
    return { success: true }
  })

  ipcMain.handle('images:delete', (_, id: string) => {
    const list = getImages()
    const entry = list.find((e) => e.id === id)
    if (!entry) return { success: false, error: '未找到该图片' }
    try {
      if (existsSync(entry.path)) unlinkSync(entry.path)
    } catch (err) {
      console.error('[IPC] images:delete unlink failed:', err)
    }
    saveImages(list.filter((e) => e.id !== id))
    return { success: true }
  })

  ipcMain.handle('messages:add', (_, msg: Message) => {
    try {
      const plain = JSON.parse(JSON.stringify(msg)) as Message
      addMessage(plain)
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('message:new', JSON.parse(JSON.stringify(plain)))
        }
      }
      return { success: true, error: null as string | null }
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err)
      return { success: false, error: m }
    }
  })
}
