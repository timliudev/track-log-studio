<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLapStore, type LapMetricColumn } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { type Aggregation } from '@/domain/analysis/lapAggregate'
import { computeMetric, type LapContext } from '@/domain/analysis/lapMetrics'
import { computeSectorTimes } from '@/domain/analysis/sectorTiming'
import { fastestLapIndex, slowestLapIndex } from '@/domain/analysis/bestLap'
import { formatLapTime } from '@/domain/analysis/format'
import { lapColor } from './lapColors'
import SearchableSelect from '@/components/SearchableSelect.vue'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LogSession } from '@/domain/model/LogSession'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import SessionLapComparison from './SessionLapComparison.vue'

const props = defineProps<{
  laps: Lap[]
  track: GpsTrack | null
  timeMs: Float64Array | null
  /** Active session, used to resolve configurable per-lap statistic columns. */
  session: LogSession | null
  /** Whether the ECU lap channel (IR_LapNumber) is available in this session. */
  hasEcuLaps: boolean
  comparisonSessions?: ComparisonSession[]
}>()

const { t } = useI18n()
const lapStore = useLapStore()
const sectorStore = useSectorStore()

// Selection changes are routed to the parent (which owns the zoom coupling) so
// it can decide whether to also reset the zoom; we never mutate the selection
// store directly here.
const emit = defineEmits<{ select: [number | null] }>()

const AGGS: Aggregation[] = ['max', 'min', 'avg']
const aggLabel = (agg: Aggregation): string =>
  agg === 'max' ? t('analyzer.aggMax') : agg === 'min' ? t('analyzer.aggMin') : t('analyzer.aggAvg')

// Cumulative distance computed once for the active track and reused per lap row.
const cumDistM = computed<Float64Array | null>(() =>
  props.track
    ? cumulativeDistanceM(props.track.lat, props.track.lon, props.track.valid)
    : null,
)

// Per-lap sector timings (§11 E): recomputed whenever laps/track/timeMs/gates
// change. Empty when there's no track/time axis yet; with zero gates every lap
// still gets a single (whole-lap) "sector 0" timing from computeSectorTimes.
const sectorTimings = computed(() =>
  props.track && props.timeMs
    ? computeSectorTimes(props.laps, props.track, props.timeMs, sectorStore.gates)
    : [],
)

// The fastest INCLUDED lap's total time, feeding the `delta` metric (delta to
// best lap — the standard definition, vs. delta to the theoretical-best/optimal
// lap which would always be non-negative and less intuitive per-lap).
const bestLapTimeMs = computed<number | null>(() => {
  const i = fastestLapIndex(props.laps, lapStore.excluded)
  if (i == null) return null
  const lap = props.laps.find((l) => l.index === i)
  return lap ? lap.lapTimeMs : null
})

// One context for every per-lap value: built-in #/time/distance columns and the
// configurable channel/sector/delta columns all source their numbers through
// computeMetric(ctx).
const ctx = computed<LapContext>(() => ({
  session: props.session,
  cumDistM: cumDistM.value,
  sectorTimings: sectorTimings.value,
  bestLapTimeMs: bestLapTimeMs.value,
}))

