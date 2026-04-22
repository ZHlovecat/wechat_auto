import { BrowserWindow } from 'electron'
import { unlink } from 'fs/promises'
import { captureScreen } from '../ocr/capture'
import { llmClient } from '../llm/client'
import { runAppleScript, Scripts } from './applescript'
import {
  getSettings,
  addMessage,
  getRules,
  getKnowledgeBases,
  getMessagesForChat,
  getImages
} from '../store'
import type { AutoReplyRule, Message, MessagePipeline, MonitorStatus } from '../types'
import type { CaptureRegion } from '../regionSelector'
import { wechatSender } from './sender'
import { runVisualAgent, getWeChatWindowRect, clickAt } from './visionAgent'

export class WeChatMonitor {
  private watchList: string[] = []
  private pollingInterval = 5000
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private polling = false
  private captureRegion: CaptureRegion | null = null
  private lastScreenHash = ''
  private lastTriggeredAt = new Map<string, number>()
  /** 避免同一句话被重复写入本地消息（轮询间隔内屏幕未变但多次识别） */
  private lastIncomingTextByChat = new Map<string, string>()
  /** 已经走完「视觉→处理」流程的屏幕 hash，下一轮同 hash 直接跳过（不再调 GLM） */
  private processedScreenHashes = new Set<string>()
  /** 视觉失败的屏幕 hash，短时间内不再重试（给界面变化一点时间），防止循环烧 token */
  private failedScreenHashAt = new Map<string, number>()
  /** 上次识别为「有文字但不是对方」时，即使截图哈希不变也要再跑一次视觉，避免误判为 me 后永远不再提取 */
  /** 同屏连续未按对方处理次数（用于空会话下二次仍误判时强制按对方处理） */
  private suspectSameScreenCount = 0
  private lastSuspiciousScreenHash = ''

  status: MonitorStatus = {
    running: false,
    lastCheck: 0,
    messagesProcessed: 0,
    llmCalls: 0,
    errors: []
  }

  setWatchList(contacts: string[]): void {
    this.watchList = contacts
  }

  setCaptureRegion(region: CaptureRegion): void {
    this.captureRegion = region
    console.log(`[Monitor] Region: x=${region.x} y=${region.y} w=${region.w} h=${region.h}`)
  }

  getCaptureRegion(): CaptureRegion | null {
    return this.captureRegion
  }

  setPollingInterval(ms: number): void {
    this.pollingInterval = Math.max(3000, ms)
    if (this.running) {
      this.stop()
      this.start()
    }
  }

  start(): void {
    if (this.running) return
    if (!this.captureRegion) {
      this.addError('未设置截图区域')
      return
    }
    if (!llmClient.isConfigured()) {
      this.addError('LLM 未配置，请先在设置中填写 API Key')
      return
    }

    this.running = true
    this.status.running = true
    this.lastScreenHash = ''
    this.lastIncomingTextByChat.clear()
    this.processedScreenHashes.clear()
    this.failedScreenHashAt.clear()
    console.log(`[Monitor] Started. Polling every ${this.pollingInterval}ms`)
    this.emitStatus()

    this.timer = setInterval(() => {
      if (!this.polling) {
        this.poll().catch((err) => this.addError(err.message))
      }
    }, this.pollingInterval)

    setTimeout(() => {
      if (this.running && !this.polling) {
        this.poll().catch((err) => this.addError(err.message))
      }
    }, 1000)
  }

  stop(): void {
    this.running = false
    this.status.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    console.log('[Monitor] Stopped')
    this.emitStatus()
  }

