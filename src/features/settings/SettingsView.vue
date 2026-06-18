<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SuspensionPanel from '@/features/suspension/SuspensionPanel.vue'
import SaveCalibratedLoga from '@/features/suspension/SaveCalibratedLoga.vue'

const { t } = useI18n()
</script>

<template>
  <div class="settings">
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
}
.future {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
</style>
