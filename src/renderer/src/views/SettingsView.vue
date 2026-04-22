<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  ApiOutlined,
  EyeOutlined,
  PlusOutlined,
  CheckCircleOutlined
} from '@ant-design/icons-vue'
import { message as antMessage } from 'ant-design-vue'
import type { AppSettings } from '../types'

function stripProxy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

const settings = ref<AppSettings>({
  llm: {
    apiKey: '',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5v-turbo',
    systemPrompt: '你是一个微信聊天助手。你会看到微信聊天窗口的截图，需要判断是否有新消息需要回复，并给出合适的回复。回复要简洁自然，像真人聊天一样。',
    temperature: 0.7
  },
  monitor: {
    contacts: [],
    pollingInterval: 3000,
    enabled: false
  }
})

const saving = ref(false)
const testing = ref(false)
const testResult = ref('')
const testError = ref('')
const contactInput = ref('')

async function loadSettings(): Promise<void> {
  settings.value = await window.wechatAPI.getSettings()
}

async function saveSettings(): Promise<void> {
  saving.value = true
  try {
    await window.wechatAPI.updateSettings(stripProxy(settings.value))
    antMessage.success('设置已保存')
  } catch (err: unknown) {
    antMessage.error('保存失败: ' + (err instanceof Error ? err.message : String(err)))
  } finally {
    saving.value = false
  }
}

async function testConnection(): Promise<void> {
  testing.value = true
  testResult.value = ''
  testError.value = ''
  try {
    await window.wechatAPI.updateSettings(stripProxy(settings.value))
    const result = await window.wechatAPI.testLLM()
    if (result.success) {
      testResult.value = result.reply
    } else {
      testError.value = (result as { error?: string }).error || '未知错误'
    }
  } catch (err: unknown) {
    testError.value = err instanceof Error ? err.message : String(err)
  } finally {
    testing.value = false
  }
}

function addContact(): void {
  if (!contactInput.value.trim()) return
  if (!settings.value.monitor.contacts.includes(contactInput.value.trim())) {
    settings.value.monitor.contacts.push(contactInput.value.trim())
  }
  contactInput.value = ''
}

function removeContact(idx: number): void {
  settings.value.monitor.contacts.splice(idx, 1)
}

const pollingMarks = {
  1000: '1s',
  3000: '3s',
  5000: '5s',
  10000: '10s',
  15000: '15s'
}

onMounted(loadSettings)
</script>

<template>
  <div style="padding: 28px 32px; max-width: 720px">
    <a-typography-title :level="4" style="margin-bottom: 24px">设置</a-typography-title>

    <!-- LLM Settings -->
    <a-card style="margin-bottom: 20px">
      <template #title>
        <ApiOutlined /> 模型配置 · GLM-5V-Turbo
      </template>

      <a-alert
        type="info"
        show-icon
        style="margin-bottom: 16px"
        message="本应用已固定接入智谱 GLM-5V-Turbo 多模态模型"
        description="GLM-5V-Turbo 负责「看懂环境 → 规划动作 → 执行任务」：既用于识别聊天截图、生成回复，也用于在 AppleScript 无法定位「收藏」等控件时通过视觉坐标模拟点击。你只需要在这里填写智谱开放平台的 API Key 即可。"
      />

      <a-form layout="vertical">
        <a-form-item label="智谱 API Key">
          <a-input-password
            v-model:value="settings.llm.apiKey"
            placeholder="在 https://open.bigmodel.cn 控制台获取"
          />
          <template #help>
            API 调用地址固定为 https://open.bigmodel.cn/api/paas/v4，模型固定为 glm-5v-turbo。
          </template>
        </a-form-item>

        <a-form-item :label="`Temperature (${settings.llm.temperature})`">
          <a-slider
            v-model:value="settings.llm.temperature"
            :min="0"
            :max="1"
            :step="0.1"
          />
        </a-form-item>

        <a-form-item label="默认系统提示词">
          <a-textarea
            v-model:value="settings.llm.systemPrompt"
            :rows="3"
            placeholder="输入系统提示词..."
          />
        </a-form-item>

        <a-form-item>
          <a-button
            :loading="testing"
            :disabled="!settings.llm.apiKey"
            @click="testConnection"
          >
            <template #icon><ApiOutlined /></template>
            测试连接
          </a-button>
        </a-form-item>

        <a-alert
          v-if="testResult"
          type="success"
          show-icon
          style="margin-bottom: 0"
        >
          <template #message>连接成功</template>
          <template #description>{{ testResult }}</template>
        </a-alert>
        <a-alert
          v-if="testError"
          type="error"
          show-icon
          style="margin-bottom: 0"
        >
          <template #message>连接失败</template>
          <template #description>{{ testError }}</template>
        </a-alert>
      </a-form>
    </a-card>

    <!-- Monitor Settings -->
    <a-card style="margin-bottom: 20px">
      <template #title>
        <EyeOutlined /> 监控配置
      </template>

      <a-form layout="vertical">
        <a-form-item>
          <template #label>
            监控联系人/群
            <a-typography-text type="secondary" style="font-size: 12px; margin-left: 4px">
              （留空 = 不自动监控）
            </a-typography-text>
          </template>
          <div style="display: flex; gap: 8px; margin-bottom: 10px">
            <a-input
              v-model:value="contactInput"
              placeholder="输入联系人昵称或群名"
              style="flex: 1"
              @press-enter="addContact"
            />
            <a-button @click="addContact">
              <template #icon><PlusOutlined /></template>
              添加
            </a-button>
          </div>
          <div v-if="settings.monitor.contacts.length" style="display: flex; flex-wrap: wrap; gap: 6px">
            <a-tag
              v-for="(c, i) in settings.monitor.contacts"
              :key="i"
              closable
              color="blue"
              @close="removeContact(i)"
            >
              {{ c }}
            </a-tag>
          </div>
          <a-typography-text v-else type="secondary" style="font-size: 12px">
            未添加任何监控联系人
          </a-typography-text>
        </a-form-item>

        <a-form-item :label="`轮询间隔 (${settings.monitor.pollingInterval / 1000} 秒)`">
          <a-slider
            v-model:value="settings.monitor.pollingInterval"
            :min="1000"
            :max="15000"
            :step="500"
            :marks="pollingMarks"
          />
        </a-form-item>
      </a-form>
    </a-card>

    <!-- Save -->
    <a-button
      type="primary"
      size="large"
      :loading="saving"
      block
      @click="saveSettings"
    >
      <template #icon><CheckCircleOutlined /></template>
      保存设置
    </a-button>
  </div>
</template>
