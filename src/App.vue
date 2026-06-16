<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'

const { t } = useI18n()
const { themePref, localePref } = storeToRefs(useSettingsStore())

// Apply appearance + language side effects from persisted preferences.
useTheme()
useLocale()
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

    <main class="content">
      <section class="card">
        <h2>{{ t('phase0.heading') }}</h2>
        <p>{{ t('phase0.body') }}</p>
      </section>
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

.content {
  flex: 1;
  padding: calc(var(--space) * 2);
  display: flex;
  justify-content: center;
}

.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 3);
  max-width: 640px;
  width: 100%;
}

.card h2 {
  margin-top: 0;
  color: var(--color-accent);
}

.card p {
  color: var(--color-text-muted);
  line-height: 1.6;
}

@media (max-width: 480px) {
  .topbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
