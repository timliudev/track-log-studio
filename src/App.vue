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
      <div class="brand">
        <h1 class="brand-title">{{ t('app.title') }}</h1>
        <span class="brand-subtitle">{{ t('app.subtitle') }}</span>
      </div>
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

    <footer class="site-footer">
      <a
        class="repo-link"
        href="https://github.com/timliudev/aRacerLogaAnalysis"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span>{{ t('footer.developedBy') }} timliudev</span>
      </a>
    </footer>
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
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand-title {
  margin: 0;
  font-size: 1.1rem;
  color: var(--color-accent);
}
.brand-subtitle {
  font-size: 0.78rem;
  color: var(--color-text-muted);
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
.site-footer {
  display: flex;
  justify-content: center;
  padding: calc(var(--space) * 2);
  border-top: 1px solid var(--color-border);
}
.repo-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 0.85rem;
}
.repo-link:hover {
  color: var(--color-text);
}
</style>
