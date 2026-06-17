<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type uPlot from 'uplot'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import type { LogSession } from '@/domain/model/LogSession'
import UPlotChart from '@/components/UPlotChart.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'

const props = defineProps<{
  session: LogSession
  xValues: Float64Array
}>()
const emit = defineEmits<{ cursor: [number | null] }>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()
const { selectedChannels, xAxis } = storeToRefs(analyzer)

const PALETTE = ['#e23b3b', '#3b82e2', '#2ea043', '#e2a33b', '#9b3be2', '#3bd6e2']

const allChannels = computed(() =>
  props.session.channels
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const pickerOptions = computed(() =>
  allChannels.value.filter((c) => !selectedChannels.value.includes(c.name)),
)

const present = computed(() =>
  selectedChannels.value.filter((name) => props.session.get(name)),
)

const data = computed<uPlot.AlignedData>(() => {
  const ys = present.value.map((name) => props.session.get(name)!.data)
  return [props.xValues, ...ys] as unknown as uPlot.AlignedData
})

const series = computed<uPlot.Series[]>(() => [
  { label: xAxis.value === 'distance' ? 'm' : 's' },
  ...present.value.map((name, i) => ({
    label: name,
    stroke: PALETTE[i % PALETTE.length],
    width: 1,
  })),
])

function addChannel(name: string | null): void {
  if (name && !selectedChannels.value.includes(name)) selectedChannels.value.push(name)
}
function removeChannel(name: string): void {
  selectedChannels.value = selectedChannels.value.filter((n) => n !== name)
}
</script>

<template>
  <section class="chart">
    <div class="toolbar">
      <div class="xaxis">
        <button
          type="button"
          :class="{ active: xAxis === 'time' }"
          @click="analyzer.xAxis = 'time'"
        >
          {{ t('analyzer.time') }}
        </button>
        <button
          type="button"
          :class="{ active: xAxis === 'distance' }"
          @click="analyzer.xAxis = 'distance'"
        >
          {{ t('analyzer.distance') }}
        </button>
      </div>
      <div class="picker">
        <SearchableSelect
          :model-value="null"
          :options="pickerOptions"
          @update:model-value="addChannel"
        />
      </div>
    </div>

    <div class="chips">
      <span v-for="(name, i) in present" :key="name" class="chip">
        <span class="dot" :style="{ background: PALETTE[i % PALETTE.length] }" />
        {{ name }}
        <button type="button" class="x" @click="removeChannel(name)">×</button>
      </span>
      <span v-if="present.length === 0" class="muted">{{ t('analyzer.pickChannel') }}</span>
    </div>

    <UPlotChart
      v-if="present.length > 0"
      :data="data"
      :series="series"
      @cursor="(idx) => emit('cursor', idx)"
    />
  </section>
</template>

<style scoped>
.chart {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
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
.picker {
  min-width: 220px;
  flex: 1;
  max-width: 360px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 0.82rem;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.chip .x {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.muted {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
</style>
