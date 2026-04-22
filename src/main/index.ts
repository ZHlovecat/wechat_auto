import { app, shell, BrowserWindow, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerIpcHandlers } from './ipc/handlers'
import { initRuleEngine } from './ruleEngine'
import { getSettings, getImages } from './store'
import { llmClient } from './llm/client'

// 必须在 app.ready 前注册：让 <img src="wechat-img://<id>"> 在 dev/prod 都能跨源取到本地文件
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wechat-img',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
])

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.wechat-auto.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 渲染进程通过 wechat-img://<id> 取图，主进程按 id 查表 → 返回 userData/images 下的文件
  protocol.handle('wechat-img', async (req) => {
    try {
      const url = new URL(req.url)
      const id = decodeURIComponent(url.hostname || url.pathname.replace(/^\//, ''))
      const image = getImages().find((i) => i.id === id)
      if (!image?.path) return new Response('not found', { status: 404 })
      return await net.fetch(pathToFileURL(image.path).toString())
    } catch (err) {
      console.error('[protocol:wechat-img] error:', err)
      return new Response('error', { status: 500 })
    }
  })

  const settings = getSettings()
  llmClient.configure(settings.llm)

  registerIpcHandlers()
  initRuleEngine()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
