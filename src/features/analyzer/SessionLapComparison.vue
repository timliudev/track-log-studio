<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Lap } from '@/domain/model/Lap'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import {
  buildComparisonLapRows,
  fastestLapTime,
  type ComparisonLapRow,
} from '@/domain/analysis/sessionLapSummary'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
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

interface ComparisonTable {
  id: number
  name: string
  color: string
  fastestMs: number | null
  deltaMs: number | null
  lapCount: number
  rows: ComparisonLapRow[]
}

// The fastest INCLUDED primary lap, used as the delta reference for each
// comparison's fastest lap (same definition as buildSessionLapSummaries).
const primaryBest = computed(() => fastestLapTime(props.primaryLaps, props.primaryExcluded))

// One per-lap table per comparison recording. Distances come from each
// recording's OWN cumulative-distance array so every displayed number is sourced
// through the same computeMetric path as the primary LapTable.
const tables = computed<ComparisonTable[]>(() =>
  props.comparisons.map((c) => {
    const cumDistM = c.track
      ? cumulativeDistanceM(c.track.lat, c.track.lon, c.track.valid)
      : null
    const fastestMs = fastestLapTime(c.laps)
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      fastestMs,
      deltaMs: fastestMs != null && primaryBest.value != null ? fastestMs - primaryBest.value : null,
      lapCount: c.laps.length,
      rows: buildComparisonLapRows(c.laps, cumDistM),
    }
  }),
)

function delta(value: number | null): string {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±'
  return `${sign}${(Math.abs(value) / 1000).toFixed(3)} s`
}

