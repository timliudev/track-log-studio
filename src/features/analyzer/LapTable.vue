<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLapStore, type LapMetricColumn } from '@/stores/lapStore'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { type Aggregation } from '@/domain/analysis/lapAggregate'
import { computeMetric, type LapContext } from '@/domain/analysis/lapMetrics'
import { formatLapTime } from '@/domain/analysis/format'
import { lapColor } from './lapColors'
import SearchableSelect from '@/components/SearchableSelect.vue'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LogSession } from '@/domain/model/LogSession'

const props = defineProps<{
  laps: Lap[]
  track: GpsTrack | null
  timeMs: Float64Array | null
  /** Active session, used to resolve configurable per-lap statistic columns. */
  session: LogSession | null
  /** Whether the ECU lap channel (IR_LapNumber) is available in this session. */
  hasEcuLaps: boolean
}>()

const { t } = useI18n()
const lapStore = useLapStore()

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

// One context for every per-lap value: built-in #/time/distance columns and the
// configurable channel columns all source their numbers through computeMetric(ctx).
const ctx = computed<LapContext>(() => ({
  session: props.session,
  cumDistM: cumDistM.value,
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
 * Localized header for a configurable column's metric. Channel kind →
 * `${channel} · ${aggLabel}` (placeholder label until a channel is picked);
 * built-in kinds map to their own header label.
 */
function columnHeader(metric: LapMetricColumn['metric']): string {
  switch (metric.kind) {
    case 'channel':
      return `${metric.channel || t('analyzer.selectChannel')} · ${aggLabel(metric.agg)}`
    case 'lapTime':
      return t('analyzer.lapTime')
    case 'distance':
      return t('analyzer.lapDistance')
  }
}

/** Format an aggregated value: '—' for NaN, finer precision for small magnitudes. */
function formatValue(v: number): string {
  if (Number.isNaN(v)) return '—'
  return Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)
}

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
    const cells = cols.map((col) => formatValue(computeMetric(col.metric, l, c)))

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

    <!-- Column editor: one row per configured column. The editor is channel-
         focused, so only channel-kind metrics expose the picker + agg toggle;
         other metric kinds (future delta/sector) would render their own editor. -->
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
        <button
          type="button"
          class="remove"
          :title="t('analyzer.removeColumn')"
          :aria-label="t('analyzer.removeColumn')"
          @click="lapStore.removeColumn(col.id)"
        >
          ×
        </button>
      </div>
      <button
        type="button"
        class="add-column"
        @click="lapStore.addColumn({ kind: 'channel', channel: '', agg: 'max' })"
      >
        {{ t('analyzer.addColumn') }}
      </button>
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

    <table v-else>
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
          :class="{ selected: lapStore.isSelected(r.index) }"
          @click="emit('select', r.index)"
        >
          <td>
            <span
              v-if="lapStore.isSelected(r.index)"
              class="swatch"
              :style="{ background: swatchColor(r.index) }"
            />
            {{ r.index + 1 }}
          </td>
          <td>{{ r.lapTime }}</td>
          <td>{{ r.distanceKm === '—' ? '—' : `${r.distanceKm} km` }}</td>
          <td v-for="(cell, i) in r.cells" :key="lapStore.columns[i].id">{{ cell }}</td>
        </tr>
      </tbody>
    </table>
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
