<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  HolderOutlined,
  PictureOutlined
} from '@ant-design/icons-vue'
import { message as antMessage } from 'ant-design-vue'
import type { AutoReplyRule, KnowledgeBase, LibraryImage } from '../types'

function imgUrl(id: string): string {
  return `wechat-img://${encodeURIComponent(id)}`
}

const rules = ref<AutoReplyRule[]>([])
const editingRule = ref<AutoReplyRule | null>(null)
const modalVisible = ref(false)
const saving = ref(false)
const contactInput = ref('')
const kbs = ref<KnowledgeBase[]>([])
const images = ref<LibraryImage[]>([])

const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const kbOptions = computed(() => [
  { value: '', label: '不使用知识库（可选）' },
  ...kbs.value.map((k) => ({ value: k.id, label: k.name }))
])

const triggerOptions = [
  { value: 'all', label: '所有消息' },
  { value: 'keyword', label: '关键词匹配' }
]

const actionOptions = [
  { value: 'llm', label: 'AI 智能回复' },
  { value: 'favorites', label: '发送收藏地址' },
  { value: 'image', label: '发送图片（支持多张）' }
]

function getTriggerLabel(type: string): string {
  return triggerOptions.find((t) => t.value === type)?.label || type
}
function getActionLabel(type: string): string {
  return actionOptions.find((a) => a.value === type)?.label || type
}

async function loadRules(): Promise<void> {
  rules.value = (await window.wechatAPI.getRules()) as AutoReplyRule[]
}

async function loadKBs(): Promise<void> {
  kbs.value = (await window.wechatAPI.getKnowledgeBases()) as KnowledgeBase[]
}

async function loadImages(): Promise<void> {
  images.value = (await window.wechatAPI.getImages()) as LibraryImage[]
}

function openEditor(rule?: AutoReplyRule): void {
  editingRule.value = rule
    ? JSON.parse(JSON.stringify(rule))
    : {
        id: `rule_${Date.now()}`,
        name: '新规则',
        enabled: true,
        contacts: [],
        trigger: { type: 'all' },
        action: {
          type: 'llm',
          systemPrompt: '你是一个友好的微信聊天助手，请用简洁自然的中文回复。',
          knowledgeBaseId: ''
        },
        cooldown: 5
      }
  // 向后兼容：旧版 favorites 规则没有 favoritesMode/favoritesKeywords 字段
  const er = editingRule.value
  if (er?.action?.type === 'favorites') {
    if (!er.action.favoritesMode) er.action.favoritesMode = 'default'
    if (!er.action.favoritesKeywords) er.action.favoritesKeywords = []
  }
  // 编辑已有图片规则时同步刷新图片库
  if (rule?.action?.type === 'image') loadImages()
}

async function saveRule(): Promise<void> {
  if (!editingRule.value || !editingRule.value.name.trim()) return
  saving.value = true

  // favorites-search 关键词清洗（输入时保留空串给光标体验，保存时再 trim+去空）
  if (
    editingRule.value.action.type === 'favorites' &&
    editingRule.value.action.favoritesMode === 'search'
  ) {
    editingRule.value.action.favoritesKeywords = (editingRule.value.action.favoritesKeywords || [])
      .map((s) => (s || '').trim())
      .filter(Boolean)
  }

  const idx = rules.value.findIndex((r) => r.id === editingRule.value!.id)
  if (idx >= 0) {
    rules.value[idx] = editingRule.value
  } else {
    rules.value.push(editingRule.value)
  }

  await window.wechatAPI.saveRules(JSON.parse(JSON.stringify(rules.value)))
  modalVisible.value = false
  editingRule.value = null
  saving.value = false
  antMessage.success('规则已保存')
}

async function deleteRule(id: string): Promise<void> {
  rules.value = rules.value.filter((r) => r.id !== id)
  await window.wechatAPI.saveRules(JSON.parse(JSON.stringify(rules.value)))
  antMessage.success('规则已删除')
}

async function toggleRule(rule: AutoReplyRule): Promise<void> {
  rule.enabled = !rule.enabled
  await window.wechatAPI.saveRules(JSON.parse(JSON.stringify(rules.value)))
}

