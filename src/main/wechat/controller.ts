import { wechatMonitor, WeChatMonitor } from './monitor'
import { wechatSender, WeChatSender } from './sender'

export class WeChatController {
  monitor: WeChatMonitor
  sender: WeChatSender

  constructor() {
    this.monitor = wechatMonitor
    this.sender = wechatSender
  }

  async activate(): Promise<void> {
    await this.sender.activate()
  }

  async sendMessage(chatName: string, text: string): Promise<void> {
    await this.sender.sendMessage(chatName, text)
  }

  async sendImage(chatName: string, imagePath: string): Promise<void> {
    await this.sender.sendImage(chatName, imagePath)
  }

  startMonitor(contacts: string[]): void {
    this.monitor.setWatchList(contacts)
    this.monitor.start()
  }

  stopMonitor(): void {
    this.monitor.stop()
  }
}

export const wechatController = new WeChatController()
