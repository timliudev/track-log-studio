<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Lap } from '@/domain/model/Lap'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import { buildLapTableRows, fastestLapTime, type LapTableRow } from '@/domain/analysis/sessionLapSummary'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { computeSectorTimes } from '@/domain/analysis/sectorTiming'
import { outOfBandLapIndices, outOfBandDistanceLapIndices } from '@/domain/analysis/lapValidity'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import LapTableView from './LapTableView.vue'

const props = defineProps<{
  primaryLaps: Lap[]
  primaryExcluded: number[]
  comparisons: ComparisonSession[]
}>()
const { t } = useI18n()
const lapStore = useLapStore()
const sectorStore = useSectorStore()
const analyzer = useAnalyzerStore()

interface ComparisonTable {
  id: number
  name: string
  color: string
  fastestMs: number | null
  deltaMs: number | null
  lapCount: number
  rows: LapTableRow[]
}

// The fastest INCLUDED primary lap, used as the delta reference for each
// comparison's fastest lap (same definition as buildSessionLapSummaries).
const primaryBest = computed(() => fastestLapTime(props.primaryLaps, props.primaryExcluded))

// One per-lap table per comparison recording, rendered through the SAME
// LapTableView the primary LapTable uses — one rendering + number-sourcing
// path, not a parallel implementation (B1/#1/#17). Each comparison gets its
// OWN LapContext: cumDistM/session come from its own track/session so
// channel + distance columns are sourced through the same computeMetric path
// as the primary; bestLapTimeMs is the comparison's OWN fastest lap (not the
// primary's) so its `delta` column reads the same way the primary table's
// does — "how far off THIS recording's best lap".
const tables = computed<ComparisonTable[]>(() =>
  props.comparisons.map((c) => {
    const cumDistM = cumulativeDistanceM(c.track.lat, c.track.lon, c.track.valid)

    // B2: the SAME valid lap-time/-distance band configured for the primary
    // recording applies to this comparison's OWN laps/track — read-only (no
    // toggle here; comparisons carry no manual exclusion state), just the
    // same dimmed/struck-through visual mark the primary table uses.
    const excluded = [
      ...new Set([
        ...outOfBandLapIndices(c.laps, lapStore.lapTimeBand),
        ...outOfBandDistanceLapIndices(c.laps, c.track, lapStore.lapDistanceBand),
      ]),
    ]

    // B17: the confirmed sector gates are shared across recordings of the
    // SAME circuit, so they're walked against THIS comparison's own track —
    // the sector column populates for real whenever the gates actually cross
    // it, and legitimately stays '—' only when they don't (or none are set).
    const sectorTimings = computeSectorTimes(c.laps, c.track, c.timeMs, sectorStore.gates)

    const fastestMs = fastestLapTime(c.laps, excluded)
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      fastestMs,
      deltaMs: fastestMs != null && primaryBest.value != null ? fastestMs - primaryBest.value : null,
      lapCount: c.laps.length,
      rows: buildLapTableRows(
        c.laps,
        { session: c.session, cumDistM, sectorTimings, bestLapTimeMs: fastestMs },
        lapStore.columns.map((col) => col.metric),
        excluded,
      ),
    }
  }),
)

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
      <LapTableView
        :rows="table.rows"
        :columns="lapStore.columns"
        readonly
        :aria-label="t('analyzer.comparisonSelectLaps')"
        :is-row-selected="(i) => lapStore.isSessionLapSelected(table.id, i)"
        @row-click="lapStore.toggleSessionLap(table.id, $event)"
      >
        <template #lead="{ row }">
          <div class="lap-cell">
            <span
              v-if="lapStore.isSessionLapSelected(table.id, row.index)"
              class="swatch"
              :style="{ background: table.color }"
            />
            {{ row.index + 1 }}
          </div>
        </template>
        <template #trail-header>
          <span class="sr-only">{{ t('analyzer.comparisonOffset') }}</span>
        </template>
        <template #trail="{ row, selected }">
          <div
            v-if="lapStore.isSessionLapSelected(table.id, row.index)"
            class="lap-offset"
            :class="{ 'row-selected': selected }"
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
        </template>
      </LapTableView>
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
/* B35 — §8 layer 3: capability signal (useInputCapabilities.ts, mirrored onto
   <html data-any-pointer-coarse>), not a viewport-width guess — grows the
   ±/reset nudge buttons to a >=44px touch target on any coarse-pointer
   device, tablets running the full desktop layout included. */
:root[data-any-pointer-coarse] .chart-align button {
  min-width: 44px;
  min-height: 44px;
  padding: 10px 14px;
}

.lap-offset { display: inline-flex; align-items: center; gap: 4px; }
.lap-offset button { padding: 1px 6px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-bg); color: var(--color-text-muted); font: inherit; cursor: pointer; }
.lap-offset button:hover { border-color: var(--color-accent); color: var(--color-accent); }
/* Selected-row offset controls sit on the accent background — keep them legible. */
.lap-offset.row-selected button { background: var(--color-surface); color: var(--color-text); }
/* B35 — §8 layer 3: same capability-driven touch-target bump as .chart-align
   button above, for the per-lap offset ± buttons. */
:root[data-any-pointer-coarse] .lap-offset button {
  min-width: 44px;
  min-height: 44px;
  padding: 10px 12px;
}
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* Same lead-cell rhythm as the primary LapTable.vue's .lap-cell/.swatch (kept
   as a scoped duplicate, not a shared import, matching this file's existing
   .recording-heading/.recording-swatch convention) — just without the
   exclude toggle, since comparison recordings carry no manual exclusion
   state (B1b). */
.lap-cell { display: flex; align-items: center; gap: 6px; }
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: baseline;
  box-shadow: 0 0 0 1px var(--color-surface);
}
</style>
