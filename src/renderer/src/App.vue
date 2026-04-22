<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  HomeOutlined,
  MessageOutlined,
  ControlOutlined,
  BookOutlined,
  PictureOutlined,
  SettingOutlined
} from '@ant-design/icons-vue'
import type { MonitorStatus } from './types'

const router = useRouter()
const route = useRoute()

const status = ref<MonitorStatus>({
  running: false,
  lastCheck: 0,
  messagesProcessed: 0,
  llmCalls: 0,
  errors: []
})

let cleanupStatus: (() => void) | null = null

const selectedKeys = computed(() => [route.path])

const menuItems = [
  { key: '/', label: '总览', icon: HomeOutlined },
  { key: '/monitor', label: '消息', icon: MessageOutlined },
  { key: '/rules', label: '规则', icon: ControlOutlined },
  { key: '/kb', label: '知识库', icon: BookOutlined },
  { key: '/images', label: '图片库', icon: PictureOutlined },
  { key: '/settings', label: '设置', icon: SettingOutlined }
]

function onMenuSelect({ key }: { key: string }): void {
  router.push(key)
}

onMounted(() => {
  cleanupStatus = window.wechatAPI.onStatusChange((s) => {
    status.value = s as MonitorStatus
  })
  window.wechatAPI.getMonitorStatus().then((s) => {
    status.value = s
  })
})

onUnmounted(() => {
  cleanupStatus?.()
})
</script>

<template>
  <a-layout style="height: 100vh">
    <a-layout-sider
      :width="200"
      theme="dark"
      style="padding-top: 38px; user-select: none"
      class="drag-region"
    >
      <div class="no-drag" style="padding: 12px 20px 16px">
        <div style="color: #fff; font-size: 17px; font-weight: 600; letter-spacing: 0.5px">
          WeChat 助手
        </div>
        <div style="display: flex; align-items: center; gap: 6px; margin-top: 6px">
          <span
            :style="{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: status.running ? '#52c41a' : '#8c8c8c'
            }"
          ></span>
          <span style="color: #8c8c8c; font-size: 12px">
            {{ status.running ? '监控中' : '已停止' }}
          </span>
        </div>
      </div>

      <a-menu
        :selected-keys="selectedKeys"
        mode="inline"
        theme="dark"
        class="no-drag"
        style="border-right: none"
        @select="onMenuSelect"
      >
        <a-menu-item v-for="item in menuItems" :key="item.key">
          <component :is="item.icon" />
          <span>{{ item.label }}</span>
        </a-menu-item>
      </a-menu>

      <div
        class="no-drag"
        style="
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 12px 20px;
          border-top: 1px solid #303030;
          color: #595959;
          font-size: 11px;
        "
      >
        v1.0.0
      </div>
    </a-layout-sider>

    <a-layout>
      <a-layout-content style="overflow-y: auto; background: #f5f5f5">
        <router-view />
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
:deep(.ant-menu-dark) {
  background: transparent;
}
:deep(.ant-layout-sider) {
  background: #1f1f1f;
}
</style>
