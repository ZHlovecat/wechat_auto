import { execFile } from 'child_process'
import { promisify } from 'util'
import { unlink } from 'fs/promises'
import { screen } from 'electron'
import { statSync } from 'fs'
import { mouse, keyboard, Key, Point, Button, straightTo } from '@nut-tree-fork/nut-js'
import { captureScreen } from '../ocr/capture'
import { llmClient } from '../llm/client'

const execFileAsync = promisify(execFile)

mouse.config.mouseSpeed = 1500
mouse.config.autoDelayMs = 50
keyboard.config.autoDelayMs = 30

export interface ScreenPoint {
  x: number
  y: number
  displayId: number
}

// ============================================================================
// 基础：微信窗口 bounds 获取 & 只截微信窗口的图（提高视觉 grounding 精度）
// ============================================================================

export interface WindowRect {
  /** 屏幕逻辑坐标 */
  x: number
  y: number
  w: number
  h: number
  displayId: number
  sf: number
}

export async function getWeChatWindowRect(): Promise<WindowRect | null> {
  const script = `
  tell application "WeChat" to activate
  delay 0.15
  tell application "System Events"
    set wxProc to "WeChat"
    if not (exists process "WeChat") then
      if exists process "微信" then set wxProc to "微信"
    end if
    if not (exists process wxProc) then return "ERR_NO_PROC"
    tell process wxProc
      if not (exists window 1) then return "ERR_NO_WINDOW"
      set p to position of window 1
      set s to size of window 1
      return (item 1 of p as string) & "," & (item 2 of p as string) & "," & (item 1 of s as string) & "," & (item 2 of s as string)
    end tell
  end tell
  `
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 })
    const raw = stdout.trim()
    if (raw.startsWith('ERR_')) return null
    const parts = raw.split(',').map((s) => parseInt(s.trim(), 10))
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null
    const [x, y, w, h] = parts
    // 找出该窗口位于哪个显示器
    const displays = screen.getAllDisplays()
    const display =
      displays.find(
        (d) =>
          x >= d.bounds.x &&
          y >= d.bounds.y &&
          x < d.bounds.x + d.bounds.width &&
          y < d.bounds.y + d.bounds.height
      ) || screen.getPrimaryDisplay()
    return { x, y, w, h, displayId: display.id, sf: display.scaleFactor || 1 }
  } catch {
    return null
  }
}

async function captureWeChatWindow(): Promise<{ imagePath: string; rect: WindowRect } | null> {
  const rect = await getWeChatWindowRect()
  if (!rect) return null
  const display = screen.getAllDisplays().find((d) => d.id === rect.displayId)
  if (!display) return null
  // 将「屏幕逻辑坐标」换算成「目标显示器的像素坐标」（screencapture -D 返回图是物理像素）
  const pxX = Math.max(0, Math.round((rect.x - display.bounds.x) * rect.sf))
  const pxY = Math.max(0, Math.round((rect.y - display.bounds.y) * rect.sf))
  const pxW = Math.round(rect.w * rect.sf)
  const pxH = Math.round(rect.h * rect.sf)
  const imagePath = await captureScreen({
    displayId: display.id,
    x: pxX,
    y: pxY,
    w: pxW,
    h: pxH
  })
  const sz = statSync(imagePath).size
  console.log(
    `[VisionAgent] WeChat window rect=${JSON.stringify(rect)} cropPx=(${pxX},${pxY},${pxW},${pxH}) file=${sz}B`
  )
  return { imagePath, rect }
}

/** 将 bbox（相对「微信窗口截图」的像素坐标）→ 屏幕逻辑坐标中心点 */
function bboxToScreenPoint(
  bbox: [number, number, number, number],
  rect: WindowRect
): ScreenPoint {
  const [x1, y1, x2, y2] = bbox
  const cxPx = (x1 + x2) / 2
  const cyPx = (y1 + y2) / 2
  return {
    x: Math.round(rect.x + cxPx / rect.sf),
    y: Math.round(rect.y + cyPx / rect.sf),
    displayId: rect.displayId
  }
}

