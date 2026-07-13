<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { type Aggregation } from '@/domain/analysis/lapAggregate'
import { type LapContext } from '@/domain/analysis/lapMetrics'
import { computeSectorTimes } from '@/domain/analysis/sectorTiming'
import { fastestLapIndex } from '@/domain/analysis/bestLap'
import { buildLapTableRows } from '@/domain/analysis/sessionLapSummary'
import { lapColor } from './lapColors'
import { aggLabel as sharedAggLabel } from './lapColumnHeader'
import SearchableSelect from '@/components/SearchableSelect.vue'
import LapTableView from './LapTableView.vue'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LogSession } from '@/domain/model/LogSession'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import SessionLapComparison from './SessionLapComparison.vue'
import LapExcludeToggle from './LapExcludeToggle.vue'
import { categoricalColor } from '@/domain/analysis/colorPalette'

const props = defineProps<{
  laps: Lap[]
  track: GpsTrack | null
  timeMs: Float64Array | null
  /** Active session, used to resolve configurable per-lap statistic columns. */
  session: LogSession | null
  /** Whether the ECU lap channel (IR_LapNumber) is available in this session. */
  hasEcuLaps: boolean
  comparisonSessions?: ComparisonSession[]
  primaryFileId?: number | null
  primaryFileName?: string
}>()

const { t } = useI18n()
const lapStore = useLapStore()
const sectorStore = useSectorStore()

// Selection changes are routed to the parent (which owns the zoom coupling) so
// it can decide whether to also reset the zoom; we never mutate the selection
// store directly here.
const emit = defineEmits<{ select: [number | null] }>()

const AGGS: Aggregation[] = ['max', 'min', 'avg']
const aggLabel = (agg: Aggregation): string => sharedAggLabel(t, agg)

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

/** How many sector slots exist for the sector-column picker (gates + 1). */
const sectorCount = computed(() => sectorStore.gates.length + 1)

// Per-lap rows for the SHARED LapTableView presentational body — the same
// row-building path a comparison recording's read-only table uses (see
// sessionLapSummary.ts's buildLapTableRows), so the primary table and every
// comparison table draw their numbers/markers from one source of truth.
const rows = computed(() =>
  buildLapTableRows(props.laps, ctx.value, lapStore.columns.map((c) => c.metric), lapStore.excluded),
)
</script>

<template>
  <div class="lap-table">
    <!-- Column editor: one row per configured column. channel-kind exposes the
         channel picker + agg toggle; sectorTime-kind exposes the sector-index
         picker; delta needs no per-column config. -->
    <div v-if="lapStore.columns.length" class="columns-editor">
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
    </div>

    <!-- Actions row (B4): source toggle + add-column buttons share one row,
         wrapping on narrow viewports; clear-selection sits at the far right
         (auto-margin, so it wraps to its own line rather than blowing out
         the layout on phones). -->
    <div class="actions-row">
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
      <button
        v-if="lapStore.selected.length > 0"
        type="button"
        class="clear-selection"
        @click="emit('select', null)"
      >
        {{ t('analyzer.clearLapSelection') }}
      </button>
    </div>

    <div v-if="primaryFileId != null" class="recording-heading">
      <span class="recording-swatch" :style="{ background: categoricalColor(primaryFileId) }" />
      <strong :title="primaryFileName">{{ primaryFileName }}</strong>
      <span>{{ t('fileBar.primary') }}</span>
    </div>

    <LapTableView
      :rows="rows"
      :columns="lapStore.columns"
      :is-row-selected="lapStore.isSelected"
      @row-click="emit('select', $event)"
    >
      <template #lead="{ row }">
        <div class="lap-cell">
          <LapExcludeToggle
            :excluded="lapStore.isExcluded(row.index)"
            :disabled="excludeDisabled(row.index)"
            :label="excludeLabel(row.index)"
            @toggle="lapStore.toggleExcluded(row.index)"
          />
          <span
            v-if="lapStore.isSelected(row.index)"
            class="swatch"
            :style="{ background: swatchColor(row.index) }"
          />
          {{ row.index + 1 }}
        </div>
      </template>
    </LapTableView>
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
.recording-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 0.85rem;
}
.recording-heading strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recording-heading > span:last-child {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}
.recording-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.actions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space);
}
.source {
  display: inline-flex;
  flex: none;
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

.clear-selection {
  /* Pins to the far right of .actions-row when there's room; wraps to its
     own (still right-flush, since it's the only item) line on narrow
     viewports instead of squeezing the source/add-column controls (B4). */
  margin-left: auto;
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
.lap-cell {
  display: flex;
  align-items: center;
  gap: 6px;
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
