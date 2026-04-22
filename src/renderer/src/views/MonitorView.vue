<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { DeleteOutlined } from '@ant-design/icons-vue'
import { message as antMessage } from 'ant-design-vue'
import type { Message } from '../types'
import ReplyPipelinePanel from '../components/ReplyPipelinePanel.vue'

const messages = ref<Message[]>([])
const messagesContainer = ref<HTMLDivElement | null>(null)

let cleanupMessage: (() => void) | null = null

function scrollToBottom(): void {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

async function clearAll(): Promise<void> {
  await window.wechatAPI.clearMessages()
  messages.value = []
  antMessage.success('记录已清空')
}

onMounted(async () => {
  messages.value = await window.wechatAPI.getMessages()
  cleanupMessage = window.wechatAPI.onNewMessage((msg) => {
    messages.value.push(msg as Message)
    scrollToBottom()
  })
  scrollToBottom()
})

onUnmounted(() => {
  cleanupMessage?.()
})
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100%">
    <!-- Header -->
    <div
      style="
        padding: 16px 24px;
        background: #fff;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      "
    >
      <a-typography-title :level="5" style="margin: 0">消息监控</a-typography-title>
      <a-button type="text" danger size="small" @click="clearAll">
        <template #icon><DeleteOutlined /></template>
        清空记录
      </a-button>
    </div>

    <!-- Messages Area -->
    <div
      ref="messagesContainer"
      style="flex: 1; overflow-y: auto; padding: 16px 24px"
    >
      <a-empty
        v-if="messages.length === 0"
        description="暂无消息，开始监控后将在此显示"
        style="margin-top: 120px"
      />
      <div v-else style="display: flex; flex-direction: column; gap: 12px">
        <div
          v-for="msg in messages"
          :key="msg.id"
          style="display: flex; gap: 10px"
          :style="{ flexDirection: msg.isFromMe ? 'row-reverse' : 'row' }"
        >
          <a-avatar
            :size="36"
            :style="{
              background: msg.isFromMe ? '#52c41a' : '#1677ff',
              flexShrink: 0,
              fontSize: '13px'
            }"
          >
            {{ msg.isFromMe ? '我' : msg.sender.charAt(0) }}
          </a-avatar>
          <div style="max-width: 65%">
            <div
              style="
                display: flex;
                align-items: center;
                gap: 6px;
                margin-bottom: 4px;
                font-size: 12px;
                color: #8c8c8c;
              "
              :style="{ flexDirection: msg.isFromMe ? 'row-reverse' : 'row' }"
            >
              <span style="font-weight: 500; color: #595959">
                {{ msg.isFromMe ? '我' : msg.sender }}
              </span>
              <span>{{ new Date(msg.timestamp).toLocaleTimeString() }}</span>
              <a-tag :bordered="false" color="default" style="font-size: 11px; margin: 0">
                {{ msg.chatName }}
              </a-tag>
            </div>
            <div
              :style="{
                display: 'inline-block',
                padding: '8px 14px',
                borderRadius: msg.isFromMe ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                background: msg.isFromMe ? '#52c41a' : '#fff',
                color: msg.isFromMe ? '#fff' : '#262626',
                fontSize: '14px',
                lineHeight: '1.6',
                boxShadow: msg.isFromMe ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
                wordBreak: 'break-word'
              }"
            >
              {{ msg.content }}
            </div>
            <ReplyPipelinePanel
              v-if="msg.isFromMe && msg.pipeline"
              :pipeline="msg.pipeline"
              class="msg-pipeline"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
