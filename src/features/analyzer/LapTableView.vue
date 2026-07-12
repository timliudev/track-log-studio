<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { LapMetricColumn } from '@/stores/lapStore'
import type { LapTableRow } from '@/domain/analysis/sessionLapSummary'
import { formatLapTime, formatLapDistanceKm, formatLapMetricCell } from '@/domain/analysis/format'
import { columnHeader as sharedColumnHeader } from './lapColumnHeader'

/**
 * The shared presentational body of a lap table: same columns, same
 * row/cell styling, same fastest/slowest markers, whether it's rendering the
 * primary recording's (editable) laps or a comparison recording's (read-only)
 * laps. This is the ONE rendering + number-sourcing path both LapTable.vue
 * and SessionLapComparison.vue draw from — see B1/#1/#17 (comparison-lap-
 * table unification).
 *
 * Callers own everything that differs: the primary supplies a `lead` slot
 * with its exclude-toggle + selection swatch; a comparison recording supplies
 * its own `lead` slot (selection swatch only, no exclude — comparisons carry
 * no manual exclusion state) and a `trail` slot (per-lap chart-offset
 * controls). Row click is bubbled via `row-click`, not acted on here — this
 * component owns rendering only, never store writes.
 */
const props = withDefaults(
  defineProps<{
    rows: LapTableRow[]
    columns: LapMetricColumn[]
    /** Read-only recordings (comparisons) get no editing affordances baked
     *  into this component (there are none here to begin with — the column
     *  editor / source toggle / band inputs all live in the caller) but the
     *  flag is still surfaced as `aria-readonly` so assistive tech reads the
     *  comparison tables as non-interactive-for-editing. */
    readonly?: boolean
    ariaLabel?: string
    isRowSelected?: (index: number) => boolean
  }>(),
  { readonly: false, ariaLabel: undefined, isRowSelected: undefined },
)

const emit = defineEmits<{ 'row-click': [number] }>()

const { t } = useI18n()

function columnHeader(metric: LapMetricColumn['metric']): string {
  return sharedColumnHeader(t, metric)
}

function selected(index: number): boolean {
  return props.isRowSelected?.(index) ?? false
}
</script>

<template>
  <p v-if="rows.length === 0" class="empty">{{ t('analyzer.noLaps') }}</p>
  <div v-else class="table-scroll">
    <table :aria-label="ariaLabel" :aria-readonly="readonly || undefined">
      <thead>
        <tr>
          <th>{{ t('analyzer.lap') }}</th>
          <th>{{ t('analyzer.lapTime') }}</th>
          <th>{{ t('analyzer.lapDistance') }}</th>
          <th v-for="col in columns" :key="col.id">{{ columnHeader(col.metric) }}</th>
          <th v-if="$slots['trail-header']" class="offset-col">
            <slot name="trail-header" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.index"
          :class="{ selected: selected(row.index), excluded: row.isExcluded }"
          @click="emit('row-click', row.index)"
        >
          <td>
            <slot name="lead" :row="row" :selected="selected(row.index)">{{ row.index + 1 }}</slot>
          </td>
          <td>
            <span v-if="row.isFastest" class="mark" v-tooltip="t('analyzer.bestLap')">⚡</span>
            <span v-else-if="row.isSlowest" class="mark" v-tooltip="t('analyzer.slowestLap')">🐢</span>
            {{ formatLapTime(row.lapTimeMs) }}
          </td>
          <td>{{ formatLapDistanceKm(row.distanceM) }}</td>
          <td v-for="(col, i) in columns" :key="col.id">{{ formatLapMetricCell(col.metric, row.cells[i]) }}</td>
          <td v-if="$slots.trail" class="offset-col">
            <slot name="trail" :row="row" :selected="selected(row.index)" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.empty {
  color: var(--color-text-muted);
  font-size: 0.9rem;
  margin: 0;
}
/* Horizontal scroll so extra channel/pick/offset columns scroll instead of
   squeezing cells into multi-line wraps (which misaligned rows on narrow
   phones). */
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
/* Excluded (garbage / out-of-band) laps are dimmed and struck through;
   selection styling still wins when both apply so a selected-for-inspection
   bad lap stays readable. */
tbody tr.excluded td {
  color: var(--color-text-muted);
  text-decoration: line-through;
}
tbody tr.excluded.selected td {
  text-decoration: none;
}
.mark {
  /* not decorative-only: the title attr conveys fastest/slowest to AT */
  margin-right: 2px;
}
</style>
