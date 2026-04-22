/**
 * 固定：AI 自动回复必须按「读取 → 规划 → 执行 → 校验」输出结构化 JSON，
 * 与设置页中的「角色」提示词组合使用（知识库等仍由调用方拼在 system 里）。
 */
export const PIPELINE_JSON_INSTRUCTION = `你必须按以下流程处理每一次回复任务，并在输出中只返回一段 JSON（不要 Markdown 代码块、不要额外说明），格式严格如下：
{
  "read": "读取屏幕/对话后的要点（1-4 句，说明已理解对方说什么）",
  "plan": "任务规划：回复目标、注意事项、是否引用知识（1-4 句）",
  "reply": "最终要发给对方的中文消息正文（仅此内容会出现在微信输入框；简洁自然）",
  "verify": "自检：礼貌性、是否跑题、是否与知识库/上下文一致（1-3 句）"
}
要求：reply 必须是完整可直接发送的一段话；不要包含 JSON 以外的任何字符。`

export function buildPipelineSystemPrompt(rolePrompt: string): string {
  return `${rolePrompt.trim()}\n\n${PIPELINE_JSON_INSTRUCTION}`
}

export interface PipelineJson {
  read: string
  plan: string
  reply: string
  verify: string
}
