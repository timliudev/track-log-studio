<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useConverterStore } from '@/stores/converterStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useActiveSession } from '@/composables/useActiveSession'
import TrackMap from './TrackMap.vue'
import TimeSeriesChart from './TimeSeriesChart.vue'

const { t } = useI18n()
const conv = useConverterStore()
const analyzer = useAnalyzerStore()
const { savableEntries } = storeToRefs(conv)
const { session, track, xValues } = useActiveSession()

const cursorIdx = ref<number | null>(null)

// Default the active record to the first ready file; recover if it's removed.
watch(
  savableEntries,
  (entries) => {
    const exists = entries.some((e) => e.id === analyzer.activeFileId)
    if (!exists) analyzer.activeFileId = entries.length ? entries[0].id : null
  },
  { immediate: true },
)

function onSelect(e: Event): void {
  analyzer.activeFileId = Number((e.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="analyzer">
    <p v-if="savableEntries.length === 0" class="empty">{{ t('analyzer.noFiles') }}</p>

    <template v-else>
      <div class="toolbar">
        <label class="record">
          <span>{{ t('analyzer.record') }}</span>
          <select :value="analyzer.activeFileId ?? ''" @change="onSelect">
            <option v-for="e in savableEntries" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
      </div>

      <div class="grid">
        <div class="card">
          <TrackMap :track="track" :cursor-idx="cursorIdx" @cursor="(i) => (cursorIdx = i)" />
        </div>
        <div class="card">
          <TimeSeriesChart
            v-if="session && xValues"
            :session="session"
            :x-values="xValues"
            @cursor="(i) => (cursorIdx = i)"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.analyzer {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
}
.empty {
  color: var(--color-text-muted);
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
}
.record {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.record select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: calc(var(--space) * 2);
  align-items: start;
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 1.5);
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
