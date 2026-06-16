<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{ files: [File[]] }>()
const { t } = useI18n()

const inputEl = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

function emitFiles(list: FileList | null): void {
  if (!list || list.length === 0) return
  emit('files', Array.from(list))
}

function onChange(e: Event): void {
  const input = e.target as HTMLInputElement
  emitFiles(input.files)
  input.value = '' // allow re-selecting the same file
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  emitFiles(e.dataTransfer?.files ?? null)
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ 'is-over': dragOver }"
    role="button"
    tabindex="0"
    @click="inputEl?.click()"
    @keydown.enter="inputEl?.click()"
    @keydown.space.prevent="inputEl?.click()"
    @dragover.prevent="dragOver = true"
    @dragleave.prevent="dragOver = false"
    @drop.prevent="onDrop"
  >
    <input
      ref="inputEl"
      type="file"
      multiple
      accept=".loga"
      class="hidden-input"
      @change="onChange"
    />
    <strong>{{ t('converter.upload.title') }}</strong>
    <span class="hint">{{ t('converter.upload.hint') }}</span>
    <span class="btn">{{ t('converter.upload.button') }}</span>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: calc(var(--space) * 3);
  border: 2px dashed var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  background: var(--color-surface);
  cursor: pointer;
  text-align: center;
}
.dropzone.is-over {
  border-color: var(--color-accent);
  background: var(--color-bg);
}
.hidden-input {
  display: none;
}
.hint {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
.btn {
  margin-top: 4px;
  padding: 6px 14px;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-radius: var(--radius);
  font-size: 0.9rem;
}
</style>
