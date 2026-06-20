import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LapLine } from '@/domain/analysis/laps'
import type { Aggregation } from '@/domain/analysis/lapAggregate'
import type { LapMetric } from '@/domain/analysis/lapMetrics'
import type { XAxis } from '@/stores/analyzerStore'

/** How laps are detected: a user-placed start/finish line, or the ECU channel. */
export type LapSource = 'line' | 'ecu'

/**
 * A lap's manual overlay-alignment shift (#9 GNSS-offset fine-tune), kept
 * SEPARATELY per X axis because the units differ: `time` is in seconds and
 * `dist` is in metres — the same units as the overlay's lap-relative X in each
 * mode. Switching axes therefore preserves both nudges instead of misapplying
 * one unit's value to the other.
 */
export interface LapOffset {
  time: number
  dist: number
}

/**
 * One configurable column in the lap table, backed by a {@link LapMetric}. The
 * metric is the single source of how the column's per-lap value is computed —
 * today a channel aggregation, tomorrow delta-time / sector metrics — so the
 * column model no longer hard-codes "channel + aggregation". `id` is a stable,
 * unique handle. (For a channel metric, an empty `channel` renders as '—'.)
 */
export interface LapMetricColumn {
  id: number
  metric: LapMetric
}

/** Transient lap-detection UI state: the start/finish line and detection mode. */
export const useLapStore = defineStore('lap', () => {
  // Stored in GEO coords (lat/lon) so it survives canvas resize / refit.
  const line = ref<LapLine | null>(null)
  const source = ref<LapSource>('line')
  // Indices of the laps selected in the table, kept in SELECTION ORDER so each
  // lap's color (assigned by order) stays stable as laps are added/removed.
  // Drives chart zoom and the colored segments on the track map.
  const selected = ref<number[]>([])
  // Indices of laps the user has marked as garbage (e.g. an off-track "cut" lap)
  // so they don't pollute best-lap / future optimal-time & delta computations.
  // Order is irrelevant (membership only), unlike `selected`.
  const excluded = ref<number[]>([])
  // User-configured statistics columns for the lap table.
  const columns = ref<LapMetricColumn[]>([])
  // Monotonic id source so column ids stay unique across add/remove.
  let nextColumnId = 1
  // Per-lap overlay-alignment shifts, keyed by lap index. Absent = {time:0,dist:0}.
  // The single owner of the #9 alignment nudges; the overlay derives from these.
  const offsets = ref<Record<number, LapOffset>>({})

  function setLine(l: LapLine): void {
    line.value = l
  }

  function clearLine(): void {
    line.value = null
  }

  function setSource(s: LapSource): void {
    source.value = s
  }

  /** Add lap `i` to the selection (appended), or remove it when already present. */
  function toggleLap(i: number): void {
    selected.value = selected.value.includes(i)
      ? selected.value.filter((x) => x !== i)
      : [...selected.value, i]
  }

  /** Clear the whole lap selection. */
  function clearSelection(): void {
    selected.value = []
  }

  /** Whether lap `i` is currently selected. */
  function isSelected(i: number): boolean {
    return selected.value.includes(i)
  }

  /** Mark lap `i` as garbage, or un-mark it when already excluded. */
  function toggleExcluded(i: number): void {
    excluded.value = excluded.value.includes(i)
      ? excluded.value.filter((x) => x !== i)
      : [...excluded.value, i]
  }

  /** Whether lap `i` is currently excluded as garbage. */
  function isExcluded(i: number): boolean {
    return excluded.value.includes(i)
  }

  /** Clear all garbage-lap exclusions. */
  function clearExcluded(): void {
    excluded.value = []
  }

  /** This lap's alignment shift for `axis` (0 when none set). */
  function offsetOf(index: number, axis: XAxis): number {
    const o = offsets.value[index]
    if (!o) return 0
    return axis === 'distance' ? o.dist : o.time
  }

  /** Nudge lap `index` along `axis` by `delta` (seconds for time, metres for distance). */
  function nudgeOffset(index: number, axis: XAxis, delta: number): void {
    const cur = offsets.value[index] ?? { time: 0, dist: 0 }
    offsets.value[index] =
      axis === 'distance' ? { ...cur, dist: cur.dist + delta } : { ...cur, time: cur.time + delta }
  }

  /** Reset lap `index`'s shift on BOTH axes back to zero. */
  function resetOffset(index: number): void {
    delete offsets.value[index]
  }

  /** Clear every lap's alignment shift. */
  function clearOffsets(): void {
    offsets.value = {}
  }

  /** Append a column for any metric kind (channel, lapTime, distance, …). */
  function addColumn(metric: LapMetric): void {
    columns.value.push({ id: nextColumnId++, metric })
  }

  function removeColumn(id: number): void {
    columns.value = columns.value.filter((c) => c.id !== id)
  }

  /**
   * Ergonomic editor for channel-kind columns: set the channel name. No-op if
   * the id is unknown OR the column's metric is not a channel kind (future
   * delta/sector columns aren't edited this way).
   */
  function setColumnChannel(id: number, channel: string): void {
    const col = columns.value.find((c) => c.id === id)
    if (col && col.metric.kind === 'channel') col.metric.channel = channel
  }

  /** Ergonomic editor for channel-kind columns: set the aggregation. Same no-op rules. */
  function setColumnAgg(id: number, agg: Aggregation): void {
    const col = columns.value.find((c) => c.id === id)
    if (col && col.metric.kind === 'channel') col.metric.agg = agg
  }

  return {
    line,
    source,
    selected,
    excluded,
    columns,
    offsets,
    setLine,
    clearLine,
    setSource,
    toggleLap,
    clearSelection,
    isSelected,
    toggleExcluded,
    isExcluded,
    clearExcluded,
    offsetOf,
    nudgeOffset,
    resetOffset,
    clearOffsets,
    addColumn,
    removeColumn,
    setColumnChannel,
    setColumnAgg,
  }
})
