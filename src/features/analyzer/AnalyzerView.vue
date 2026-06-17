<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useActiveSession } from '@/composables/useActiveSession'
import TrackMap from './TrackMap.vue'
import TimeSeriesChart from './TimeSeriesChart.vue'

const { t } = useI18n()
const fileStore = useFileStore()
const analyzer = useAnalyzerStore()
const { charts, xAxis, xRange } = storeToRefs(analyzer)
const { session, track, xValues } = useActiveSession()

const cursorIdx = ref<number | null>(null)

const readyFiles = computed(() => fileStore.files.filter((f) => f.status === 'ready'))

// Switching the X unit (time↔distance) invalidates any shared zoom range.
watch(xAxis, () => analyzer.setXRange(null))

watch(
  readyFiles,
  (files) => {
    const exists = files.some((f) => f.id === analyzer.activeFileId)
    if (!exists) analyzer.activeFileId = files.length ? files[0].id : null
  },
  { immediate: true },
)

function onSelect(e: Event): void {
  analyzer.activeFileId = Number((e.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="analyzer">
    <p v-if="readyFiles.length === 0" class="empty">{{ t('analyzer.noFiles') }}</p>

    <template v-else>
      <div class="toolbar">
        <label class="record">
          <span>{{ t('analyzer.record') }}</span>
          <select :value="analyzer.activeFileId ?? ''" @change="onSelect">
            <option v-for="f in readyFiles" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </label>
        <div class="xaxis">
          <button type="button" :class="{ active: xAxis === 'time' }" @click="analyzer.xAxis = 'time'">
            {{ t('analyzer.time') }}
          </button>
          <button type="button" :class="{ active: xAxis === 'distance' }" @click="analyzer.xAxis = 'distance'">
            {{ t('analyzer.distance') }}
          </button>
        </div>
      </div>

      <div class="card">
        <TrackMap :track="track" :cursor-idx="cursorIdx" @cursor="(i) => (cursorIdx = i)" />
      </div>

      <div v-for="c in charts" :key="c.id" class="card">
        <TimeSeriesChart
          v-if="session && xValues"
          :chart="c"
          :session="session"
          :x-values="xValues"
          :x-range="xRange"
          :external-cursor="cursorIdx"
          @cursor="(i) => (cursorIdx = i)"
          @x-zoom="(r) => analyzer.setXRange(r)"
        />
      </div>

      <button type="button" class="add" @click="analyzer.addChart()">
        ＋ {{ t('analyzer.addChart') }}
      </button>
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
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
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
.xaxis {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.xaxis button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.xaxis button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 1.5);
}
.add {
  align-self: flex-start;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}
.add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