// ============================================================================
// 执行原语：点击 / 按键 / 输入
// ============================================================================

/**
 * 点击屏幕逻辑坐标 (x,y)。始终优先 nut-js（Electron 已授予辅助功能权限，nut-js 走 CGEventPost，
 * 支持负坐标 / 次屏）；osascript `click at` 在很多 macOS 上需要单独给 osascript 本体授权，容易报
 * -25211/-25208，留作最后 fallback。
 * move → 停顿 → click，让目标控件先收到 hover/mouseEnter，避免按钮"看似被点但没响应"。
 */
export async function clickAt(x: number, y: number, double = false): Promise<void> {
  try {
    await mouse.move(straightTo(new Point(x, y)))
    await new Promise((r) => setTimeout(r, 180))
    await mouse.leftClick()
    if (double) {
      await new Promise((r) => setTimeout(r, 90))
      await mouse.leftClick()
    }
    console.log(`[VisionAgent] nut-js click ${x},${y}${double ? ' (double)' : ''}`)
    return
  } catch (e) {
    console.log(
      `[VisionAgent] nut-js 点击失败，回退 osascript：${e instanceof Error ? e.message : String(e)}`
    )
  }
  const script = `
  tell application "System Events"
    ${double ? `click at {${x}, ${y}}\ndelay 0.08\nclick at {${x}, ${y}}` : `click at {${x}, ${y}}`}
  end tell
  return "ok"
  `
  await execFileAsync('osascript', ['-e', script], { timeout: 8000 })
  console.log(`[VisionAgent] osascript click at ${x},${y}${double ? ' (double)' : ''}`)
}

const KEY_MAP: Record<string, Key> = {
  Return: Key.Return,
  Enter: Key.Return,
  Escape: Key.Escape,
  Esc: Key.Escape,
  Tab: Key.Tab,
  Space: Key.Space,
  Up: Key.Up,
  Down: Key.Down,
  Left: Key.Left,
  Right: Key.Right,
  Delete: Key.Delete,
  Backspace: Key.Backspace
}

async function pressNamedKey(name: string, times = 1): Promise<void> {
  const k = KEY_MAP[name]
  if (!k) throw new Error(`未支持的按键: ${name}`)
  for (let i = 0; i < Math.max(1, times); i++) {
    await keyboard.type(k)
    await new Promise((r) => setTimeout(r, 80))
  }
  console.log(`[VisionAgent] key ${name} × ${times}`)
}

// ============================================================================
// Agent Loop: 看屏幕 → 规划下一步 → 执行 → 再看 → …
// ============================================================================

export type AgentActionType =
  | 'click'
  | 'double_click'
  | 'key'
  | 'type'
  | 'wait'
  | 'done'
  | 'fail'

export interface AgentAction {
  action: AgentActionType
  /** click/double_click 时：目标在当前截图（微信窗口）里的像素 bbox [x1,y1,x2,y2] */
  bbox?: [number, number, number, number]
  /** key 动作的按键名（Return/Escape/Down/Up/…） */
  key?: string
  /** key 重复次数 */
  times?: number
  /** type 动作要输入的文本 */
  text?: string
  /** wait 等待毫秒数 */
  wait_ms?: number
  /** 模型的一句话描述（日志用） */
  description?: string
  /** 失败原因（fail 时） */
  reason?: string
}

export interface AgentRunResult {
  ok: boolean
  reason?: string
  steps: AgentAction[]
}

export interface AgentRunOptions {
  /** 最大步数，默认 12 */
  maxSteps?: number
  /** 每步之间等待（给 UI 稳定），默认 700ms */
  stepDelayMs?: number
  /** 每一步回调（日志 / UI 展示） */
  onStep?: (step: AgentAction, idx: number) => void
}

