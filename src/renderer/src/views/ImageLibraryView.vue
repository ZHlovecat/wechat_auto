<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { message, notification } from 'ant-design-vue'
import {
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  PictureOutlined
} from '@ant-design/icons-vue'
import type { LibraryImage } from '../types'

const list = ref<LibraryImage[]>([])
const uploading = ref(false)

const totalSize = computed(() =>
  list.value.reduce((sum, item) => sum + (item.size || 0), 0)
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function imgUrl(id: string): string {
  return `wechat-img://${encodeURIComponent(id)}`
}

async function load(): Promise<void> {
  try {
    list.value = (await window.wechatAPI.getImages()) as LibraryImage[]
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载图片库失败')
  }
}

async function upload(): Promise<void> {
  uploading.value = true
  try {
    const result = await window.wechatAPI.uploadImages()
    if (result.success && result.added.length > 0) {
      await load()
      notification.success({
        message: '上传成功',
        description: `已导入 ${result.added.length} 张图片到本地图片库`,
        placement: 'topRight',
        duration: 3
      })
    }
  } catch (e) {
    message.error(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

async function rename(item: LibraryImage): Promise<void> {
  const name = prompt('图片名称', item.name)
  if (!name || name.trim() === item.name) return
  const result = await window.wechatAPI.renameImage(item.id, name.trim())
  if (result.success) {
    await load()
  } else {
    message.error(result.error || '重命名失败')
  }
}

async function remove(item: LibraryImage): Promise<void> {
  if (!confirm(`删除图片「${item.name}」？该操作不可恢复。`)) return
  const result = await window.wechatAPI.deleteImage(item.id)
  if (result.success) {
    await load()
    message.success('已删除')
  } else {
    message.error(result.error || '删除失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="img-page">
    <div class="img-toolbar">
      <div>
        <a-typography-title :level="4" class="img-title">图片库</a-typography-title>
        <a-typography-text type="secondary" class="img-subtitle">
          上传的图片会复制到本机 userData，规则中选择图片库后按顺序逐张发送。
        </a-typography-text>
      </div>
      <a-space>
        <a-typography-text type="secondary" style="font-size: 12px">
          共 {{ list.length }} 张 · {{ formatSize(totalSize) }}
        </a-typography-text>
        <a-button type="primary" :loading="uploading" @click="upload">
          <template #icon><CloudUploadOutlined /></template>
          上传图片（支持多选）
        </a-button>
      </a-space>
    </div>

    <a-card :bordered="false" class="img-card">
      <div v-if="list.length === 0" class="img-empty">
        <a-empty description="还没有图片">
          <a-button type="primary" :loading="uploading" @click="upload">
            <template #icon><PictureOutlined /></template>
            上传第一张图片
          </a-button>
        </a-empty>
      </div>
      <div v-else class="img-grid">
        <div v-for="item in list" :key="item.id" class="img-item">
          <div class="img-thumb">
            <img :src="imgUrl(item.id)" :alt="item.name" />
          </div>
          <div class="img-meta">
            <div class="img-name" :title="item.name">{{ item.name }}</div>
            <div class="img-sub">
              <span>{{ formatSize(item.size) }}</span>
              <span>{{ formatTime(item.createdAt) }}</span>
            </div>
          </div>
          <div class="img-actions">
            <a-tooltip title="重命名">
              <a-button size="small" type="text" @click="rename(item)">
                <template #icon><EditOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="删除">
              <a-button size="small" type="text" danger @click="remove(item)">
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </a-tooltip>
          </div>
        </div>
      </div>
    </a-card>
  </div>
</template>

<style scoped>
.img-page {
  padding: 24px 32px 32px;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.img-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.img-title {
  margin: 0 !important;
}
.img-subtitle {
  font-size: 12px;
  display: block;
  margin-top: 4px;
}
.img-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.img-empty {
  padding: 40px 20px;
}
.img-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 14px;
}
.img-item {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #fafafa;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.img-item:hover {
  border-color: #1677ff;
  box-shadow: 0 2px 8px rgba(22, 119, 255, 0.1);
}
.img-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.img-thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.img-meta {
  padding: 8px 10px 4px;
  min-width: 0;
}
.img-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.img-sub {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: space-between;
}
.img-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  padding: 2px 6px 6px;
}
</style>