/** Per-lap distance label mirroring the primary LapTable: '—' for NaN, km with 3dp. */
function distanceLabel(distanceM: number): string {
  return Number.isNaN(distanceM) ? '—' : `${(distanceM / 1000).toFixed(3)} km`
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
  <section v-if="tables.length" class="session-summary">
    <h4>{{ t('analyzer.comparisonLapSummary') }}</h4>
    <div v-for="table in tables" :key="table.id" class="recording-laps">
      <div class="recording-heading">
        <span class="recording-swatch" :style="{ background: table.color }" />
        <strong class="name" :title="table.name">{{ table.name }}</strong>
        <span class="lap-count">{{ t('analyzer.lapCount', { n: table.lapCount }) }}</span>
        <span class="delta">{{ delta(table.deltaMs) }}</span>
      </div>
      <div class="chart-align" :aria-label="t('analyzer.comparisonChartAlign')">
        <span>{{ t('analyzer.comparisonChartAlign') }}</span>
        <button type="button" @click="nudgeChartOffset(table.id, analyzer.xAxis === 'time' ? -0.1 : -1)">−</button>
        <input
          type="number"
          :step="analyzer.xAxis === 'time' ? 0.1 : 1"
          :value="chartOffset(table.id)"
          :aria-label="t('analyzer.comparisonOffset')"
          @change="setChartOffset(table.id, $event)"
        />
        <span>{{ analyzer.xAxis === 'time' ? 's' : 'm' }}</span>
        <button type="button" @click="nudgeChartOffset(table.id, analyzer.xAxis === 'time' ? 0.1 : 1)">＋</button>
        <button type="button" @click="resetChartOffset(table.id)">{{ t('analyzer.comparisonReset') }}</button>
      </div>
      <div v-if="table.rows.length" class="table-scroll">
        <table :aria-label="t('analyzer.comparisonSelectLaps')">
          <thead>
            <tr>
              <th class="pick-col"><span class="sr-only">{{ t('analyzer.comparisonSelectLaps') }}</span></th>
              <th>{{ t('analyzer.lap') }}</th>
              <th>{{ t('analyzer.lapTime') }}</th>
              <th>{{ t('analyzer.lapDistance') }}</th>
              <th class="offset-col"><span class="sr-only">{{ t('analyzer.comparisonOffset') }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in table.rows"
              :key="row.index"
              :class="{ selected: lapStore.isSessionLapSelected(table.id, row.index) }"
              @click="lapStore.toggleSessionLap(table.id, row.index)"
            >
              <td class="pick-col">
                <input
                  type="checkbox"
                  :checked="lapStore.isSessionLapSelected(table.id, row.index)"
                  :aria-label="t('analyzer.comparisonSelectLaps')"
                  @click.stop
                  @change="lapStore.toggleSessionLap(table.id, row.index)"
                />
              </td>
              <td>{{ row.index + 1 }}</td>
              <td>
                <span v-if="row.isFastest" class="mark" v-tooltip="t('analyzer.bestLap')">⚡</span>
                <span v-else-if="row.isSlowest" class="mark" v-tooltip="t('analyzer.slowestLap')">🐢</span>
                {{ formatLapTime(row.lapTimeMs) }}
              </td>
              <td>{{ distanceLabel(row.distanceM) }}</td>
              <td class="offset-col">
                <div
                  v-if="lapStore.isSessionLapSelected(table.id, row.index)"
                  class="lap-offset"
                  @click.stop
                >
                  <button
                    type="button"
                    :aria-label="t('analyzer.comparisonOffset')"
                    @click="lapStore.nudgeSessionLapOffset(table.id, row.index, analyzer.xAxis, analyzer.xAxis === 'time' ? -0.1 : -1)"
                  >−</button>
                  <span>{{ lapStore.sessionLapOffsetOf(table.id, row.index, analyzer.xAxis).toFixed(analyzer.xAxis === 'time' ? 1 : 0) }}</span>
                  <button
                    type="button"
                    :aria-label="t('analyzer.comparisonOffset')"
                    @click="lapStore.nudgeSessionLapOffset(table.id, row.index, analyzer.xAxis, analyzer.xAxis === 'time' ? 0.1 : 1)"
                  >＋</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="empty">{{ t('analyzer.noLaps') }}</p>
    </div>
  </section>
</template>

<style scoped>
.session-summary { margin-top: 10px; border-top: 1px solid var(--color-border); padding-top: 8px; }
h4 { margin: 0 0 6px; font-size: .85rem; color: var(--color-text-muted); }
.recording-laps + .recording-laps { margin-top: 12px; }
.recording-heading { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: .82rem; }
.recording-heading .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; font-weight: 600; }
.recording-swatch { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.lap-count { color: var(--color-text-muted); flex: none; }
.delta { color: var(--color-text-muted); margin-left: auto; flex: none; }

.chart-align { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 5px 0 6px 16px; color: var(--color-text-muted); font-size: .78rem; }
.chart-align input { width: 68px; padding: 2px 4px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-surface); color: var(--color-text); }
.chart-align button { padding: 2px 6px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text-muted); font: inherit; cursor: pointer; }
.chart-align button:hover { border-color: var(--color-accent); color: var(--color-accent); }

/* Horizontal scroll so the per-lap offset column can't squeeze the row (same
   idiom as the primary LapTable). */
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { width: 100%; border-collapse: collapse; font-size: .82rem; }
th, td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--color-border); vertical-align: middle; white-space: nowrap; }
th { color: var(--color-text-muted); font-weight: 600; }
th.pick-col, td.pick-col { text-align: center; padding-left: 4px; padding-right: 4px; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--color-bg); }
tbody tr.selected { background: var(--color-accent); color: var(--color-accent-text); }
.mark { margin-right: 2px; }
.lap-offset { display: inline-flex; align-items: center; gap: 4px; }
.lap-offset button { padding: 1px 6px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text-muted); font: inherit; cursor: pointer; }
.lap-offset button:hover { border-color: var(--color-accent); color: var(--color-accent); }
/* Selected-row offset controls sit on the accent background — keep them legible. */
tbody tr.selected .lap-offset button { background: var(--color-surface); color: var(--color-text); }
.empty { color: var(--color-text-muted); font-size: .8rem; margin: 4px 0 0 16px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
</style>
