/**
 * 将一段文本按自然语义切成 1~3 段，模拟真人分条回复。
 *
 * 策略：
 * 1. 优先按句末标点 (。！？!?\n) 切分；单句过长再按逗号、分号切分。
 * 2. 目标段数由总长度决定上限（<25: 1 段；<60: ≤2 段；否则 ≤3 段），
 *    并加入随机抖动（少数情况下压到更少段），避免节奏机械。
 * 3. 将原始小片段按字符数尽量均衡地合并进目标数量的桶，保持顺序。
 */
export function splitIntoSegments(text: string): string[] {
  const raw = (text || '').trim()
  if (!raw) return []
  if (Array.from(raw).length <= 12) return [raw]

  // 按句末标点切分，保留标点在前一段末尾
  const sentenceRe = /[^。！？!?\n]+[。！？!?]*\n*/g
  let parts = (raw.match(sentenceRe) || [raw]).map((p) => p.trim()).filter(Boolean)

  // 单句过长：尝试按逗号/分号二次切分
  if (parts.length === 1 && Array.from(raw).length >= 40) {
    const commaRe = /[^，,；;]+[，,；;]?/g
    const commaParts = (raw.match(commaRe) || [raw]).map((p) => p.trim()).filter(Boolean)
    if (commaParts.length >= 2) parts = commaParts
  }

  if (parts.length === 1) return parts

  const totalLen = Array.from(raw).length
  let maxTarget: number
  if (totalLen < 25) maxTarget = 1
  else if (totalLen < 60) maxTarget = 2
  else maxTarget = 3

  const r = Math.random()
  let target: number
  if (maxTarget === 1) target = 1
  else if (maxTarget === 2) target = r < 0.2 ? 1 : 2
  else target = r < 0.1 ? 1 : r < 0.5 ? 2 : 3

  target = Math.max(1, Math.min(target, parts.length))
  if (target === 1) return [parts.join('')]

  // 将 parts 均衡分配到 target 个桶（保持顺序）
  const buckets: string[][] = Array.from({ length: target }, () => [])
  const avgLen = totalLen / target
  let bi = 0
  let curLen = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    buckets[bi].push(p)
    curLen += Array.from(p).length
    const remainingParts = parts.length - i - 1
    const bucketsLeft = target - bi - 1
    // 当前桶已接近均长，且剩余句子还够填满后面的桶，则切到下一个桶
    if (bucketsLeft > 0 && remainingParts >= bucketsLeft && curLen >= avgLen * 0.75) {
      bi++
      curLen = 0
    }
  }

  return buckets.map((b) => b.join('').trim()).filter(Boolean)
}

/**
 * 发送第 index 段前应等待的毫秒数（index 从 0 开始）。
 * - 第 0 段：短暂「思考」时间 400~1200ms
 * - 之后：按本段字数估算「打字」时间 + 随机抖动，封顶约 3.2s
 */
export function humanDelayBeforeSegment(segment: string, index: number): number {
  if (index === 0) {
    return 400 + Math.floor(Math.random() * 800)
  }
  const len = Array.from(segment).length
  const typing = Math.min(2200, len * 90)
  const jitter = 500 + Math.floor(Math.random() * 700)
  return Math.floor(typing * (0.5 + Math.random() * 0.5)) + jitter
}