function addContact(): void {
  if (!editingRule.value || !contactInput.value.trim()) return
  if (!editingRule.value.contacts.includes(contactInput.value.trim())) {
    editingRule.value.contacts.push(contactInput.value.trim())
  }
  contactInput.value = ''
}

function removeContact(idx: number): void {
  editingRule.value?.contacts.splice(idx, 1)
}

async function onActionTypeChange(v: string): Promise<void> {
  const er = editingRule.value
  if (!er?.action) return
  if (v === 'image') {
    await loadImages()
    if (!er.action.imageIds) er.action.imageIds = []
  }
  if (v === 'favorites') {
    if (er.action.maxFavorites == null || er.action.maxFavorites < 1) {
      er.action.maxFavorites = 20
    }
    if (er.action.prefaceTemplate == null) {
      er.action.prefaceTemplate = '目前在招的门店位置，你看下哪个离你比较近？'
    }
    if (!er.action.favoritesMode) er.action.favoritesMode = 'default'
    if (!er.action.favoritesKeywords) er.action.favoritesKeywords = []
  }
}

// favorites-search 关键词双向绑定：存储为数组，输入框显示为「逗号分隔文本」
// 输入时不做 filter(Boolean)，避免光标跳回；保存时再清洗（见 saveRule）
const favoritesKeywordsText = computed({
  get(): string {
    return (editingRule.value?.action?.favoritesKeywords || []).join(',')
  },
  set(text: string) {
    const er = editingRule.value
    if (!er?.action) return
    er.action.favoritesKeywords = text.split(/[,，]/).map((s) => s.trim())
  }
})

const favoritesModeOptions = [
  { value: 'default', label: '默认（按收藏顺序发送前 N 条）' },
  { value: 'search', label: '按关键词搜索发送（每个关键词发一条）' }
]

function toggleImageSelected(id: string): void {
  const er = editingRule.value
  if (!er?.action) return
  const ids = er.action.imageIds || []
  const idx = ids.indexOf(id)
  if (idx >= 0) {
    ids.splice(idx, 1)
  } else {
    ids.push(id)
  }
  er.action.imageIds = [...ids]
}

function moveSelectedImage(index: number, dir: -1 | 1): void {
  const er = editingRule.value
  if (!er?.action?.imageIds) return
  const next = index + dir
  if (next < 0 || next >= er.action.imageIds.length) return
  const arr = [...er.action.imageIds]
  const [it] = arr.splice(index, 1)
  arr.splice(next, 0, it)
  er.action.imageIds = arr
}

function getImageName(id: string): string {
  return images.value.find((i) => i.id === id)?.name || `(已删除: ${id})`
}

function imageExists(id: string): boolean {
  return !!images.value.find((i) => i.id === id)
}

async function openModal(rule?: AutoReplyRule): Promise<void> {
  openEditor(rule)
  if (rule?.action?.type === 'image' || !rule) {
    await loadImages()
  }
  modalVisible.value = true
}

