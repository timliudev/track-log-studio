<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type uPlot from 'uplot'
import { useAnalyzerStore, type ChartConfig } from '@/stores/analyzerStore'
import type { LogSession } from '@/domain/model/LogSession'
import UPlotChart from '@/components/UPlotChart.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'

const props = defineProps<{
  chart: ChartConfig
  session: LogSession
  xValues: Float64Array
}>()
const emit = defineEmits<{ cursor: [number | null] }>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()
const { xAxis } = storeToRefs(analyzer)

const PALETTE = ['#e23b3b', '#3b82e2', '#2ea043', '#e2a33b', '#9b3be2', '#3bd6e2']
const color = (i: number): string => PALETTE[i % PALETTE.length]

const allChannels = computed(() =>
  props.session.channels
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const pickerOptions = computed(() =>
  allChannels.value.filter((c) => !props.chart.channels.includes(c.name)),
)
const present = computed(() => props.chart.channels.filter((n) => props.session.get(n)))

const data = computed<uPlot.AlignedData>(
  () =>
    [props.xValues, ...present.value.map((n) => props.session.get(n)!.data)] as unknown as uPlot.AlignedData,
)

// Each series gets its own scale key (= channel name) → independent auto-ranging,
// so a small-range channel isn't flattened by a large-range one.
const series = computed<uPlot.Series[]>(() => [
  { label: xAxis.value === 'distance' ? 'm' : 's' },
  ...present.value.map((n, i) => ({ label: n, stroke: color(i), width: 1, scale: n })),
])

// x axis + up to two value axes (coloured per series); 3+ read values via legend.
const axes = computed<uPlot.Axis[]>(() => [
  { scale: 'x' },
  ...present.value.slice(0, 2).map((n, i) => ({
    scale: n,
    side: i === 0 ? 3 : 1,
    stroke: color(i),
  })),
])

function addChannel(name: string | null): void {
  if (name && !props.chart.channels.includes(name)) {
    analyzer.setChartChannels(props.chart.id, [...props.chart.channels, name])
  }
}
function removeChannel(name: string): void {
  analyzer.setChartChannels(
    props.chart.id,
    props.chart.channels.filter((n) => n !== name),
  )
}
</script>

<template>
  <section class="chart">
    <div class="toolbar">
      <div class="picker">
        <SearchableSelect :model-value="null" :options="pickerOptions" @update:model-value="addChannel" />
      </div>
      <button type="button" class="remove" @click="analyzer.removeChart(chart.id)">
        {{ t('analyzer.removeChart') }}
      </button>
    </div>

    <div class="chips">
      <span v-for="(name, i) in present" :key="name" class="chip">
        <span class="dot" :style="{ background: color(i) }" />
        {{ name }}
        <button type="button" class="x" @click="removeChannel(name)">×</button>
      </span>
      <span v-if="present.length === 0" class="muted">{{ t('analyzer.pickChannel') }}</span>
    </div>

    <UPlotChart
      v-if="present.length > 0"
      :data="data"
      :series="series"
      :axes="axes"
      @cursor="(idx) => emit('cursor', idx)"
    />
  </section>
</template>

<style scoped>
.chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.picker {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.remove {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 10px;
  font: inherit;
  cursor: pointer;
}
.remove:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
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
