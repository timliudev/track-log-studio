<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useConverterStore } from '@/stores/converterStore'
import { downloadText, downloadZip } from './download'

const { t } = useI18n()
const store = useConverterStore()
const { results, isConverting, readyFiles } = storeToRefs(store)

function onConvert(): void {
  const out = store.convertAll()
  // Single file: download immediately. Batch: user picks ZIP / per-file below.
  if (out.length === 1) downloadText(out[0].name, out[0].content)
}

function downloadAllZip(): void {
  downloadZip('loga-nmea.zip', results.value)
}
</script>

<template>
  <section class="results">
    <button
      type="button"
      class="btn-primary"
      :disabled="readyFiles.length === 0 || isConverting"
      @click="onConvert"
    >
      {{ isConverting ? t('converter.convert.converting') : t('converter.convert.button') }}
    </button>
    <span v-if="readyFiles.length === 0" class="muted">
      {{ t('converter.convert.noReady') }}
    </span>

    <div v-if="results.length" class="result-block">
      <header class="row">
        <h3>{{ t('converter.convert.resultsHeading') }}</h3>
        <button
          v-if="results.length > 1"
          type="button"
          class="btn-secondary"
          @click="downloadAllZip"
        >
          {{ t('converter.convert.downloadAll') }}
        </button>
      </header>
      <ul class="items">
        <li v-for="r in results" :key="r.name" class="item">
          <span class="name">{{ r.name }}</span>
          <button type="button" class="link" @click="downloadText(r.name, r.content)">
            {{ t('converter.convert.download') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.results {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.btn-primary {
  align-self: flex-start;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border: none;
  border-radius: var(--radius);
  padding: 8px 18px;
  font: inherit;
  cursor: pointer;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.muted {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h3 {
  margin: 0;
  font-size: 1rem;
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
}
.name {
  font-family: ui-monospace, monospace;
}
.link {
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
  font: inherit;
}
</style>
