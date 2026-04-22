import OpenAI from 'openai'
import { readFileSync, statSync } from 'fs'
import type { LLMSettings } from '../types'
import type { PipelineJson } from './pipelinePrompt'
import { buildPipelineSystemPrompt } from './pipelinePrompt'

export interface VisionLatestMessage {
  vision: 'ok' | 'fail'
  reason?: string
  chatTitle?: string
  latestFrom?: 'them' | 'me' | 'unknown'
  latestText?: string
}

/** GLM-5V-Turbo 固定接入点与模型名（用户不可改） */
export const GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
export const GLM_MODEL = 'glm-5v-turbo'
/** GLM-5V-Turbo 官方上限：最大输出 128K tokens（见 https://docs.bigmodel.cn 模型页） */
export const GLM_MAX_TOKENS = 128000

export class LLMClient {
  private client: OpenAI | null = null
  private settings: LLMSettings = {
    apiKey: '',
    baseURL: GLM_BASE_URL,
    model: GLM_MODEL,
    systemPrompt: '你是一个微信聊天助手。',
    temperature: 0.7
  }

  configure(settings: Partial<LLMSettings>): void {
    Object.assign(this.settings, settings)
    // 强制固定到 GLM-5V-Turbo，避免历史设置覆盖
    this.settings.baseURL = GLM_BASE_URL
    this.settings.model = GLM_MODEL
    if (this.settings.apiKey) {
      this.client = new OpenAI({
        apiKey: this.settings.apiKey,
        baseURL: GLM_BASE_URL
      })
    }
  }

  isConfigured(): boolean {
    return !!this.client && !!this.settings.apiKey
  }

  getSettings(): LLMSettings {
    return { ...this.settings }
  }

