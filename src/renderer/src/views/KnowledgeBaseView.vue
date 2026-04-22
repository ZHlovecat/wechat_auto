<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { message, notification } from 'ant-design-vue'
import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons-vue'
import type { KnowledgeBase } from '../types'

const list = ref<KnowledgeBase[]>([])
const selectedId = ref<string>('')
const saving = ref(false)

const selected = computed(() => list.value.find((k) => k.id === selectedId.value) || null)

async function load(): Promise<void> {
  try {
    list.value = (await window.wechatAPI.getKnowledgeBases()) as KnowledgeBase[]
    if (!selectedId.value && list.value.length) selectedId.value = list.value[0].id
  } catch (e) {
    message.error(e instanceof Error ? e.message : '加载知识库失败')
  }
}

function newKB(): void {
  const kb: KnowledgeBase = {
    id: `kb_${Date.now()}`,
    name: '新知识库',
    content: '',
    updatedAt: Date.now()
  }
  list.value = [kb, ...list.value]
  selectedId.value = kb.id
}

function renameKB(kb: KnowledgeBase): void {
  const name = prompt('知识库名称', kb.name)
  if (!name) return
  kb.name = name.trim()
  kb.updatedAt = Date.now()
}

function deleteKB(id: string): void {
  const kb = list.value.find((k) => k.id === id)
  if (!kb) return
  if (!confirm(`确定删除知识库「${kb.name}」？`)) return
  list.value = list.value.filter((k) => k.id !== id)
  if (selectedId.value === id) selectedId.value = list.value[0]?.id || ''
}

function formatShortTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function save(): Promise<void> {
  saving.value = true
  try {
    const payload = JSON.parse(JSON.stringify(list.value)) as KnowledgeBase[]
    if (selected.value) {
      const cur = payload.find((k) => k.id === selectedId.value)
      if (cur) cur.updatedAt = Date.now()
    }
    const result = (await window.wechatAPI.saveKnowledgeBases(payload)) as {
      success?: boolean
      error?: string | null
    }
    if (result && result.success === false) {
      const err = result.error || '保存失败'
      message.error(err)
      notification.error({ message: '保存失败', description: err, duration: 5 })
      return
    }
    message.success('已保存到本地')
    notification.success({
      message: '知识库已保存',
      description: `共 ${payload.length} 条，数据已写入本机配置文件。`,
      placement: 'topRight',
      duration: 3
    })
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    message.error(err)
    notification.error({ message: '保存失败', description: err, duration: 5 })
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="kb-page">
    <div class="kb-toolbar">
      <a-typography-title :level="4" class="kb-title">知识库</a-typography-title>
      <a-space>
        <a-button @click="newKB">
          <template #icon><PlusOutlined /></template>
          新增
        </a-button>
        <a-button type="primary" :loading="saving" @click="save">
          <template #icon><SaveOutlined /></template>
          保存到本地
        </a-button>
      </a-space>
    </div>

    <a-card class="kb-card" :bordered="false">
      <!-- 空列表：整页单一空状态，避免左右两列重复 -->
      <div v-if="list.length === 0" class="kb-empty-wrap">
        <a-empty description="还没有知识库" />
        <a-button type="primary" @click="newKB">
          <template #icon><PlusOutlined /></template>
          创建第一个知识库
        </a-button>
        <a-typography-text type="secondary" class="kb-hint">
          编辑后点击右上角「保存到本地」，数据会写入本机（electron-store），重启应用后仍保留。
        </a-typography-text>
      </div>

      <!-- 有数据：左右分栏填满剩余高度 -->
      <div v-else class="kb-grid">
        <aside class="kb-aside">
          <div class="kb-aside-head">
            <span class="kb-aside-label">列表</span>
            <span class="kb-aside-meta">{{ list.length }} 个</span>
          </div>
          <div class="kb-list-scroll">
            <div
              v-for="kb in list"
              :key="kb.id"
              class="kb-item"
              :class="{ 'kb-item--active': kb.id === selectedId }"
              @click="selectedId = kb.id"
            >
              <div class="kb-item-row">
                <div class="kb-item-main">
                  <div class="kb-item-name" :title="kb.name">{{ kb.name }}</div>
                  <div class="kb-item-time">{{ formatShortTime(kb.updatedAt) }}</div>
                </div>
                <div class="kb-item-actions" @click.stop>
                  <a-tooltip title="重命名">
                    <a-button size="small" type="text" class="kb-item-btn" @click="renameKB(kb)">
                      <template #icon><EditOutlined /></template>
                    </a-button>
                  </a-tooltip>
                  <a-tooltip title="删除">
                    <a-button size="small" type="text" danger class="kb-item-btn" @click="deleteKB(kb.id)">
                      <template #icon><DeleteOutlined /></template>
                    </a-button>
                  </a-tooltip>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section class="kb-editor">
          <div class="kb-editor-head">
            <span class="kb-editor-label">内容</span>
            <span v-if="selected" class="kb-editor-meta">{{ selected.content.length }} 字符</span>
          </div>
          <div v-if="selected" class="kb-editor-body">
            <a-input
              v-model:value="selected.name"
              placeholder="知识库名称"
              class="kb-name-input"
              @change="selected.updatedAt = Date.now()"
            />
            <a-textarea
              v-model:value="selected.content"
              class="kb-textarea"
              placeholder="填写业务知识、话术、FAQ 等。在「规则」里为 AI 回复选择本知识库后，请求大模型会带上这些内容。"
              @change="selected.updatedAt = Date.now()"
            />
            <a-alert
              show-icon
              type="info"
              class="kb-alert"
              message="使用说明"
              description="仅在规则的「AI 智能回复」中勾选对应知识库时生效；不选则不带知识库。"
            />
          </div>
        </section>
      </div>
    </a-card>
  </div>
</template>

<style scoped>
.kb-page {
  box-sizing: border-box;
  min-height: calc(100vh - 0px);
  padding: 24px 32px 32px;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.kb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.kb-title {
  margin: 0 !important;
}

.kb-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.kb-card :deep(.ant-card-body) {
  flex: 1;
  min-height: 420px;
  display: flex;
  flex-direction: column;
  padding: 20px;
}

.kb-empty-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 360px;
  padding: 24px;
}

.kb-hint {
  max-width: 420px;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
}

.kb-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 20px;
  align-items: stretch;
}

@media (max-width: 900px) {
  .kb-grid {
    grid-template-columns: 1fr;
  }
}

.kb-aside,
.kb-editor {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.kb-aside-head,
.kb-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.kb-aside-label,
.kb-editor-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
  font-weight: 500;
}

.kb-aside-meta,
.kb-editor-meta {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.kb-list-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 列表项：不用 a-card，避免 Card 默认大内边距；整体高度压到约 44px */
.kb-item {
  cursor: pointer;
  box-sizing: border-box;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  padding: 5px 6px 5px 8px;
  background: #fafafa;
  transition: border-color 0.15s, background 0.15s;
}

.kb-item:hover {
  border-color: #d9d9d9;
  background: #fff;
}

.kb-item--active {
  border-color: #1677ff;
  background: #f0f5ff;
  box-shadow: 0 0 0 1px rgba(22, 119, 255, 0.15);
}

.kb-item-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 0;
}

.kb-item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.25;
}

.kb-item-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}

.kb-item-time {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.38);
  line-height: 1.2;
  margin-top: 1px;
}

.kb-item-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.kb-item-btn {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  padding: 0 !important;
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
}

.kb-item-btn :deep(.anticon) {
  font-size: 13px;
}

.kb-editor-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kb-name-input {
  flex-shrink: 0;
}

.kb-textarea {
  flex: 1;
  min-height: 220px;
}

.kb-textarea :deep(textarea) {
  min-height: 220px !important;
  resize: vertical;
}

.kb-alert {
  flex-shrink: 0;
}
</style>
