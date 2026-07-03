<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useConverterStore } from '@/stores/converterStore'

const { t } = useI18n()
const { outputFormat } = storeToRefs(useConverterStore())

// TODO: replace with the user's own import walkthrough once provided. For now
// this points at the RaceChrono DIY data-format article.
const IMPORT_GUIDE_URL = 'https://racechrono.com/article/2572'
</script>

<template>
  <section class="notes">
    <p v-if="outputFormat === 'vbo'" class="note">
      {{ t('converter.notes.vbo') }}
    </p>
    <p v-else-if="outputFormat === 'csv'" class="note">
      {{ t('converter.notes.csv') }}
    </p>
    <p v-else-if="outputFormat === 'loga'" class="note">
      {{ t('converter.notes.loga') }}
    </p>
    <p v-else class="note">
      {{ t('converter.notes.racechrono') }}
      <a :href="IMPORT_GUIDE_URL" target="_blank" rel="noopener noreferrer">
        {{ t('converter.notes.importGuide') }} ↗
      </a>
    </p>
    <p v-if="outputFormat !== 'loga'" class="note muted">⚠ {{ t('converter.notes.raceModule') }}</p>
  </section>
</template>

<style scoped>
.notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: calc(var(--space) * 1.5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius);
}
.note {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.6;
}
.note.muted {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
a {
  color: var(--color-accent);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
</style>
