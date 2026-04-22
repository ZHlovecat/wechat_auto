<script setup lang="ts">
import type { MessagePipeline } from '../types'

defineProps<{
  pipeline: MessagePipeline
}>()
</script>

<template>
  <a-collapse ghost class="pipeline-collapse">
    <a-collapse-panel key="p">
      <template #header>
        <span style="font-size: 12px; color: #595959">后台回复逻辑：读取 → 规划 → 执行 → 校验</span>
      </template>
      <a-descriptions :column="1" size="small" bordered>
        <a-descriptions-item label="① 读取屏幕">
          <span class="pipeline-text">{{ pipeline.read }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="② 任务规划">
          <span class="pipeline-text">{{ pipeline.plan }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="③ 执行（发送内容）">
          <span class="pipeline-text">{{ pipeline.execute }}</span>
        </a-descriptions-item>
        <a-descriptions-item label="④ 校验">
          <span class="pipeline-text">{{ pipeline.verify }}</span>
        </a-descriptions-item>
      </a-descriptions>
    </a-collapse-panel>
  </a-collapse>
</template>

<style scoped>
.pipeline-collapse {
  margin-top: 8px;
  max-width: 100%;
}
.pipeline-text {
  font-size: 12px;
  color: #262626;
  white-space: pre-wrap;
  word-break: break-word;
}
:deep(.ant-collapse-header) {
  padding: 4px 0 !important;
  align-items: flex-start !important;
}
:deep(.ant-collapse-content-box) {
  padding-top: 8px !important;
}
</style>