  /**
   * 固定流水线：返回 read/plan/reply/verify；reply 为实际发送内容。
   */
  async pipelineReply(
    userMessage: string,
    rolePrompt: string,
    knowledgeBlock?: string
  ): Promise<PipelineJson> {
    if (!this.client) throw new Error('LLM 未配置，请先设置 API Key。')

    const kb = knowledgeBlock?.trim()
      ? `\n\n【知识库参考】\n${knowledgeBlock.trim()}\n`
      : ''
    const system = buildPipelineSystemPrompt(`${rolePrompt}${kb}`)

    const response = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage }
      ],
      temperature: Math.min(this.settings.temperature, 0.5),
      max_tokens: GLM_MAX_TOKENS
    })

    const raw = response.choices[0]?.message?.content?.trim() || ''
    const parsed = this.tryParseJson(raw) as Record<string, unknown> | null
    if (parsed && typeof parsed.reply === 'string') {
      return {
        read: String(parsed.read || ''),
        plan: String(parsed.plan || ''),
        reply: String(parsed.reply || '').trim(),
        verify: String(parsed.verify || '')
      }
    }
    return {
      read: '模型未按 JSON 格式返回，已退回为纯文本。',
      plan: '—',
      reply: raw.replace(/^```[\s\S]*?```/g, '').trim() || '抱歉，我这边暂时无法回复。',
      verify: '未能解析结构化输出，已直接使用原文。'
    }
  }

  async simpleChat(userMessage: string, systemPrompt?: string): Promise<string> {
    if (!this.client) throw new Error('LLM 未配置，请先设置 API Key。')

    const response = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        { role: 'system', content: systemPrompt || this.settings.systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: this.settings.temperature,
      max_tokens: GLM_MAX_TOKENS
    })
    return response.choices[0]?.message?.content || ''
  }

  async chat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    systemPrompt?: string
  ): Promise<string> {
    if (!this.client) throw new Error('LLM 未配置，请先设置 API Key。')

    const response = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        { role: 'system', content: systemPrompt || this.settings.systemPrompt },
        ...messages
      ],
      temperature: this.settings.temperature,
      max_tokens: GLM_MAX_TOKENS
    })
    return response.choices[0]?.message?.content || ''
  }

  async analyzeScreenshot(
    imagePath: string,
    systemPrompt: string,
    lastReply?: string
  ): Promise<string> {
    if (!this.client) throw new Error('LLM 未配置，请先设置 API Key。')

    const fileSize = statSync(imagePath).size
    const imageBuffer = readFileSync(imagePath)
    const base64 = imageBuffer.toString('base64')

    console.log(`[LLM] Image: ${fileSize} bytes, base64: ${base64.length} chars, model: ${this.settings.model}`)

    const userPrompt = lastReply
      ? `你会收到一张“微信聊天窗口”的截图。我上次回复的内容是："${lastReply}"。

第一步：请先判断你是否真的“看到了截图内容”（而不是只看到文字提示）。
- 如果你能看到截图内容，请输出以 [VISION_OK] 开头的一行。
- 如果你看不到截图内容（例如图片未被传入/被系统忽略/权限问题/格式不支持），请输出以 [VISION_FAIL] 开头的一行，并用一句话说明原因，然后停止，不要再输出其它内容。

第二步（仅在 [VISION_OK] 时执行）：请仔细阅读截图中的聊天记录，找到“最新一条对方发给我的消息”。如果对方发了新消息（在我上次回复之后）需要我回复，请直接给出回复内容，只输出回复文字；如果没有新消息需要回复，请只输出 [NO_REPLY]。`
      : `你会收到一张“微信聊天窗口”的截图。

第一步：请先判断你是否真的“看到了截图内容”（而不是只看到文字提示）。
- 如果你能看到截图内容，请输出以 [VISION_OK] 开头的一行。
- 如果你看不到截图内容（例如图片未被传入/被系统忽略/权限问题/格式不支持），请输出以 [VISION_FAIL] 开头的一行，并用一句话说明原因，然后停止，不要再输出其它内容。

第二步（仅在 [VISION_OK] 时执行）：请仔细阅读截图中的聊天记录，找到“最新一条对方发给我的消息”，然后给出合适的回复。只输出回复文字，不要加引号和前缀。如果截图中没有看到任何消息，请只输出 [NO_REPLY]。`

    const response = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userPrompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      temperature: this.settings.temperature,
      max_tokens: GLM_MAX_TOKENS
    })

    const result = response.choices[0]?.message?.content?.trim() || '[NO_REPLY]'
    console.log(`[LLM] Usage: prompt=${response.usage?.prompt_tokens}, completion=${response.usage?.completion_tokens}`)
    return result
  }

  async extractLatestMessage(imagePath: string): Promise<VisionLatestMessage> {
    if (!this.client) throw new Error('LLM 未配置，请先设置 API Key。')

    const fileSize = statSync(imagePath).size
    const imageBuffer = readFileSync(imagePath)
    const base64 = imageBuffer.toString('base64')

    console.log(`[LLM] ExtractLatest Image: ${fileSize} bytes, base64: ${base64.length} chars, model: ${this.settings.model}`)

    const prompt = `你会收到一张「微信（macOS 或 Windows）单聊窗口」的截图。

请只输出一段 JSON（不要 Markdown、不要代码块、不要额外文本），格式如下：
{
  "vision": "ok" | "fail",
  "reason": "如果 vision=fail，说明原因",
  "chatTitle": "聊天标题/群名（看不清就留空字符串）",
  "latestFrom": "them" | "me" | "unknown",
  "latestText": "最新一条消息的文本内容（尽量原样抄写，看不清就留空字符串）"
}

判断规则：
- 如果你能清晰看到这是微信聊天窗口并能读到消息，vision=ok；
- 如果截图不是微信聊天窗口/看不清/无法读取，vision=fail 并填写 reason；
- **latestFrom 必须根据「聊天区域里最后一条消息气泡」在画面中的位置判断，不要根据文字内容猜是谁：**
  - 微信单聊常见布局：**对方消息在左侧**（多为白/浅灰气泡），**我发出的在右侧**（多为绿色气泡）。
  - 若最后一条气泡整体在**左半屏/偏左**，latestFrom=them。
  - 若最后一条气泡整体在**右半屏/偏右（绿色）**，latestFrom=me。
  - 若无法判断左右或气泡被裁切，可用 unknown。
- latestText 只抄写**最后一条**气泡内的文字。`

    const response = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        { role: 'system', content: '你是一个严格输出 JSON 的视觉信息抽取助手。' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64}`, detail: 'high' }
            }
          ]
        }
      ],
      temperature: 0,
      max_tokens: GLM_MAX_TOKENS,
      // 关闭思考以节省 tokens & 避免把输出顶没；视觉抽取不需要深度推理
      // @ts-expect-error GLM 扩展字段
      thinking: { type: 'disabled' }
    })

    const raw = response.choices[0]?.message?.content?.trim() || ''
    console.log(`[LLM] ExtractLatest Usage: prompt=${response.usage?.prompt_tokens}, completion=${response.usage?.completion_tokens}`)
    if (process.env.WECHAT_AUTO_DEBUG_LLM) {
      console.log(`[LLM] ExtractLatest raw: ${raw.slice(0, 400)}`)
    }

    const parsed = this.tryParseJson(raw)
    if (parsed && typeof parsed === 'object') return parsed as VisionLatestMessage
    return {
      vision: 'fail',
      reason: `JSON 解析失败: ${raw.slice(0, 120)}`,
      latestFrom: 'unknown',
      latestText: ''
    }
  }

  /**
   * GLM-5V-Turbo 视觉 Grounding：让模型在截图中定位一个元素，返回 [xmin,ymin,xmax,ymax]（像素坐标）。
   * 失败返回 null。
   */
  async locateOnScreen(
    imagePath: string,
    instruction: string
  ): Promise<[number, number, number, number] | null> {
    if (!this.client) throw new Error('LLM 未配置，请先设置 API Key。')

    const imageBuffer = readFileSync(imagePath)
    const base64 = imageBuffer.toString('base64')

    const prompt = `请在这张截图中定位：${instruction}

严格只输出一行 JSON，格式：{"found": true|false, "bbox": [xmin, ymin, xmax, ymax]}
坐标以截图的像素为参考（左上为 0,0）。找不到请返回 {"found": false, "bbox": [0,0,0,0]}。不要输出任何其它文字、解释或 Markdown。`

    const response = await this.client.chat.completions.create({
      model: GLM_MODEL,
      messages: [
        { role: 'system', content: '你是严格按 JSON 输出的视觉定位助手。' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64}` }
            }
          ]
        }
      ],
      temperature: 0,
      max_tokens: GLM_MAX_TOKENS,
      // 坐标定位关闭思考：避免 thinking 把输出 tokens 吃完
      // @ts-expect-error GLM 扩展字段
      thinking: { type: 'disabled' }
    })

    const raw = response.choices[0]?.message?.content?.trim() || ''
    console.log(`[LLM] Locate "${instruction.slice(0, 30)}": ${raw.slice(0, 120)}`)
    const parsed = this.tryParseJson(raw) as { found?: boolean; bbox?: number[] } | null
    if (!parsed || !parsed.found || !Array.isArray(parsed.bbox) || parsed.bbox.length < 4) return null
    const [x1, y1, x2, y2] = parsed.bbox.map((n) => Number(n) || 0)
    if (x2 <= x1 || y2 <= y1) return null
    return [x1, y1, x2, y2]
  }

  /**
   * Agent 规划：给定截图（微信窗口）+ 目标 + 已执行历史，返回下一步动作 JSON。
   */
  async planNextAction(
    imagePath: string,
    goal: string,
    history: string[]
  ): Promise<{
    action: 'click' | 'double_click' | 'key' | 'type' | 'wait' | 'done' | 'fail'
    bbox?: [number, number, number, number]
    key?: string
    times?: number
    text?: string
    wait_ms?: number
    description?: string
    reason?: string
  }> {
    if (!this.client) throw new Error('LLM 未配置，请先设置 API Key。')

    const imageBuffer = readFileSync(imagePath)
    const base64 = imageBuffer.toString('base64')

    const historyText = history.length
      ? history.slice(-8).map((h, i) => `${i + 1}) ${h}`).join('\n')
      : '(暂无)'

    const system = `你是一名 macOS GUI 自动化 Agent。你会看到一张「微信聊天窗口」的截图（只截了微信那一扇窗口，坐标以该截图像素为参考，左上 0,0）。
你的职责是：每一步**只输出一段 JSON**，描述当前应该执行的**一个**动作，由外部执行后再把下一张截图传回给你，形成「看 → 规划 → 执行 → 看」的闭环。

可用动作：
- {"action":"click","bbox":[x1,y1,x2,y2],"description":"..."}：左键点击某个控件，bbox 为该控件在截图里的像素矩形（尽量把整个按钮框住，勿只圈一个像素）。
- {"action":"double_click","bbox":[x1,y1,x2,y2],"description":"..."}：双击。
- {"action":"key","key":"Return|Escape|Down|Up|Left|Right|Tab|Space","times":1,"description":"..."}：按键。
- {"action":"type","text":"...","description":"..."}：在当前焦点输入框输入文字。
- {"action":"wait","wait_ms":800,"description":"等 UI 稳定"}。
- {"action":"done","description":"目标已完成"}。
- {"action":"fail","reason":"..."}：目标无法完成（比如要点的按钮完全不存在）。

要求：
- **bbox 必须真实覆盖目标控件**，宽或高都不得小于 10 像素；若图里根本看不到目标，返回 fail 或先 wait。
- 严格输出**一段 JSON**，不要 Markdown、不要代码块、不要附加说明。`

    const user = `【目标】${goal}

【已执行的步骤】
${historyText}

请观察截图，给出下一步最合适的 JSON 动作。`

    const response = await this.client.chat.completions.create({
      model: GLM_MODEL,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: user },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]
        }
      ],
      temperature: 0,
      max_tokens: GLM_MAX_TOKENS,
      // @ts-expect-error GLM 扩展字段
      thinking: { type: 'disabled' }
    })

    const raw = response.choices[0]?.message?.content?.trim() || ''
    console.log(`[LLM] planNextAction raw: ${raw.slice(0, 200)}`)
    const parsed = this.tryParseJson(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed.action !== 'string') {
      return { action: 'fail', reason: `模型未返回有效 JSON: ${raw.slice(0, 120)}` }
    }
    const act = parsed as {
      action: string
      bbox?: number[]
      key?: string
      times?: number
      text?: string
      wait_ms?: number
      description?: string
      reason?: string
    }
    const result: {
      action: 'click' | 'double_click' | 'key' | 'type' | 'wait' | 'done' | 'fail'
      bbox?: [number, number, number, number]
      key?: string
      times?: number
      text?: string
      wait_ms?: number
      description?: string
      reason?: string
    } = {
      action: (['click', 'double_click', 'key', 'type', 'wait', 'done', 'fail'].includes(act.action)
        ? act.action
        : 'fail') as
        | 'click'
        | 'double_click'
        | 'key'
        | 'type'
        | 'wait'
        | 'done'
        | 'fail',
      description: typeof act.description === 'string' ? act.description : undefined,
      reason: typeof act.reason === 'string' ? act.reason : undefined
    }
    if (Array.isArray(act.bbox) && act.bbox.length >= 4) {
      result.bbox = [
        Number(act.bbox[0]) || 0,
        Number(act.bbox[1]) || 0,
        Number(act.bbox[2]) || 0,
        Number(act.bbox[3]) || 0
      ]
    }
    if (typeof act.key === 'string') result.key = act.key
    if (typeof act.times === 'number') result.times = act.times
    if (typeof act.text === 'string') result.text = act.text
    if (typeof act.wait_ms === 'number') result.wait_ms = act.wait_ms
    return result
  }

  private tryParseJson(raw: string): unknown | null {
    let s = (raw || '').trim()
    if (!s) return null
    // 1) 剥离 <think>...</think> / <reasoning>...</reasoning> 段
    s = s.replace(/<think[\s\S]*?<\/think>/gi, '').replace(/<reasoning[\s\S]*?<\/reasoning>/gi, '').trim()
    // 2) 剥离 ```json ... ``` 或 ``` ... ``` 代码围栏
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
    if (fence && fence[1]) s = fence[1].trim()
    if (!s) return null
    try {
      return JSON.parse(s)
    } catch {
      const start = s.indexOf('{')
      const end = s.lastIndexOf('}')
      if (start >= 0 && end > start) {
        const sub = s.slice(start, end + 1)
        try { return JSON.parse(sub) } catch { /* ignore */ }
      }
      return null
    }
  }
}

export const llmClient = new LLMClient()
