<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  AimOutlined,
  ClockCircleOutlined,
  MessageOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  ClearOutlined
} from '@ant-design/icons-vue'
import ReplyPipelinePanel from '../components/ReplyPipelinePanel.vue'
import { message as antMessage } from 'ant-design-vue'
import type { MonitorStatus, Message } from '../types'

const status = ref<MonitorStatus>({
  running: false,
  lastCheck: 0,
  messagesProcessed: 0,
  llmCalls: 0,
  errors: []
})
const recentMessages = ref<Message[]>([])
const contacts = ref<string[]>([])
const regionSelected = ref(false)
const regionInfo = ref('')
const selecting = ref(false)

let cleanupStatus: (() => void) | null = null
let cleanupMessage: (() => void) | null = null

const lastCheckTime = computed(() => {
  if (!status.value.lastCheck) return '从未'
  return new Date(status.value.lastCheck).toLocaleTimeString()
})

const todayMessages = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return recentMessages.value.filter((m) => m.timestamp >= today.getTime()).length
})

async function selectRegion(): Promise<void> {
  selecting.value = true
  try {
    const result = await window.wechatAPI.selectRegion()
    if (result.success && result.region) {
      regionSelected.value = true
      regionInfo.value = `${result.region.w} × ${result.region.h} px`
      antMessage.success('截图区域已设置')
    } else {
      antMessage.info('已取消选区')
    }
  } catch (err: unknown) {
    antMessage.error('选区失败: ' + (err instanceof Error ? err.message : String(err)))
  } finally {
    selecting.value = false
  }
}

async function startMonitor(): Promise<void> {
  if (!regionSelected.value) {
    antMessage.warning('请先框选截图区域')
    return
  }
  const settings = await window.wechatAPI.getSettings()
  contacts.value = settings.monitor.contacts
  const result = await window.wechatAPI.startMonitor(JSON.parse(JSON.stringify(contacts.value)))
  if (result.error) {
    antMessage.error(result.error)
  }
}

async function stopMonitor(): Promise<void> {
  await window.wechatAPI.stopMonitor()
}

async function clearRecentMessages(): Promise<void> {
  await window.wechatAPI.clearMessages()
  recentMessages.value = []
  antMessage.success('最近消息已清空')
}

async function handleToggle(): Promise<void> {
  if (status.value.running) {
    await stopMonitor()
  } else {
    if (!regionSelected.value) {
      await selectRegion()
      if (!regionSelected.value) return
    }
    await startMonitor()
  }
}

onMounted(async () => {
  status.value = await window.wechatAPI.getMonitorStatus()
  recentMessages.value = await window.wechatAPI.getMessages()
  const settings = await window.wechatAPI.getSettings()
  contacts.value = settings.monitor.contacts

  cleanupStatus = window.wechatAPI.onStatusChange((s) => {
    status.value = s as MonitorStatus
  })
  cleanupMessage = window.wechatAPI.onNewMessage((msg) => {
    recentMessages.value.push(msg as Message)
  })
})

onUnmounted(() => {
  cleanupStatus?.()
  cleanupMessage?.()
})
</script>

<template>
  <div style="padding: 28px 32px; max-width: 960px">
    <a-typography-title :level="4" style="margin-bottom: 24px">总览</a-typography-title>

    <!-- Stats -->
    <a-row :gutter="16" style="margin-bottom: 24px">
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="运行状态">
            <template #formatter>
              <a-badge
                :status="status.running ? 'processing' : 'default'"
                :text="status.running ? '运行中' : '已停止'"
              />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="今日消息" :value="todayMessages">
            <template #prefix><MessageOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="处理总数" :value="status.messagesProcessed">
            <template #prefix><ThunderboltOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="6">
        <a-card size="small">
          <a-statistic title="LLM 调用" :value="status.llmCalls">
            <template #prefix><RobotOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Monitor Control -->
    <a-card size="small" style="margin-bottom: 24px">
      <template #title>监控控制</template>
      <a-space direction="vertical" :size="12" style="width: 100%">
        <!-- Step 1: Select Region -->
        <div style="display: flex; align-items: center; gap: 12px">
          <a-button :loading="selecting" @click="selectRegion">
            <template #icon><AimOutlined /></template>
            {{ regionSelected ? '重新框选区域' : '① 框选聊天区域' }}
          </a-button>
          <span v-if="regionSelected" style="color: #52c41a; font-size: 13px">
            <CheckCircleOutlined /> 已选区 {{ regionInfo }}
          </span>
          <span v-else style="color: #8c8c8c; font-size: 13px">
            将微信聊天窗口放好后，点击框选聊天消息区域
          </span>
        </div>

        <!-- Step 2: Start/Stop -->
        <div style="display: flex; align-items: center; gap: 12px">
          <a-button
            :type="status.running ? 'default' : 'primary'"
            :danger="status.running"
            :disabled="!regionSelected && !status.running"
            @click="handleToggle"
          >
            <template #icon>
              <PauseCircleOutlined v-if="status.running" />
              <PlayCircleOutlined v-else />
            </template>
            {{ status.running ? '停止监控' : '② 开始监控' }}
          </a-button>
          <span style="color: #8c8c8c; font-size: 12px">
            <ClockCircleOutlined /> 上次检查: {{ lastCheckTime }}
            <span v-if="contacts.length" style="margin-left: 12px">
              监控联系人: {{ contacts.join(', ') }}
            </span>
          </span>
        </div>
      </a-space>
    </a-card>

    <!-- Recent Messages -->
    <a-card size="small" style="margin-bottom: 24px">
      <template #title>最近消息</template>
      <template #extra>
        <a-button type="link" size="small" danger @click="clearRecentMessages">
          <template #icon><ClearOutlined /></template>
          一键清空
        </a-button>
      </template>
      <a-empty v-if="recentMessages.length === 0" description="暂无消息记录" />
      <a-list
        v-else
        :data-source="recentMessages.slice(-10).reverse()"
        item-layout="horizontal"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #avatar>
                <a-avatar
                  :style="{
                    background: item.isFromMe ? '#52c41a' : '#1677ff',
                    fontSize: '12px'
                  }"
                  :size="32"
                >
                  {{ item.isFromMe ? '我' : item.sender.charAt(0) }}
                </a-avatar>
              </template>
              <template #title>
                <span>{{ item.isFromMe ? '我' : item.sender }}</span>
                <a-tag size="small" style="margin-left: 8px; font-size: 11px">
                  {{ item.chatName }}
                </a-tag>
              </template>
              <template #description>
                <div>
                  <div style="white-space: pre-wrap; word-break: break-word">{{ item.content }}</div>
                  <ReplyPipelinePanel
                    v-if="item.isFromMe && item.pipeline"
                    :pipeline="item.pipeline"
                  />
                </div>
              </template>
            </a-list-item-meta>
            <template #extra>
              <span style="color: #bfbfbf; font-size: 12px">
                {{ new Date(item.timestamp).toLocaleTimeString() }}
              </span>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- Errors -->
    <a-card
      v-if="status.errors.length > 0"
      size="small"
    >
      <template #title>
        <span style="color: #ff4d4f">错误日志</span>
      </template>
      <div style="max-height: 200px; overflow-y: auto">
        <a-typography-text
          v-for="(err, i) in status.errors.slice(0, 10)"
          :key="i"
          type="danger"
          style="display: block; font-size: 12px; font-family: monospace; padding: 4px 0"
        >
          {{ err }}
        </a-typography-text>
      </div>
    </a-card>
  </div>
</template>