  private async poll(): Promise<void> {
    if (!this.running || !this.captureRegion) return

    this.polling = true
    try {
      this.status.lastCheck = Date.now()

      // 1. Screenshot
      const imagePath = await captureScreen(this.captureRegion)
      console.log(`[Monitor] Screenshot captured`)

      // 2. Quick hash check to skip if screen unchanged
      const { createHash: hashFn } = await import('crypto')
      const { readFileSync } = await import('fs')
      const imgBuf = readFileSync(imagePath)
      const screenHash = hashFn('md5').update(imgBuf).digest('hex')

      if (screenHash === this.lastScreenHash) {
        console.log(`[Monitor] Screen unchanged, skipping`)
        try { await unlink(imagePath) } catch { /* */ }
        return
      }
      this.lastScreenHash = screenHash
      this.suspectSameScreenCount = 0
      this.lastSuspiciousScreenHash = ''

      // 同一 hash 已经走完「视觉→处理」流程：不再调 GLM，直接跳过
      if (this.processedScreenHashes.has(screenHash)) {
        console.log(`[Monitor] Hash 已处理过，跳过（不重复调视觉）`)
        try { await unlink(imagePath) } catch { /* */ }
        return
      }
      // 同一 hash 最近视觉失败：60s 内不再重试，避免反复烧 token
      const failAt = this.failedScreenHashAt.get(screenHash)
      if (failAt && Date.now() - failAt < 60_000) {
        console.log(`[Monitor] Hash 近期视觉失败，60s 内跳过`)
        try { await unlink(imagePath) } catch { /* */ }
        return
      }

      // 3. Extract latest message text from screenshot (vision)
      const chatName = this.watchList[0] || '微信'

      console.log(`[Monitor] Extracting latest message...`)
      const extracted = await llmClient.extractLatestMessage(imagePath)
      this.status.llmCalls++
      if (extracted.vision !== 'ok') {
        console.log(`[Monitor] Debug screenshot kept at: ${imagePath}`)
        const reason = extracted.reason || 'unknown'
        console.log(`[Monitor] Vision failed: ${reason}`)
        this.addError(`[VISION_FAIL] ${reason}`)
        this.failedScreenHashAt.set(screenHash, Date.now())
        this.emitStatus()
        return
      }

      let latestText = (extracted.latestText || '').trim()
      let latestFrom: 'them' | 'me' | 'unknown' = extracted.latestFrom || 'unknown'

      // 同屏连续「有字但不是对方」时累加计数，供 correctVisionLatestFrom 二次兜底
      if (latestText && latestFrom !== 'them') {
        if (screenHash === this.lastSuspiciousScreenHash) {
          this.suspectSameScreenCount++
        } else {
          this.suspectSameScreenCount = 1
          this.lastSuspiciousScreenHash = screenHash
        }
      } else {
        this.suspectSameScreenCount = 0
        this.lastSuspiciousScreenHash = ''
      }

      const corrected = this.correctVisionLatestFrom(chatName, latestFrom, latestText)
      latestFrom = corrected.latestFrom
      latestText = corrected.latestText

      console.log(`[Monitor] LatestFrom=${latestFrom}, LatestText=${latestText.substring(0, 80)}`)

      // Cleanup screenshot (extracted ok)
      try { await unlink(imagePath) } catch { /* */ }

      if (latestFrom === 'them') {
        this.suspectSameScreenCount = 0
        this.lastSuspiciousScreenHash = ''
      }

      if (!latestText || latestFrom !== 'them') {
        console.log(`[Monitor] No new incoming message to handle`)
        this.processedScreenHashes.add(screenHash)
        this.emitStatus()
        return
      }

      // 3b. 将识别的对方消息写入本地（去重），供后续对话上下文使用
      const prevIncoming = this.lastIncomingTextByChat.get(chatName)
      if (prevIncoming === latestText) {
        // 视觉抽到的就是上轮已回复过的那条，不再触发规则
        console.log(`[Monitor] 最新对方消息与上次一致，跳过重复处理: ${latestText.slice(0, 40)}`)
        this.processedScreenHashes.add(screenHash)
        this.emitStatus()
        return
      }
      {
        const incomingMsg: Message = {
          id: `in-${Date.now()}`,
          sender: '对方',
          content: latestText,
          timestamp: Date.now(),
          chatName,
          isFromMe: false
        }
        addMessage(incomingMsg)
        this.lastIncomingTextByChat.set(chatName, latestText)
        this.notifyRenderer(incomingMsg)
      }

      // 4. Evaluate rules (keyword priority already handled by getRules())
      const rules = getRules().filter((r) => r.enabled)
      const matched = this.findFirstMatchedRule(rules, chatName, latestText)
      if (!matched) {
        console.log(`[Monitor] No rule matched, skipping`)
        this.processedScreenHashes.add(screenHash)
        this.emitStatus()
        return
      }
      console.log(
        `[Monitor] Matched rule: name=${matched.name}, trigger=${matched.trigger.type}${matched.trigger.value ? `(${matched.trigger.value})` : ''}, action=${matched.action.type}`
      )

      const cooldownMs = Math.max(0, (matched.cooldown || 0) * 1000)
      const key = `${matched.id}::${chatName}`
      const lastAt = this.lastTriggeredAt.get(key) || 0
      if (cooldownMs > 0 && Date.now() - lastAt < cooldownMs) {
        console.log(`[Monitor] Rule cooldown active, skipping: ${matched.name}`)
        this.processedScreenHashes.add(screenHash)
        this.emitStatus()
        return
      }

      // 5. Execute action（带本地对话上下文 + 流水线展示字段）
      const exec = await this.executeRuleAction(matched, chatName, latestText)
      if (!exec.content) {
        console.log(`[Monitor] Rule produced no reply`)
        this.emitStatus()
        return
      }

      this.lastTriggeredAt.set(key, Date.now())

      // 6. Record
      this.status.messagesProcessed++
      const message: Message = {
        id: `reply-${Date.now()}`,
        sender: 'AI助手',
        content: exec.content,
        timestamp: Date.now(),
        chatName,
        isFromMe: true,
        pipeline: exec.pipeline
      }
      addMessage(message)
      this.notifyRenderer(message)
      this.processedScreenHashes.add(screenHash)
      this.emitStatus()

      // 收藏动作执行完后立即再做一次视觉识别，把对方新消息同步进本地上下文（不触发回复）
      // 场景：收藏群发耗时较长（对话框/粘贴/逐张发送），执行期间对方可能又发了新消息，
      // 这一步能让上下文尽早对齐，不用等到下一轮轮询。
      if (matched.action.type === 'favorites') {
        await this.captureAndRecordLatest(chatName).catch((err) => {
          console.log(
            `[Monitor] 收藏后二次识别失败: ${err instanceof Error ? err.message : String(err)}`
          )
        })
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[Monitor] Error:`, msg.substring(0, 200))
      this.addError(msg.substring(0, 200))
    } finally {
      this.polling = false
      this.emitStatus()
    }
  }

  /**
   * 动作执行后的「二次识别」：只抽取+记录，不触发规则/AI。
   * 流程保持与主循环一致（截图 → md5 → 视觉抽取 → 方向纠偏 → 写入 addMessage），差别是：
   *   - 只在 latestFrom=them 且文本不与上一次重复时 addMessage；
   *   - 不做规则匹配、不调 pipelineReply、不发送任何内容；
   *   - 顺带把屏幕 hash 标记为「已处理」，避免下一轮 poll 对同一屏幕再调一次视觉。
   */
  private async captureAndRecordLatest(chatName: string): Promise<void> {
    if (!this.captureRegion) return

    console.log(`[Monitor] 动作后二次识别：截图 + 视觉抽取`)
    const imagePath = await captureScreen(this.captureRegion)
    try {
      const { createHash: hashFn } = await import('crypto')
      const { readFileSync } = await import('fs')
      const imgBuf = readFileSync(imagePath)
      const screenHash = hashFn('md5').update(imgBuf).digest('hex')

      const extracted = await llmClient.extractLatestMessage(imagePath)
      this.status.llmCalls++

      if (extracted.vision !== 'ok') {
        console.log(`[Monitor] 二次识别视觉失败: ${extracted.reason || 'unknown'}（跳过，不影响主循环）`)
        this.failedScreenHashAt.set(screenHash, Date.now())
        return
      }

      let latestText = (extracted.latestText || '').trim()
      let latestFrom: 'them' | 'me' | 'unknown' = extracted.latestFrom || 'unknown'
      const corrected = this.correctVisionLatestFrom(chatName, latestFrom, latestText)
      latestFrom = corrected.latestFrom
      latestText = corrected.latestText
      console.log(
        `[Monitor] 二次识别结果 latestFrom=${latestFrom}, latestText=${latestText.substring(0, 80)}`
      )

      // 无论是否写入，都把这次的 hash 标记为已处理，避免主循环重复视觉调用
      this.lastScreenHash = screenHash
      this.processedScreenHashes.add(screenHash)

      if (!latestText || latestFrom !== 'them') return

      const prev = this.lastIncomingTextByChat.get(chatName)
      if (prev === latestText) return

      const incomingMsg: Message = {
        id: `in-${Date.now()}`,
        sender: '对方',
        content: latestText,
        timestamp: Date.now(),
        chatName,
        isFromMe: false
      }
      addMessage(incomingMsg)
      this.lastIncomingTextByChat.set(chatName, latestText)
      this.notifyRenderer(incomingMsg)
      console.log(`[Monitor] 二次识别捕获对方新消息已写入上下文（不触发回复）`)
    } finally {
      try { await unlink(imagePath) } catch { /* */ }
      this.emitStatus()
    }
  }

  /**
   * 视觉模型偶发把左侧对方气泡标成 me；与「发完回复后的收藏」逻辑无关，仅用于恢复自动回复触发。
   */
  private correctVisionLatestFrom(
    chatName: string,
    latestFrom: 'them' | 'me' | 'unknown',
    latestText: string
  ): { latestFrom: 'them' | 'me' | 'unknown'; latestText: string } {
    const msgs = getMessagesForChat(chatName, 100)
    const empty = msgs.length === 0

    if (latestFrom === 'unknown' && latestText.trim().length > 0) {
      console.log(`[Monitor] LatestFrom 纠正: unknown→them（有文本，按对方新消息处理）`)
      return { latestFrom: 'them', latestText }
    }

    if (latestFrom === 'me' && latestText && empty) {
      if (/找工作|应聘|求职|实习生|岗位|投递|简历|面试|兼职|全职|应届生|海投/.test(latestText)) {
        console.log(`[Monitor] LatestFrom 纠正: me→them（空会话且内容疑似求职者）`)
        return { latestFrom: 'them', latestText }
      }
    }

    if (latestFrom !== 'them' && latestText && empty && this.suspectSameScreenCount >= 2) {
      console.log(`[Monitor] LatestFrom 纠正: 同屏连续误判，强制按对方处理`)
      return { latestFrom: 'them', latestText }
    }

    return { latestFrom, latestText }
  }

  private findFirstMatchedRule(
    rules: AutoReplyRule[],
    chatName: string,
    latestText: string
  ): AutoReplyRule | null {
    for (const rule of rules) {
      if (!this.isRuleApplicableToChat(rule, chatName)) continue
      if (this.isRuleTriggered(rule, latestText)) return rule
    }
    return null
  }

  private isRuleApplicableToChat(rule: AutoReplyRule, chatName: string): boolean {
    if (!rule.contacts || rule.contacts.length === 0) return true
    return rule.contacts.includes(chatName)
  }

  private isRuleTriggered(rule: AutoReplyRule, latestText: string): boolean {
    const t = rule.trigger?.type
    const v = (rule.trigger?.value || '').trim()
    if (t === 'all') return true
    if (t === 'keyword') {
      if (!v) return false
      return latestText.includes(v)
    }
    return false
  }

  private async executeRuleAction(
    rule: AutoReplyRule,
    chatName: string,
    latestText: string
  ): Promise<{ content: string; pipeline?: MessagePipeline }> {
    const readStep = `读取屏幕：已识别对方最新一条消息为「${latestText}」`
    const actionType = rule.action?.type

    if (actionType === 'favorites') {
      const favMode = rule.action.favoritesMode === 'search' ? 'search' : 'default'
      const prefaceTpl = (rule.action.prefaceTemplate || '').trim()
      const preface = prefaceTpl
        ? this.renderTemplate(prefaceTpl, {
            sender: chatName,
            content: latestText,
            time: new Date().toLocaleString()
          }).trim()
        : ''

      await wechatSender.activate()
      if (preface) {
        console.log(`[Monitor] Favorites preface: ${preface.length} chars`)
        const segs = await wechatSender.sendSegmentedDirect(preface)
        console.log(`[Monitor] Sent preface in ${segs.length} segment(s)`)
        await new Promise((r) => setTimeout(r, 1500))
      }

      if (favMode === 'search') {
        const keywords = (rule.action.favoritesKeywords || [])
          .map((k) => (k || '').trim())
          .filter(Boolean)
        if (keywords.length === 0) {
          const note = '[收藏搜索] 未配置关键词，已跳过'
          this.addError('收藏-搜索模式未配置关键词')
          return {
            content: preface ? `${preface}\n${note}` : note,
            pipeline: {
              read: readStep,
              plan: `任务规划：命中规则「${rule.name}」（收藏-搜索模式），但未配置关键词。`,
              execute: note,
              verify: '校验：请在规则里填写至少一个搜索关键词（英文逗号分隔）。'
            }
          }
        }

        console.log(`[Monitor] Favorites search mode, keywords=${keywords.join(',')}`)
        const res = await this.runFavoritesSearchSend(keywords)
        const execLine =
          `[已发送 ${res.sent} 个关键词`
          + (res.skipped.length > 0 ? `；跳过 ${res.skipped.length}（${res.skipped.join('/')}）` : '')
          + (res.failed.length > 0 ? `；失败 ${res.failed.length}（${res.failed.slice(0, 3).join('; ')}）` : '')
          + ']'
        const summary = preface ? `${preface}\n${execLine}` : execLine
        if (res.failed.length > 0) {
          this.addError(`收藏搜索群发部分失败: ${res.failed.slice(0, 3).join('; ')}`)
        }
        return {
          content: summary,
          pipeline: {
            read: readStep,
            plan: `任务规划：命中规则「${rule.name}」（收藏-搜索模式）${preface ? '，先发送引导语' : ''}，对 ${keywords.length} 个关键词依次「打开收藏 → 搜索 → 勾选第一条 → 发送」；无结果自动跳过。`,
            execute: summary,
            verify:
              res.failed.length === 0
                ? `校验：共发送 ${res.sent}/${keywords.length} 个关键词，跳过 ${res.skipped.length} 个。`
                : `校验：有 ${res.failed.length} 个关键词执行异常，请检查辅助功能权限与微信窗口状态。`
          }
        }
      }

      const maxF = Math.min(50, Math.max(1, rule.action.maxFavorites ?? 20))
      console.log(`[Monitor] Favorites: opening panel & sending up to ${maxF} items`)
      const asResult = await this.runFavoritesBulkSend(maxF)
      const ok = asResult.trim() === 'ok'
      if (!ok) {
        const hint = asResult.includes('ERR_VISUAL_AGENT')
          ? '（视觉 Agent 无法完成：请确认微信窗口未最小化、聊天工具栏可见）'
          : asResult.includes('WECHAT_WINDOW_NOT_FOUND')
            ? '（Agent 拿不到微信窗口 bounds：请确认微信已启动且授予辅助功能权限）'
            : asResult.includes('ERR_FAVORITES_BUTTON')
              ? '（无障碍树找不到「收藏」按钮；视觉 Agent 也失败）'
              : ''
        this.addError(`收藏群发失败: ${asResult}${hint}`)
      }

      const summary = preface
        ? `${preface}\n${ok ? '[已打开收藏并逐条发送]' : `[收藏自动化异常] ${asResult}`}`
        : ok
          ? '[已打开收藏并逐条发送]'
          : `[收藏自动化异常] ${asResult}`

      return {
        content: summary,
        pipeline: {
          read: readStep,
          plan: `任务规划：命中规则「${rule.name}」${preface ? '，先发送引导语' : ''}，再通过 AppleScript/视觉定位打开聊天工具栏「收藏」并逐条发送到当前会话（最多 ${maxF} 条）。`,
          execute: summary,
          verify: ok
            ? '校验：收藏群发全链路返回 ok；若实际未发出，请检查微信版本与辅助功能权限。'
            : `校验：未成功完成（${asResult}）。请为「微信」开启辅助功能权限，或确认聊天窗口已聚焦。`
        }
      }
    }

    if (actionType === 'image') {
      const paths = this.resolveImagePaths(rule)
      if (paths.length === 0) return { content: '' }
      console.log(`[Monitor] Sending ${paths.length} image(s) via rule: ${rule.name}`)
      await wechatSender.activate()
      await new Promise((r) => setTimeout(r, 300))
      let sent = 0
      const failures: string[] = []
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i]
        try {
          await runAppleScript(Scripts.copyImageToClipboard(p))
          await new Promise((r) => setTimeout(r, 250))
          await runAppleScript(Scripts.sendImageFromClipboard())
          sent++
          if (i < paths.length - 1) {
            await new Promise((r) => setTimeout(r, 1200))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          failures.push(`${p.split('/').pop()}: ${msg}`)
        }
      }
      const summary =
        failures.length === 0
          ? `[已发送 ${sent} 张图片]`
          : `[已发送 ${sent}/${paths.length} 张图片；失败 ${failures.length} 张]`
      return {
        content: summary,
        pipeline: {
          read: readStep,
          plan: `任务规划：命中规则「${rule.name}」，按顺序将 ${paths.length} 张本地图片粘贴并发送到当前会话（每张间隔 ~1.2s）。`,
          execute: summary,
          verify:
            failures.length === 0
              ? '校验：全部图片已通过剪贴板粘贴并发送成功。'
              : `校验：部分失败 → ${failures.slice(0, 3).join('; ')}`
        }
      }
    }

    // default: llm — 固定流水线 JSON + 本地对话上下文
    const settings = getSettings()
    const baseRolePrompt = rule.action.systemPrompt || settings.llm.systemPrompt ||
      '你是一个友好的微信聊天助手，请用简洁自然的中文回复。'
    const kbId = (rule.action.knowledgeBaseId || '').trim()
    const kb = kbId ? getKnowledgeBases().find((k) => k.id === kbId) : undefined
    const kbBlock = kb?.content || ''

    const history = getMessagesForChat(chatName, 40)
    const contextLines = history
      .map((m) => {
        const who = m.isFromMe ? '我' : '对方'
        return `${who}: ${m.content}`
      })
      .join('\n')

    const userBlock = `【聊天】${chatName}

【本地已保存的对话上下文】（按时间顺序；最后一条「对方」即为当前待回复内容）
${contextLines || '(暂无历史)'}

请严格按系统提示输出 JSON；reply 为最终发给对方的内容（请重点回应最后一条对方消息）。`

    console.log(`[Monitor] Generating LLM reply (pipeline) for rule: ${rule.name}`)
    const result = await llmClient.pipelineReply(userBlock, baseRolePrompt, kbBlock)
    this.status.llmCalls++
    const reply = (result.reply || '').trim()
    if (reply) {
      await wechatSender.activate()
      const segs = await wechatSender.sendSegmentedDirect(reply)
      console.log(
        `[Monitor] Sent LLM reply in ${segs.length} segment(s): ${reply.substring(0, 60)}`
      )
    }
    return {
      content: reply,
      pipeline: {
        read: result.read || readStep,
        plan: result.plan || '（未返回规划）',
        execute: reply,
        verify: result.verify || '（未返回校验）'
      }
    }
  }

  /**
   * 收藏群发统一入口：先走 AppleScript 无障碍树，失败后用 GLM-5V-Turbo 视觉定位「收藏」按钮兜底。
   * 返回 "ok" 或错误描述。
   */
  private async runFavoritesBulkSend(maxItems: number): Promise<string> {
    const n = Math.min(50, Math.max(1, Math.floor(maxItems)))

    // Step 1: AppleScript 无障碍路径
    let asResult = ''
    try {
      asResult = await runAppleScript(Scripts.favoritesBulkSend(n), 45000)
    } catch (e) {
      asResult = e instanceof Error ? e.message : String(e)
    }
    if (asResult.trim() === 'ok') return 'ok'

    if (!asResult.includes('ERR_FAVORITES_BUTTON')) return asResult

    // Step 2: AX 树里「收藏」按钮无 name/title，AppleScript 认不出；
    // 直接按窗口 rect 算出工具栏第 2 个图标（收藏）相对窗口左下角的固定偏移来点击，
    // 再复用 AppleScript 操作弹出的对话框（点「位置」→ 勾前 N 条 → 点「发送」）。
    const rect = await getWeChatWindowRect()
    if (rect) {
      const iconX = rect.x + 328
      const iconY = rect.y + rect.h - 188
      console.log(
        `[Monitor] 按窗口坐标直接点击「收藏」图标 at (${iconX},${iconY}) [windowRect=${rect.x},${rect.y},${rect.w},${rect.h}]`
      )
      await wechatSender.activate()
      await new Promise((r) => setTimeout(r, 400))
      try {
        await clickAt(iconX, iconY)
      } catch (e) {
        console.log(`[Monitor] 坐标点击失败：${e instanceof Error ? e.message : String(e)}`)
      }
      await new Promise((r) => setTimeout(r, 1500))
      const dlgResult = await this.operateFavoritesDialogByCoords(n)
      if (dlgResult === 'ok') {
        console.log('[Monitor] 坐标点击 + 对话框操作全流程成功')
        return 'ok'
      }
      console.log(`[Monitor] 坐标点击后对话框操作失败: ${dlgResult}，进入视觉 Agent 兜底`)
    } else {
      console.log('[Monitor] 拿不到微信窗口 rect，跳过坐标点击路径')
    }

    console.log('[Monitor] AppleScript 找不到收藏按钮，启动 GLM-5V-Turbo 视觉 Agent 接管')
    await wechatSender.activate()
    await new Promise((r) => setTimeout(r, 600))

    const goal = `在「微信」聊天窗口，把收藏里保存的前 ${n} 条「位置」逐条发送到当前会话。
UI 说明：
- 聊天输入框上方有一排小图标（emoji、收藏、文件、剪刀、话筒）。
- 「收藏」是第 2 个图标（形如一个立体方盒 / 收藏袋），点击后会弹出标题为「发送收藏给 xxx」的对话框。
- 对话框左侧边栏有「全部收藏 / 位置 / 标签」三项；右侧是收藏列表，每一行左侧有一个可点选的圆形勾选点（单选圈）。
- 对话框右下角是「取消 / 发送」按钮。
完整步骤（严格依次执行，每次只返回一个 JSON 动作）：
1) click 聊天输入框上方第 2 个小图标（「收藏」方盒图标）；
2) 等对话框出现后，click 左侧边栏的「位置」文字；
3) 依次 click 右侧列表前 ${n} 条各自左侧的那个空心圆勾选点（同一条不要重复点）；
4) 最后 click 对话框右下角的「发送」按钮；
5) 完成后返回 done。
若任一步骤找不到目标元素，请返回 fail。`

    const result = await runVisualAgent(goal, { maxSteps: Math.min(40, n * 2 + 6), stepDelayMs: 1200 })
    if (result.ok) return 'ok'
    return `ERR_VISUAL_AGENT:${result.reason || 'unknown'}`
  }

  /**
   * 「发送收藏给 xxx」对话框已弹出时：拿到对话框 bounds，按固定比例点击前 3 条收藏的行主体，
   * 再点右下角「发送」按钮。对话框默认显示「全部收藏」，前 3 条恰好是最近的 3 个位置收藏，
   * 所以不再点侧栏「位置」也不滚动——KISS。
   *
   * 偏移比例基于用户提供的截图（对话框约 700×500，左侧栏宽约 170，每条高约 130）：
   *   - 行主体点击 x ≈ 对话框宽 × 0.55（落在卡片中部文字区，避开图标/图片）
   *   - 3 条 y 中心 ≈ 对话框高的 0.26 / 0.50 / 0.74（均匀分布）
   *   - 「发送」按钮 ≈ (宽 × 0.92, 高 × 0.93)
   * 勾选生效后行左侧会出现绿色对勾，再点「发送」即群发。
   */
  private async operateFavoritesDialogByCoords(n: number): Promise<string> {
    const topN = Math.min(3, Math.max(1, n))

    // 1. 拿对话框 bounds
    let boundsRaw = ''
    try {
      boundsRaw = await runAppleScript(Scripts.favoritesGetDialogBounds(), 5000)
    } catch (e) {
      return `ERR_DIALOG_BOUNDS_SCRIPT: ${e instanceof Error ? e.message : String(e)}`
    }
    const bt = boundsRaw.trim()
    if (bt.startsWith('ERR_')) return `ERR_DIALOG_BOUNDS:${bt}`
    const parts = bt.split(',').map((s) => parseInt(s.trim(), 10))
    if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) {
      return `ERR_DIALOG_BOUNDS_PARSE:${bt}`
    }
    const [dx, dy, dw, dh] = parts
    console.log(`[Monitor] 对话框 bounds=(${dx},${dy},${dw},${dh})`)

    // 2. 按比例计算 3 条 + 发送
    const rowXRatio = 0.55
    const rowYRatios = [0.26, 0.5, 0.74]
    const sendXRatio = 0.92
    const sendYRatio = 0.93

    for (let i = 0; i < topN; i++) {
      const cx = dx + Math.round(dw * rowXRatio)
      const cy = dy + Math.round(dh * rowYRatios[i])
      console.log(`[Monitor] 勾选第 ${i + 1} 条 at (${cx},${cy})`)
      try {
        await clickAt(cx, cy)
      } catch (e) {
        console.log(`[Monitor] 勾选失败：${e instanceof Error ? e.message : String(e)}`)
      }
      await new Promise((rs) => setTimeout(rs, 320))
    }

    // 3. 点「发送」
    const sx = dx + Math.round(dw * sendXRatio)
    const sy = dy + Math.round(dh * sendYRatio)
    await new Promise((rs) => setTimeout(rs, 400))
    console.log(`[Monitor] 点击「发送」at (${sx},${sy})`)
    try {
      await clickAt(sx, sy)
    } catch (e) {
      return `ERR_SEND_CLICK: ${e instanceof Error ? e.message : String(e)}`
    }
    return 'ok'
  }

  /**
   * 收藏「搜索关键词发送」主流程：对每个关键词依次
   *   打开收藏对话框 → 点搜索框 → 粘贴关键词 → 判断是否有结果
   *     → 有：勾选第一条 + 点发送
   *     → 无：按 Esc 关闭对话框，跳过该关键词
   * 关键词间会主动等待一段时间让上一个对话框完全关闭。
   */
  private async runFavoritesSearchSend(
    keywords: string[]
  ): Promise<{ ok: boolean; sent: number; skipped: string[]; failed: string[] }> {
    const result = { ok: true, sent: 0, skipped: [] as string[], failed: [] as string[] }

    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i]
      console.log(`[Monitor] Favorites search keyword #${i + 1}/${keywords.length}: ${kw}`)

      const dlg = await this.openFavoritesDialogByCoords()
      if (!dlg.ok || !dlg.bounds) {
        result.failed.push(`${kw}:open_failed`)
        result.ok = false
        continue
      }

      const r = await this.operateFavoritesSearchOne(kw, dlg.bounds)
      if (r === 'sent') {
        result.sent++
      } else if (r === 'no_result') {
        result.skipped.push(kw)
        try {
          await runAppleScript(Scripts.closeDialogEsc(), 3000)
        } catch { /* 已是关闭态就好 */ }
      } else {
        result.failed.push(`${kw}:${r}`)
        result.ok = false
        try {
          await runAppleScript(Scripts.closeDialogEsc(), 3000)
        } catch { /* */ }
      }

      if (i < keywords.length - 1) {
        await new Promise((rs) => setTimeout(rs, 1000))
      }
    }

    return result
  }

  /**
   * 仅负责「点开收藏对话框」，不做勾选/发送；返回对话框 bounds 用于后续坐标操作。
   * 走坐标直点（`rect.x + 328, rect.y + rect.h - 188`）这一条路径，因为新版微信的
   * AX 树里「收藏」按钮 name/title 为空，AppleScript 遍历认不出，坐标路径是现有代码
   * 里经过验证的可行方案。
   */
  private async openFavoritesDialogByCoords(): Promise<{
    ok: boolean
    bounds?: { dx: number; dy: number; dw: number; dh: number }
    reason?: string
  }> {
    const rect = await getWeChatWindowRect()
    if (!rect) return { ok: false, reason: 'WECHAT_WINDOW_NOT_FOUND' }

    const iconX = rect.x + 328
    const iconY = rect.y + rect.h - 188
    console.log(`[Monitor] 打开收藏对话框 at (${iconX},${iconY})`)
    await wechatSender.activate()
    await new Promise((r) => setTimeout(r, 400))
    try {
      await clickAt(iconX, iconY)
    } catch (e) {
      return { ok: false, reason: `ICON_CLICK_FAIL: ${e instanceof Error ? e.message : String(e)}` }
    }
    await new Promise((r) => setTimeout(r, 1500))

    // 读取对话框 bounds 作为「已打开」的信号
    let boundsRaw = ''
    try {
      boundsRaw = await runAppleScript(Scripts.favoritesGetDialogBounds(), 5000)
    } catch (e) {
      return { ok: false, reason: `BOUNDS_SCRIPT_FAIL: ${e instanceof Error ? e.message : String(e)}` }
    }
    const bt = boundsRaw.trim()
    if (bt.startsWith('ERR_')) return { ok: false, reason: `BOUNDS:${bt}` }
    const parts = bt.split(',').map((s) => parseInt(s.trim(), 10))
    if (parts.length !== 4 || parts.some((v) => Number.isNaN(v))) {
      return { ok: false, reason: `BOUNDS_PARSE:${bt}` }
    }
    const [dx, dy, dw, dh] = parts
    console.log(`[Monitor] 对话框 bounds=(${dx},${dy},${dw},${dh})`)
    return { ok: true, bounds: { dx, dy, dw, dh } }
  }

  /**
   * 对话框已打开且 bounds 已知时：AppleScript 定位搜索框并填入关键词 → 判断结果数
   *   → items>0：勾选第一条 (0.55, 0.26) + 点「发送」(0.92, 0.93) → 'sent'
   *   → items==0：返回 'no_result'（由调用方负责 Esc 关闭）
   *   → 其它异常：返回错误描述字符串
   *
   * 搜索框的定位改由 AppleScript 走 AX 树（找 AXTextField）完成，避免之前坐标估算把
   * (0.12, 0.08) 点到标题栏导致 sheet 失焦、keystroke 漂到主窗口的问题。
   *
   * 行/发送的坐标仍按对话框 bounds 比例推导（对话框约 700×500，复用默认模式验证过的值）：
   *   - 首行勾选点 ≈ (宽×0.55, 高×0.26)
   *   - 发送按钮   ≈ (宽×0.92, 高×0.93)
   */
  private async operateFavoritesSearchOne(
    keyword: string,
    bounds: { dx: number; dy: number; dw: number; dh: number }
  ): Promise<string> {
    const { dx, dy, dw, dh } = bounds

    // 1. 先走 AX 一体化（AppleScript 定位 AXTextField/AXSearchField 并 click 聚焦）
    console.log(`[Monitor] 搜索框填入关键词「${keyword}」(AX 一体化)`)
    let axFillFailed = ''
    try {
      const r = await runAppleScript(Scripts.favoritesSearchFillKeyword(keyword), 6000)
      const rt = r.trim()
      if (rt !== 'ok') axFillFailed = rt
    } catch (e) {
      axFillFailed = `FILL_SCRIPT_FAIL:${e instanceof Error ? e.message : String(e)}`
    }

    // 1b. AX 找不到搜索框（典型：Electron/WebView 内嵌，AX 树里只有 AXGroup/AXWebArea）
    //     → 坐标点击搜索框 + 纯 keystroke 粘贴 fallback。
    //     y 用 0.15 以避开标题栏（上次 0.08 会点到标题栏导致 sheet 失焦、keystroke 漂到主窗口）。
    if (axFillFailed) {
      console.log(`[Monitor] AX 填充失败: ${axFillFailed}，回退坐标点击 + keystroke`)
      const searchX = dx + Math.round(dw * 0.12)
      const searchY = dy + Math.round(dh * 0.15)
      console.log(`[Monitor] 坐标点击搜索框 at (${searchX},${searchY})`)
      try {
        await clickAt(searchX, searchY)
      } catch (e) {
        return `SEARCH_CLICK_FAIL:${e instanceof Error ? e.message : String(e)}|ax=${axFillFailed}`
      }
      await new Promise((rs) => setTimeout(rs, 400))
      try {
        const r2 = await runAppleScript(Scripts.favoritesSearchFillByKeystroke(keyword), 5000)
        if (r2.trim() !== 'ok') return `FILL_FAIL:${r2}|ax=${axFillFailed}`
      } catch (e) {
        return `FILL_SCRIPT_FAIL:${e instanceof Error ? e.message : String(e)}|ax=${axFillFailed}`
      }
    }

    // 2. 等待列表刷新
    await new Promise((rs) => setTimeout(rs, 900))

    // 3. 盲勾选第一条（微信该对话框是 Electron/WebView，AX 树查不到列表项数，
    //    所以不依赖 inspect，直接按比例点；若搜索无结果，该位置是空白，click 不产生勾选）
    const rowX = dx + Math.round(dw * 0.55)
    const rowY = dy + Math.round(dh * 0.26)
    console.log(`[Monitor] 盲勾选第一条 at (${rowX},${rowY})`)
    try {
      await clickAt(rowX, rowY)
    } catch (e) {
      return `ROW_CLICK_FAIL:${e instanceof Error ? e.message : String(e)}`
    }
    await new Promise((rs) => setTimeout(rs, 400))

    // 4. 点发送
    const sx = dx + Math.round(dw * 0.92)
    const sy = dy + Math.round(dh * 0.93)
    console.log(`[Monitor] 点击「发送」at (${sx},${sy})`)
    try {
      await clickAt(sx, sy)
    } catch (e) {
      return `SEND_CLICK_FAIL:${e instanceof Error ? e.message : String(e)}`
    }

    // 5. 用「对话框是否还在」判断是否真的发出去了：
    //    - 有勾选项：发送后对话框关闭，bounds 不再可查 → sent
    //    - 无搜索结果：发送按钮是灰色禁用，click 无效，对话框仍在 → no_result
    await new Promise((rs) => setTimeout(rs, 1500))
    const stillOpen = await this.isFavoritesDialogOpen()
    if (stillOpen) {
      console.log(`[Monitor] 发送后对话框仍在，判定「${keyword}」无搜索结果`)
      return 'no_result'
    }
    console.log(`[Monitor] 发送后对话框已关闭，判定「${keyword}」发送成功`)
    return 'sent'
  }

  /** 对话框是否仍然打开：复用 bounds 脚本，只关心成功/失败。 */
  private async isFavoritesDialogOpen(): Promise<boolean> {
    try {
      const raw = await runAppleScript(Scripts.favoritesGetDialogBounds(), 3000)
      const t = raw.trim()
      if (t.startsWith('ERR_')) return false
      const parts = t.split(',').map((s) => parseInt(s.trim(), 10))
      return parts.length === 4 && !parts.some((v) => Number.isNaN(v))
    } catch {
      return false
    }
  }

  private renderTemplate(tpl: string, vars: Record<string, string>): string {
    return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`)
  }

  /** 从规则里解析出要发送的图片路径列表：优先 imageIds 查图片库，退而回退 imagePath 单图 */
  private resolveImagePaths(rule: AutoReplyRule): string[] {
    const ids = rule.action.imageIds || []
    if (ids.length > 0) {
      const lib = getImages()
      const paths: string[] = []
      for (const id of ids) {
        const entry = lib.find((e) => e.id === id)
        if (entry && entry.path) paths.push(entry.path)
      }
      if (paths.length > 0) return paths
    }
    const legacy = (rule.action.imagePath || '').trim()
    return legacy ? [legacy] : []
  }

  private addError(msg: string): void {
    console.error(`[Monitor] ${msg}`)
    this.status.errors.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`)
    if (this.status.errors.length > 50) {
      this.status.errors = this.status.errors.slice(0, 50)
    }
    this.emitStatus()
  }

  private notifyRenderer(message: Message): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('message:new', JSON.parse(JSON.stringify(message)))
      }
    }
  }

  private emitStatus(): void {
    const plain = JSON.parse(JSON.stringify(this.status))
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('status:change', plain)
      }
    }
  }

  incrementLLMCalls(): void {
    this.status.llmCalls++
    this.emitStatus()
  }

  getStatus(): MonitorStatus {
    return { ...this.status }
  }
}

export const wechatMonitor = new WeChatMonitor()
