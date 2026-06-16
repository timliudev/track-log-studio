<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import ConverterView from '@/features/converter/ConverterView.vue'

const { t } = useI18n()
const { themePref, localePref } = storeToRefs(useSettingsStore())

// Apply appearance + language side effects from persisted preferences.
useTheme()
useLocale()

type Tab = 'converter' | 'analyzer'
const tab = ref<Tab>('converter')
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <h1 class="brand">{{ t('app.title') }}</h1>
      <div class="controls">
        <label class="control">
          <span>{{ t('theme.label') }}</span>
          <select v-model="themePref">
            <option value="auto">{{ t('theme.auto') }}</option>
            <option value="light">{{ t('theme.light') }}</option>
            <option value="dark">{{ t('theme.dark') }}</option>
          </select>
        </label>
        <label class="control">
          <span>{{ t('language.label') }}</span>
          <select v-model="localePref">
            <option value="auto">{{ t('language.auto') }}</option>
            <option value="zh-Hant">繁體中文</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>
    </header>

    <nav class="tabs">
      <button
        type="button"
        class="tab"
        :class="{ active: tab === 'converter' }"
        @click="tab = 'converter'"
      >
        {{ t('nav.converter') }}
      </button>
      <button type="button" class="tab" disabled>
        {{ t('nav.analyzer') }} <small>{{ t('nav.analyzerSoon') }}</small>
      </button>
    </nav>

    <main class="content">
      <ConverterView v-if="tab === 'converter'" />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space);
  padding: var(--space) calc(var(--space) * 2);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.brand {
  margin: 0;
  font-size: 1.1rem;
  color: var(--color-accent);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--space) * 1.5);
}
.control {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--space) / 2);
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.control select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 4px 8px;
  font: inherit;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 calc(var(--space) * 2);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 14px;
  font: inherit;
  color: var(--color-text-muted);
  cursor: pointer;
}
.tab.active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}
.tab:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.tab small {
  font-size: 0.7rem;
}
.content {
  flex: 1;
  padding: calc(var(--space) * 2);
}
</style>
