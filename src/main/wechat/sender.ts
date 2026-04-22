import { runAppleScript, Scripts } from './applescript'
import { splitIntoSegments, humanDelayBeforeSegment } from './splitReply'

export class WeChatSender {
  async activate(): Promise<void> {
    await runAppleScript(Scripts.activate)
  }

  async navigateToChat(chatName: string): Promise<void> {
    await runAppleScript(Scripts.navigateToChat(chatName))
  }

  async sendMessage(chatName: string, text: string): Promise<void> {
    await this.navigateToChat(chatName)
    await new Promise((r) => setTimeout(r, 300))
    await runAppleScript(Scripts.sendMessage(text), this.typingTimeoutMs(text))
  }

  async sendImage(chatName: string, imagePath: string): Promise<void> {
    await runAppleScript(Scripts.copyImageToClipboard(imagePath))
    await new Promise((r) => setTimeout(r, 300))
    await this.navigateToChat(chatName)
    await new Promise((r) => setTimeout(r, 300))
    await runAppleScript(Scripts.sendImageFromClipboard())
  }

  async sendMessageDirect(text: string): Promise<void> {
    await runAppleScript(Scripts.sendMessage(text), this.typingTimeoutMs(text))
  }

  /**
   * 将一段回复按自然语义切成 1~3 段，模拟真人分条发送（含思考/打字延迟）。
   * 调用前需确保会话窗口已聚焦（例如先调用 activate / navigateToChat）。
   */
  async sendSegmentedDirect(text: string): Promise<string[]> {
    const segments = splitIntoSegments(text)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const delay = humanDelayBeforeSegment(seg, i)
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      await runAppleScript(Scripts.sendMessage(seg), this.typingTimeoutMs(seg))
    }
    return segments
  }

  /** 逐字符粘贴平均 ~120ms/字，预留 5s 余量，最小 15s、最大 120s */
  private typingTimeoutMs(text: string): number {
    const chars = Array.from(text).length
    return Math.min(120000, Math.max(15000, chars * 220 + 5000))
  }
}

export const wechatSender = new WeChatSender()
