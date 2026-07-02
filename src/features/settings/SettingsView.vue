<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'
import type { TzOverride } from '@/stores/settingsStore'
import SuspensionPanel from '@/features/suspension/SuspensionPanel.vue'
import SaveCalibratedLoga from '@/features/suspension/SaveCalibratedLoga.vue'

const { t } = useI18n()
const { tzOverride, themePref, localePref } = storeToRefs(useSettingsStore())

// Whole-hour offsets UTC-12 .. UTC+14; value is offset minutes east of UTC.
const tzHours = Array.from({ length: 27 }, (_, i) => i - 12)
function tzLabel(hours: number): string {
  if (hours === 0) return 'UTC'
  return `UTC${hours > 0 ? '+' : '-'}${Math.abs(hours)}`
}

// <select> values are strings; bridge to the 'auto' | number preference.
const tzModel = computed<string>({
  get: () => (tzOverride.value === 'auto' ? 'auto' : String(tzOverride.value)),
  set: (v: string) => {
    const next: TzOverride = v === 'auto' ? 'auto' : Number(v)
    tzOverride.value = next
  },
})
</script>

<template>
  <div class="settings">
    <div class="card">
      <label class="control">
        <span>{{ t('theme.label') }}</span>
        <select v-model="themePref" name="theme">
          <option value="auto">{{ t('theme.auto') }}</option>
          <option value="light">{{ t('theme.light') }}</option>
          <option value="dark">{{ t('theme.dark') }}</option>
        </select>
      </label>
      <label class="control">
        <span>{{ t('language.label') }}</span>
        <select v-model="localePref" name="locale">
          <option value="auto">{{ t('language.auto') }}</option>
          <option value="zh-Hant">繁體中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label class="control">
        <span>{{ t('settings.timezone') }}</span>
        <select v-model="tzModel" name="timezone">
          <option value="auto">{{ t('settings.timezoneAuto') }}</option>
          <option v-for="h in tzHours" :key="h" :value="String(h * 60)">{{ tzLabel(h) }}</option>
        </select>
      </label>
    </div>
    <div class="card">
      <SuspensionPanel />
    </div>
    <div class="card">
      <SaveCalibratedLoga />
    </div>
    <p class="future">{{ t('settings.futureNote') }}</p>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
  max-width: 820px;
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 2);
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
}
.control {
  display: flex;
  align-items: center;
  gap: var(--space);
}
.control span {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
.control select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.future {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
</style>