/**
 * 通用视觉 Agent：给定自然语言目标，让 GLM-5V-Turbo 直接看微信窗口截图，
 * 自主规划下一步动作（click/按键/等待/结束），由本函数执行后再进下一轮循环。
 */
export async function runVisualAgent(
  goal: string,
  options: AgentRunOptions = {}
): Promise<AgentRunResult> {
  const maxSteps = options.maxSteps ?? 12
  const stepDelay = options.stepDelayMs ?? 700
  const steps: AgentAction[] = []
  const history: string[] = []

  console.log(`[VisualAgent] START goal="${goal}" maxSteps=${maxSteps}`)

  for (let i = 0; i < maxSteps; i++) {
    const shot = await captureWeChatWindow()
    if (!shot) {
      return { ok: false, reason: 'WECHAT_WINDOW_NOT_FOUND', steps }
    }

    let action: AgentAction
    try {
      action = await llmClient.planNextAction(shot.imagePath, goal, history)
    } catch (e) {
      try { await unlink(shot.imagePath) } catch { /* */ }
      return { ok: false, reason: `LLM_PLAN_FAIL: ${e instanceof Error ? e.message : e}`, steps }
    }
    try { await unlink(shot.imagePath) } catch { /* */ }

    steps.push(action)
    options.onStep?.(action, i)
    console.log(`[VisualAgent] step#${i + 1} ${action.action}${action.description ? ' — ' + action.description : ''}`)

    if (action.action === 'done') {
      history.push(`步骤#${i + 1}: done — ${action.description || ''}`)
      return { ok: true, reason: action.description, steps }
    }
    if (action.action === 'fail') {
      return { ok: false, reason: action.reason || action.description || 'model_said_fail', steps }
    }

    try {
      if (action.action === 'click' || action.action === 'double_click') {
        if (!action.bbox || action.bbox.length < 4) throw new Error('click 缺少 bbox')
        const bw = action.bbox[2] - action.bbox[0]
        const bh = action.bbox[3] - action.bbox[1]
        if (bw < 8 || bh < 8) {
          console.log(`[VisualAgent] bbox 过小(${bw}x${bh})，跳过该步（可能是幻觉）`)
          history.push(`步骤#${i + 1}: ${action.action}(bbox=${action.bbox.join(',')}) 被拒：bbox 过小`)
          continue
        }
        const p = bboxToScreenPoint(action.bbox, shot.rect)
        await clickAt(p.x, p.y, action.action === 'double_click')
        history.push(
          `步骤#${i + 1}: ${action.action}(${p.x},${p.y}) — ${action.description || ''}`
        )
      } else if (action.action === 'key') {
        if (!action.key) throw new Error('key 缺少 key 字段')
        await pressNamedKey(action.key, action.times || 1)
        history.push(`步骤#${i + 1}: key(${action.key}×${action.times || 1}) — ${action.description || ''}`)
      } else if (action.action === 'type') {
        if (!action.text) throw new Error('type 缺少 text 字段')
        await keyboard.type(action.text)
        history.push(`步骤#${i + 1}: type("${action.text.slice(0, 20)}") — ${action.description || ''}`)
      } else if (action.action === 'wait') {
        const ms = Math.max(100, Math.min(5000, action.wait_ms || 800))
        await new Promise((r) => setTimeout(r, ms))
        history.push(`步骤#${i + 1}: wait(${ms}ms) — ${action.description || ''}`)
      } else {
        history.push(`步骤#${i + 1}: UNKNOWN_ACTION(${action.action})`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`[VisualAgent] step 执行异常: ${msg}`)
      history.push(`步骤#${i + 1}: 执行异常 — ${msg}`)
    }

    await new Promise((r) => setTimeout(r, stepDelay))
  }

  return { ok: false, reason: 'MAX_STEPS_EXCEEDED', steps }
}

// ============================================================================
// 保留旧接口（还没人调就顺手删除；monitor 已改走 runVisualAgent）
// ============================================================================

export { Button }