// Sorted channel options for each column's picker (same idiom as TimeSeriesChart).
const channelOptions = computed(() =>
  props.session
    ? props.session.channels
        .map((c) => ({ name: c.name, description: c.description }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [],
)

/** Track color for a selected lap, matching its segment on the map (or '' if unselected). */
function swatchColor(index: number): string {
  const order = lapStore.selected.indexOf(index)
  return order === -1 ? '' : lapColor(order)
}

/**
 * Localized tooltip/label for lap `index`'s ⦸ toggle: explains WHY an
 * auto-excluded lap can't be un-excluded by hand, or the plain include/exclude
 * label otherwise. One source of truth so the `title` and `aria-label` never
 * drift apart.
 */
function excludeLabel(index: number): string {
  const reason = lapStore.exclusionReason(index)
  if (reason === 'timeBand') return t('analyzer.excludedByBand')
  if (reason === 'distBand') return t('analyzer.excludedByDistanceBand')
  if (reason === 'sector') return t('analyzer.excludedBySector')
  return reason === 'manual' ? t('analyzer.includeLap') : t('analyzer.excludeLap')
}

/** Whether lap `index`'s ⦸ toggle should be disabled: auto-excluded (time band,
 *  distance band, or sector) laps can't be un-excluded by hand while the rule
 *  still applies. */
function excludeDisabled(index: number): boolean {
  const reason = lapStore.exclusionReason(index)
  return reason === 'timeBand' || reason === 'distBand' || reason === 'sector'
}

// The fastest lap among the non-excluded laps; gets a marker in the table so
// excluding a "cut" lap visibly promotes the next-best one. null when none.
const bestLapIndex = computed<number | null>(() =>
  fastestLapIndex(props.laps, lapStore.excluded),
)

// The slowest non-excluded lap, marked only when it's a DIFFERENT lap than the
// fastest — with 0 or 1 included laps the two coincide and a second marker on
// the same row is just noise.
const worstLapIndex = computed<number | null>(() => {
  const i = slowestLapIndex(props.laps, lapStore.excluded)
  return i != null && i !== bestLapIndex.value ? i : null
})

/**
 * Localized header for a configurable column's metric. Channel kind →
 * `${channel} · ${aggLabel}` (placeholder label until a channel is picked);
 * built-in kinds map to their own header label; sectorTime shows its 1-based
 * sector number (§11 E sectors are 0-based internally, 1-based for humans).
 */
function columnHeader(metric: LapMetricColumn['metric']): string {
  switch (metric.kind) {
    case 'channel':
      return `${metric.channel || t('analyzer.selectChannel')} · ${aggLabel(metric.agg)}`
    case 'lapTime':
      return t('analyzer.lapTime')
    case 'distance':
      return t('analyzer.lapDistance')
    case 'sectorTime':
      return t('analyzer.sectorTimeColumn', { n: metric.sector + 1 })
    case 'delta':
      return t('analyzer.deltaColumn')
  }
}

/** Format an aggregated value: '—' for NaN, finer precision for small magnitudes. */
function formatValue(v: number): string {
  if (Number.isNaN(v)) return '—'
  return Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)
}

/** Format a sector/delta time (ms) as seconds with a sign for delta, '—' for NaN. */
function formatMsColumn(v: number, signed: boolean): string {
  if (Number.isNaN(v)) return '—'
  const sec = v / 1000
  const text = Math.abs(sec).toFixed(3)
  if (!signed) return text
  return sec > 0 ? `+${text}` : sec < 0 ? `-${text}` : text
}

/** How many sector slots exist for the sector-column picker (gates + 1). */
const sectorCount = computed(() => sectorStore.gates.length + 1)

interface Row {
  index: number
  lapTime: string
  distanceKm: string
  /** Per-metric value per configured column, aligned to lapStore.columns. */
  cells: string[]
}

const rows = computed<Row[]>(() => {
  const c = ctx.value
  const cols = lapStore.columns

  return props.laps.map((l) => {
    // Built-in #/time/distance go through the SAME computeMetric path as the
    // configurable columns, so every displayed number has one source of truth.
    const lapTimeMs = computeMetric({ kind: 'lapTime' }, l, c)
    const distanceM = computeMetric({ kind: 'distance' }, l, c)
    const cells = cols.map((col) => {
      const v = computeMetric(col.metric, l, c)
      if (col.metric.kind === 'sectorTime') return formatMsColumn(v, false)
      if (col.metric.kind === 'delta') return formatMsColumn(v, true)
      return formatValue(v)
    })

    return {
      index: l.index,
      lapTime: formatLapTime(lapTimeMs),
      distanceKm: Number.isNaN(distanceM) ? '—' : (distanceM / 1000).toFixed(3),
      cells,
    }
  })
})
</script>

<template>
  <div class="lap-table">
    <div v-if="hasEcuLaps" class="source">
      <button
        type="button"
        :class="{ active: lapStore.source === 'line' }"
        @click="lapStore.setSource('line')"
      >
        {{ t('analyzer.sourceLine') }}
      </button>
      <button
        type="button"
        :class="{ active: lapStore.source === 'ecu' }"
        @click="lapStore.setSource('ecu')"
      >
        {{ t('analyzer.sourceEcu') }}
      </button>
    </div>

    <!-- Column editor: one row per configured column. channel-kind exposes the
         channel picker + agg toggle; sectorTime-kind exposes the sector-index
         picker; delta needs no per-column config. -->
    <div class="columns-editor">
      <div v-for="col in lapStore.columns" :key="col.id" class="column-row">
        <template v-if="col.metric.kind === 'channel'">
          <SearchableSelect
            class="channel-select"
            :model-value="col.metric.channel || null"
            :options="channelOptions"
            @update:model-value="lapStore.setColumnChannel(col.id, $event ?? '')"
          />
          <div class="agg">
            <button
              v-for="a in AGGS"
              :key="a"
              type="button"
              :class="{ active: col.metric.agg === a }"
              @click="lapStore.setColumnAgg(col.id, a)"
            >
              {{ aggLabel(a) }}
            </button>
          </div>
        </template>
        <template v-else-if="col.metric.kind === 'sectorTime'">
          <select
            class="sector-select"
            :value="col.metric.sector"
            @change="lapStore.setColumnSector(col.id, Number(($event.target as HTMLSelectElement).value))"
          >
            <option v-for="s in sectorCount" :key="s - 1" :value="s - 1">
              {{ t('analyzer.sectorTimeColumn', { n: s }) }}
            </option>
          </select>
        </template>
        <span v-else-if="col.metric.kind === 'delta'" class="column-label">
          {{ t('analyzer.deltaColumn') }}
        </span>
        <button
          type="button"
          class="remove"
          v-tooltip="t('analyzer.removeColumn')"
          :aria-label="t('analyzer.removeColumn')"
          @click="lapStore.removeColumn(col.id)"
        >
          ×
        </button>
      </div>
      <div class="add-column-row">
        <button
          type="button"
          class="add-column"
          @click="lapStore.addColumn({ kind: 'channel', channel: '', agg: 'max' })"
        >
          {{ t('analyzer.addColumn') }}
        </button>
        <button
          type="button"
          class="add-column"
          @click="lapStore.addColumn({ kind: 'sectorTime', sector: 0 })"
        >
          {{ t('analyzer.addSectorColumn') }}
        </button>
        <button
          type="button"
          class="add-column"
          @click="lapStore.addColumn({ kind: 'delta' })"
        >
          {{ t('analyzer.addDeltaColumn') }}
        </button>
      </div>
    </div>

    <button
      v-if="lapStore.selected.length > 0"
      type="button"
      class="clear-selection"
      @click="emit('select', null)"
    >
      {{ t('analyzer.clearLapSelection') }}
    </button>

    <p v-if="laps.length === 0" class="empty">{{ t('analyzer.noLaps') }}</p>

    <div v-else class="table-scroll">
    <table>
      <thead>
        <tr>
          <th>{{ t('analyzer.lap') }}</th>
          <th>{{ t('analyzer.lapTime') }}</th>
          <th>{{ t('analyzer.lapDistance') }}</th>
          <th v-for="col in lapStore.columns" :key="col.id">
            {{ columnHeader(col.metric) }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in rows"
          :key="r.index"
          :class="{ selected: lapStore.isSelected(r.index), excluded: lapStore.isExcluded(r.index) }"
          @click="emit('select', r.index)"
        >
          <td>
            <div class="lap-cell">
              <button
                type="button"
                class="exclude"
                :class="{ on: lapStore.isExcluded(r.index), 'auto-disabled': excludeDisabled(r.index) }"
                v-tooltip="excludeLabel(r.index)"
                :aria-label="excludeLabel(r.index)"
                :aria-pressed="lapStore.isExcluded(r.index)"
                :aria-disabled="excludeDisabled(r.index)"
                @click.stop="!excludeDisabled(r.index) && lapStore.toggleExcluded(r.index)"
              >
                ⦸
              </button>
              <span
                v-if="lapStore.isSelected(r.index)"
                class="swatch"
                :style="{ background: swatchColor(r.index) }"
              />
              {{ r.index + 1 }}
            </div>
          </td>
          <td>
            <span v-if="r.index === bestLapIndex" class="mark" v-tooltip="t('analyzer.bestLap')">⚡</span>
            <span v-else-if="r.index === worstLapIndex" class="mark" v-tooltip="t('analyzer.slowestLap')">🐢</span>
            {{ r.lapTime }}
          </td>
          <td>{{ r.distanceKm === '—' ? '—' : `${r.distanceKm} km` }}</td>
          <td v-for="(cell, i) in r.cells" :key="lapStore.columns[i].id">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
    </div>
    <SessionLapComparison
      :primary-laps="laps"
      :primary-excluded="lapStore.excluded"
      :comparisons="comparisonSessions ?? []"
    />
  </div>
</template>

<style scoped>
.lap-table {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
}
.source {
  display: inline-flex;
  align-self: flex-start;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.source button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.source button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}

.columns-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space);
  align-items: flex-start;
}
.column-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  flex-wrap: wrap;
}
.channel-select {
  flex: 1 1 200px;
  max-width: 280px;
}
.agg {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.agg button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.agg button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.remove {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  width: 30px;
  height: 30px;
  font: inherit;
  line-height: 1;
  cursor: pointer;
}
.remove:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.add-column-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.add-column {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.add-column:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.sector-select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 10px;
  font: inherit;
}
.column-label {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.empty {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  margin: 0;
}
.clear-selection {
  align-self: flex-start;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.clear-selection:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
/* Horizontal scroll so extra channel columns scroll instead of squeezing the
   cells into multi-line wraps (which misaligned rows on narrow phones). */
.table-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}
th,
td {
  text-align: right;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  /* middle-align every cell so a wrapped header/value can't stagger its row */
  vertical-align: middle;
}
/* Keep data values on one line; the scroll container handles overflow. Headers
   may still wrap to keep column widths reasonable. */
tbody td {
  white-space: nowrap;
}
th:first-child,
td:first-child {
  text-align: left;
}
th {
  color: var(--color-text-muted);
  font-weight: 600;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover {
  background: var(--color-bg);
}
tbody tr.selected {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
/* Excluded (garbage) laps are dimmed and struck through; selection styling still
   wins when both apply so a selected-for-inspection bad lap stays readable. */
tbody tr.excluded td {
  color: var(--color-text-muted);
  text-decoration: line-through;
}
tbody tr.excluded.selected td {
  text-decoration: none;
}
.lap-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}
.exclude {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 50%;
  width: 22px;
  height: 22px;
  flex: none;
  padding: 0;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.exclude:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.exclude.on {
  border-color: var(--color-accent);
  color: var(--color-accent);
  background: var(--color-bg);
}
/* Auto-excluded (band/sector rule) laps show the same "on" look so the ⦸
   state reads consistently, but muted + non-interactive cursor since the
   user can't toggle it off by hand while the rule still applies. */
.exclude.auto-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.exclude.auto-disabled:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.mark {
  /* not decorative-only: the title attr conveys fastest/slowest to AT */
  margin-right: 2px;
}
.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: baseline;
  /* ring so the swatch reads on top of the selected row's accent background */
  box-shadow: 0 0 0 1px var(--color-surface);
}
</style>
