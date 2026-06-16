<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

interface Option {
  name: string
  description?: string
}

const props = defineProps<{
  modelValue: string | null
  options: Option[]
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [string | null] }>()

const { t } = useI18n()

const open = ref(false)
const query = ref('')
const searchEl = ref<HTMLInputElement | null>(null)

const filtered = computed<Option[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(
    (o) =>
      o.name.toLowerCase().includes(q) ||
      (o.description?.toLowerCase().includes(q) ?? false),
  )
})

function openPanel(): void {
  if (props.disabled) return
  open.value = true
  query.value = ''
  void nextTick(() => searchEl.value?.focus())
}

function close(): void {
  open.value = false
}

function select(name: string | null): void {
  emit('update:modelValue', name)
  close()
}

function onEnter(): void {
  if (filtered.value.length > 0) select(filtered.value[0].name)
}
</script>

<template>
  <div class="ss">
    <button
      type="button"
      class="ss-trigger"
      :class="{ 'is-empty': !modelValue }"
      :disabled="disabled"
      @click="openPanel"
    >
      <span class="ss-value">{{ modelValue ?? t('converter.mapping.none') }}</span>
      <span class="ss-caret" aria-hidden="true">▾</span>
    </button>

    <template v-if="open">
      <div class="ss-backdrop" @click="close" />
      <div class="ss-panel" role="dialog">
        <input
          ref="searchEl"
          v-model="query"
          class="ss-search"
          type="search"
          :placeholder="t('converter.mapping.search')"
          @keydown.enter.prevent="onEnter"
          @keydown.esc="close"
        />
        <ul class="ss-list">
          <li>
            <button type="button" class="ss-option is-none" @click="select(null)">
              {{ t('converter.mapping.none') }}
            </button>
          </li>
          <li v-for="opt in filtered" :key="opt.name">
            <button
              type="button"
              class="ss-option"
              :class="{ 'is-active': opt.name === modelValue }"
              @click="select(opt.name)"
            >
              <span class="ss-name">{{ opt.name }}</span>
              <span v-if="opt.description" class="ss-desc">{{ opt.description }}</span>
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ss {
  position: relative;
  width: 100%;
}

.ss-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 10px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.ss-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ss-trigger.is-empty .ss-value {
  color: var(--color-text-muted);
}
.ss-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ss-caret {
  color: var(--color-text-muted);
}

.ss-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.ss-panel {
  position: absolute;
  z-index: 21;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  max-height: 320px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  overflow: hidden;
}

.ss-search {
  position: sticky;
  top: 0;
  margin: 8px;
  padding: 8px 10px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  font: inherit;
}

.ss-list {
  list-style: none;
  margin: 0;
  padding: 0 8px 8px;
  overflow-y: auto;
}

.ss-option {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  background: transparent;
  color: var(--color-text);
  border: none;
  border-radius: var(--radius);
  padding: 8px 10px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.ss-option:hover {
  background: var(--color-bg);
}
.ss-option.is-active {
  outline: 2px solid var(--color-accent);
}
.ss-option.is-none {
  color: var(--color-text-muted);
}
.ss-name {
  font-weight: 500;
}
.ss-desc {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

/* Mobile: full-screen picker sheet. */
@media (max-width: 640px) {
  .ss-panel {
    position: fixed;
    inset: 0;
    top: 0;
    max-height: none;
    border-radius: 0;
  }
  .ss-list {
    flex: 1;
  }
}
</style>