// ---------- 拖拽排序 ----------
function onDragStart(e: DragEvent, idx: number): void {
  dragIndex.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function onDragOver(e: DragEvent, idx: number): void {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOverIndex.value = idx
}

function onDragLeave(): void {
  dragOverIndex.value = null
}

async function onDrop(e: DragEvent, idx: number): Promise<void> {
  e.preventDefault()
  const from = dragIndex.value
  dragIndex.value = null
  dragOverIndex.value = null
  if (from === null || from === idx) return
  const arr = [...rules.value]
  const [moved] = arr.splice(from, 1)
  arr.splice(idx, 0, moved)
  rules.value = arr
  await window.wechatAPI.saveRules(JSON.parse(JSON.stringify(rules.value)))
}

function onDragEnd(): void {
  dragIndex.value = null
  dragOverIndex.value = null
}

onMounted(() => {
  loadRules()
  loadKBs()
  loadImages()
})
</script>

<template>
  <div style="padding: 28px 32px; max-width: 960px">
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px">
      <a-typography-title :level="4" style="margin: 0">自动回复规则</a-typography-title>
      <a-button type="primary" @click="openModal()">
        <template #icon><PlusOutlined /></template>
        添加规则
      </a-button>
    </div>
    <a-typography-text type="secondary" style="font-size: 12px; display: block; margin-bottom: 20px">
      拖动左侧把手调整顺序 · 靠上的规则优先级更高（先评估）
    </a-typography-text>

    <!-- Empty State -->
    <a-card v-if="rules.length === 0">
      <a-empty description="还没有创建任何自动回复规则">
        <a-button type="primary" @click="openModal()">创建第一个规则</a-button>
      </a-empty>
    </a-card>

    <!-- Rules List -->
    <div v-else style="display: flex; flex-direction: column; gap: 12px">
      <div
        v-for="(rule, idx) in rules"
        :key="rule.id"
        class="rule-row"
        :class="{ 'rule-row--drag-over': dragOverIndex === idx, 'rule-row--dragging': dragIndex === idx }"
        draggable="true"
        @dragstart="onDragStart($event, idx)"
        @dragover="onDragOver($event, idx)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, idx)"
        @dragend="onDragEnd"
      >
        <a-card size="small" hoverable :bordered="true" class="rule-card">
          <div style="display: flex; align-items: center; gap: 12px">
            <span class="drag-handle" title="拖动调整优先级">
              <HolderOutlined />
            </span>
            <span class="rule-index">{{ idx + 1 }}</span>
            <a-switch
              :checked="rule.enabled"
              size="small"
              @change="toggleRule(rule)"
            />
            <div style="flex: 1; min-width: 0">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
                <a-typography-text strong>{{ rule.name }}</a-typography-text>
                <a-tag color="blue">{{ getTriggerLabel(rule.trigger.type) }}</a-tag>
                <a-tag color="green">{{ getActionLabel(rule.action.type) }}</a-tag>
                <a-tag
                  v-if="rule.action.type === 'image' && rule.action.imageIds?.length"
                  color="purple"
                >
                  {{ rule.action.imageIds.length }} 张图
                </a-tag>
              </div>
              <a-typography-text type="secondary" style="font-size: 12px">
                <span v-if="rule.contacts.length">联系人: {{ rule.contacts.join(', ') }}</span>
                <span v-else>所有聊天</span>
                <a-divider type="vertical" />
                冷却: {{ rule.cooldown }}s
                <template v-if="rule.trigger.value">
                  <a-divider type="vertical" />
                  关键词: {{ rule.trigger.value }}
                </template>
              </a-typography-text>
            </div>
            <a-space>
              <a-tooltip title="编辑">
                <a-button type="text" size="small" @click="openModal(rule)">
                  <template #icon><EditOutlined /></template>
                </a-button>
              </a-tooltip>
              <a-popconfirm
                title="确定删除这条规则？"
                ok-text="删除"
                cancel-text="取消"
                @confirm="deleteRule(rule.id)"
              >
                <a-tooltip title="删除">
                  <a-button type="text" size="small" danger>
                    <template #icon><DeleteOutlined /></template>
                  </a-button>
                </a-tooltip>
              </a-popconfirm>
            </a-space>
          </div>
        </a-card>
      </div>
    </div>

    <!-- Edit Modal -->
    <a-modal
      v-model:open="modalVisible"
      :title="editingRule && rules.find((r) => r.id === editingRule?.id) ? '编辑规则' : '新建规则'"
      :confirm-loading="saving"
      ok-text="保存"
      cancel-text="取消"
      :width="600"
      @ok="saveRule"
    >
      <a-form v-if="editingRule" layout="vertical" style="margin-top: 16px">
        <a-form-item label="规则名称">
          <a-input v-model:value="editingRule.name" placeholder="输入规则名称" />
        </a-form-item>

        <a-form-item label="适用联系人（留空 = 所有聊天）">
          <div style="display: flex; gap: 8px; margin-bottom: 8px">
            <a-input
              v-model:value="contactInput"
              placeholder="输入联系人/群名"
              style="flex: 1"
              @press-enter="addContact"
            />
            <a-button @click="addContact">添加</a-button>
          </div>
          <div v-if="editingRule.contacts.length" style="display: flex; flex-wrap: wrap; gap: 6px">
            <a-tag
              v-for="(c, i) in editingRule.contacts"
              :key="i"
              closable
              @close="removeContact(i)"
            >
              {{ c }}
            </a-tag>
          </div>
        </a-form-item>

        <a-form-item label="触发条件">
          <a-select v-model:value="editingRule.trigger.type" :options="triggerOptions" />
          <a-input
            v-if="editingRule.trigger.type === 'keyword'"
            v-model:value="editingRule.trigger.value"
            placeholder="输入关键词（对方消息包含该关键词即触发）"
            style="margin-top: 8px"
          />
        </a-form-item>

        <a-form-item label="回复方式">
          <a-select
            v-model:value="editingRule.action.type"
            :options="actionOptions"
            @change="onActionTypeChange"
          />

          <a-textarea
            v-if="editingRule.action.type === 'llm'"
            v-model:value="editingRule.action.systemPrompt"
            :rows="3"
            placeholder="系统提示词（定义 AI 回复的角色和风格）"
            style="margin-top: 8px"
          />

          <a-select
            v-if="editingRule.action.type === 'llm'"
            v-model:value="editingRule.action.knowledgeBaseId"
            :options="kbOptions"
            style="margin-top: 8px"
            placeholder="选择知识库（可选）"
            allow-clear
          />

          <!-- 发送收藏地址：可选引导语 + 收藏方式（默认 / 搜索关键词） -->
          <div v-if="editingRule.action.type === 'favorites'" style="margin-top: 10px">
            <div class="rule-section-label">引导语（可选，留空则只发收藏）</div>
            <a-textarea
              v-model:value="editingRule.action.prefaceTemplate"
              :rows="3"
              placeholder="支持变量 {sender} {content} {time}。示例：目前在招的门店位置，你看下哪个离你比较近？"
            />

            <div class="rule-section-label" style="margin-top: 14px">收藏方式</div>
            <a-radio-group
              v-model:value="editingRule.action.favoritesMode"
              :options="favoritesModeOptions"
            />

            <div
              v-if="(editingRule.action.favoritesMode || 'default') === 'default'"
              style="margin-top: 10px; display: flex; align-items: center; gap: 12px"
            >
              <span style="color: rgba(0,0,0,0.65); font-size: 13px">收藏最多发送条数</span>
              <a-input-number
                v-model:value="editingRule.action.maxFavorites"
                :min="1"
                :max="50"
              />
            </div>

            <div v-else style="margin-top: 10px">
              <div class="rule-section-label">
                搜索关键词（多个用英文逗号分隔；每个关键词会打开收藏→搜索→勾选第一条→发送，无结果则跳过）
              </div>
              <a-textarea
                v-model:value="favoritesKeywordsText"
                :rows="3"
                placeholder="例如：清河万象汇,合生汇,世纪金源"
              />
              <div
                v-if="(editingRule.action.favoritesKeywords || []).filter((k) => k.trim()).length > 0"
                style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px"
              >
                <a-tag
                  v-for="(kw, i) in (editingRule.action.favoritesKeywords || []).filter((k) => k.trim())"
                  :key="i"
                  color="blue"
                >
                  {{ kw }}
                </a-tag>
              </div>
            </div>

            <a-alert
              type="warning"
              show-icon
              style="margin-top: 10px"
              message="自动化说明"
              :description="
                (editingRule.action.favoritesMode || 'default') === 'search'
                  ? '触发后先发送引导语（若填写），再对每个关键词依次「打开收藏 → 在搜索框输入关键词 → 勾选第一条 → 发送」；关键词无结果则自动跳过。请在「系统设置 → 隐私与安全性 → 辅助功能」中为「微信」和 Electron 开启权限。'
                  : '触发后先发送引导语（若填写），再通过 AppleScript / 视觉定位打开聊天工具栏「收藏」，在弹出列表中勾选前 N 条地址并发送。请在「系统设置 → 隐私与安全性 → 辅助功能」中为「微信」和 Electron 开启权限。不同微信版本 UI 可能略有差异。'
              "
            />
          </div>

          <!-- 图片库多选 -->
          <div v-if="editingRule.action.type === 'image'" style="margin-top: 10px">
            <a-alert
              v-if="images.length === 0"
              type="warning"
              show-icon
              message="图片库为空"
              description="请先前往「图片库」页面上传门店图片，再回到这里选择。"
              style="margin-bottom: 10px"
            />
            <template v-else>
              <div class="rule-section-label">
                可选图片（点击选中，按点击顺序发送）
              </div>
              <div class="image-picker-grid">
                <div
                  v-for="img in images"
                  :key="img.id"
                  class="image-picker-item"
                  :class="{
                    'image-picker-item--selected':
                      (editingRule.action.imageIds || []).includes(img.id)
                  }"
                  @click="toggleImageSelected(img.id)"
                >
                  <img :src="imgUrl(img.id)" :alt="img.name" />
                  <div class="image-picker-name" :title="img.name">{{ img.name }}</div>
                  <div
                    v-if="(editingRule.action.imageIds || []).indexOf(img.id) >= 0"
                    class="image-picker-badge"
                  >
                    {{ (editingRule.action.imageIds || []).indexOf(img.id) + 1 }}
                  </div>
                </div>
              </div>
            </template>

            <div
              v-if="(editingRule.action.imageIds || []).length > 0"
              style="margin-top: 14px"
            >
              <div class="rule-section-label">
                已选 {{ editingRule.action.imageIds?.length }} 张 · 发送顺序
              </div>
              <div class="selected-list">
                <div
                  v-for="(id, i) in editingRule.action.imageIds || []"
                  :key="id"
                  class="selected-row"
                >
                  <span class="selected-index">{{ i + 1 }}</span>
                  <img
                    v-if="imageExists(id)"
                    :src="imgUrl(id)"
                    class="selected-thumb"
                    :alt="getImageName(id)"
                  />
                  <span class="selected-name" :title="getImageName(id)">
                    {{ getImageName(id) }}
                  </span>
                  <a-button
                    size="small"
                    type="text"
                    :disabled="i === 0"
                    @click="moveSelectedImage(i, -1)"
                  >
                    上移
                  </a-button>
                  <a-button
                    size="small"
                    type="text"
                    :disabled="i === (editingRule.action.imageIds?.length ?? 0) - 1"
                    @click="moveSelectedImage(i, 1)"
                  >
                    下移
                  </a-button>
                  <a-button size="small" type="text" danger @click="toggleImageSelected(id)">
                    移除
                  </a-button>
                </div>
              </div>
            </div>

            <a-typography-text
              type="secondary"
              style="display: block; margin-top: 10px; font-size: 12px"
            >
              <PictureOutlined />
              规则触发后，会按上方列表顺序，将所有图片粘贴到当前聊天窗口依次发送（每张间隔约 1.2s）。
            </a-typography-text>
          </div>

        </a-form-item>

        <a-form-item label="冷却时间（秒）">
          <a-input-number v-model:value="editingRule.cooldown" :min="0" :max="3600" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.rule-row {
  transition: transform 0.15s, opacity 0.15s;
}
.rule-row--dragging {
  opacity: 0.4;
}
.rule-row--drag-over .rule-card {
  border-color: #1677ff !important;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.15);
}
.drag-handle {
  cursor: grab;
  color: rgba(0, 0, 0, 0.35);
  font-size: 18px;
  display: inline-flex;
  align-items: center;
  padding: 2px 4px;
}
.drag-handle:active {
  cursor: grabbing;
}
.rule-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 11px;
  background: #f0f5ff;
  color: #1677ff;
  font-size: 12px;
  font-weight: 600;
}
.rule-section-label {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  margin-bottom: 6px;
}
.image-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
  max-height: 240px;
  overflow-y: auto;
  padding: 2px;
}
.image-picker-item {
  position: relative;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  background: #fafafa;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.image-picker-item:hover {
  border-color: #1677ff;
}
.image-picker-item--selected {
  border-color: #1677ff;
  box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.18);
}
.image-picker-item img {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: contain;
  background: #fff;
  display: block;
}
.image-picker-name {
  padding: 4px 6px;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.image-picker-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  background: #1677ff;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.selected-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px dashed #e8e8e8;
  border-radius: 6px;
  background: #fafafa;
}
.selected-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fff;
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  padding: 4px 6px;
}
.selected-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  background: #1677ff;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.selected-thumb {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}
.selected-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
