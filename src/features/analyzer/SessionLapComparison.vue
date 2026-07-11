<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Lap } from '@/domain/model/Lap'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import { buildSessionLapSummaries } from '@/domain/analysis/sessionLapSummary'
import { formatLapTime } from '@/domain/analysis/format'
import { useLapStore } from '@/stores/lapStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'

const props = defineProps<{
  primaryLaps: Lap[]
  primaryExcluded: number[]
  comparisons: ComparisonSession[]
}>()
const { t } = useI18n()
const lapStore = useLapStore()
const analyzer = useAnalyzerStore()
const summaries = computed(() => buildSessionLapSummaries(
  props.primaryLaps,
  props.primaryExcluded,
  props.comparisons,
))

function delta(value: number | null): string {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±'
  return `${sign}${(Math.abs(value) / 1000).toFixed(3)} s`
}

function chartOffset(id: number): number {
  const offset = analyzer.sessionOffsetOf(id)
  return analyzer.xAxis === 'distance' ? offset.distM : offset.timeSec
}

function nudgeChartOffset(id: number, delta: number): void {
  analyzer.nudgeSessionOffset(id, analyzer.xAxis === 'distance' ? 'distM' : 'timeSec', delta)
}

function setChartOffset(id: number, event: Event): void {
  analyzer.setSessionOffset(
    id,
    analyzer.xAxis === 'distance' ? 'distM' : 'timeSec',
    Number((event.target as HTMLInputElement).value),
  )
}

function resetChartOffset(id: number): void {
  analyzer.resetSessionOffset(id, analyzer.xAxis === 'distance' ? 'distM' : 'timeSec')
}
</script>

<template>
  <section v-if="summaries.length" class="session-summary">
    <h4>{{ t('analyzer.comparisonLapSummary') }}</h4>
    <div v-for="summary in summaries" :key="summary.id" class="recording-laps">
      <div class="summary-row">
        <span class="swatch" :style="{ background: summary.color }" />
        <span class="name" :title="summary.name">{{ summary.name }}</span>
        <span>{{ summary.fastestMs == null ? '—' : formatLapTime(summary.fastestMs) }}</span>
        <span class="delta">{{ delta(summary.deltaMs) }}</span>
        <span class="count">{{ t('analyzer.comparisonLapCount', { n: summary.lapCount }) }}</span>
      </div>
      <div class="chart-align" :aria-label="t('analyzer.comparisonChartAlign')">
        <span>{{ t('analyzer.comparisonChartAlign') }}</span>
        <button type="button" @click="nudgeChartOffset(summary.id, analyzer.xAxis === 'time' ? -0.1 : -1)">−</button>
        <input
          type="number"
          :step="analyzer.xAxis === 'time' ? 0.1 : 1"
          :value="chartOffset(summary.id)"
          :aria-label="t('analyzer.comparisonOffset')"
          @change="setChartOffset(summary.id, $event)"
        />
        <span>{{ analyzer.xAxis === 'time' ? 's' : 'm' }}</span>
        <button type="button" @click="nudgeChartOffset(summary.id, analyzer.xAxis === 'time' ? 0.1 : 1)">＋</button>
        <button type="button" @click="resetChartOffset(summary.id)">{{ t('analyzer.comparisonReset') }}</button>
      </div>
      <div class="lap-picks" :aria-label="t('analyzer.comparisonSelectLaps')">
        <label
          v-for="lap in comparisons.find((item) => item.id === summary.id)?.laps ?? []"
          :key="lap.index"
          class="lap-pick"
        >
          <input
            type="checkbox"
            :checked="lapStore.isSessionLapSelected(summary.id, lap.index)"
            @change="lapStore.toggleSessionLap(summary.id, lap.index)"
          />
          #{{ lap.index + 1 }} · {{ formatLapTime(lap.lapTimeMs) }}
          <template v-if="lapStore.isSessionLapSelected(summary.id, lap.index)">
            <button type="button" @click.stop.prevent="lapStore.nudgeSessionLapOffset(summary.id, lap.index, analyzer.xAxis, analyzer.xAxis === 'time' ? -0.1 : -1)">−</button>
            <span>{{ lapStore.sessionLapOffsetOf(summary.id, lap.index, analyzer.xAxis).toFixed(analyzer.xAxis === 'time' ? 1 : 0) }}</span>
            <button type="button" @click.stop.prevent="lapStore.nudgeSessionLapOffset(summary.id, lap.index, analyzer.xAxis, analyzer.xAxis === 'time' ? 0.1 : 1)">＋</button>
          </template>
        </label>
      </div>
    </div>
  </section>
</template>

<style scoped>
.session-summary { margin-top: 10px; border-top: 1px solid var(--color-border); padding-top: 8px; }
h4 { margin: 0 0 6px; font-size: .85rem; color: var(--color-text-muted); }
.summary-row { display: grid; grid-template-columns: 10px minmax(90px, 1fr) auto auto auto; gap: 7px; align-items: center; font-size: .82rem; }
.swatch { width: 9px; height: 9px; border-radius: 50%; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.delta, .count { color: var(--color-text-muted); }
.recording-laps + .recording-laps { margin-top: 3px; }
.lap-picks { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 5px 0 4px 17px; }
.lap-pick { font-size: .8rem; white-space: nowrap; }
.chart-align { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 5px 0 0 17px; color: var(--color-text-muted); font-size: .78rem; }
.chart-align input { width: 68px; padding: 2px 4px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); color: var(--color-text); }
.chart-align button { padding: 2px 6px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text-muted); font: inherit; cursor: pointer; }
.chart-align button:hover { border-color: var(--color-accent); color: var(--color-accent); }
</style>
