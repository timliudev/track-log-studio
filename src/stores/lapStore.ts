import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LapLine } from '@/domain/analysis/laps'
import type { Aggregation } from '@/domain/analysis/lapAggregate'
import type { LapMetric } from '@/domain/analysis/lapMetrics'
import { outOfBandLapIndices, type LapTimeBand } from '@/domain/analysis/lapValidity'
import type { Lap } from '@/domain/model/Lap'
import type { XAxis } from '@/stores/analyzerStore'

/** How laps are detected: a user-placed start/finish line, or the ECU channel. */
export type LapSource = 'line' | 'ecu'

/**
 * A lap's manual alignment shift (#9 GNSS-offset fine-tune). Two independent
 * facets:
 *  - CHART X-axis nudge, kept SEPARATELY per axis because the units differ:
 *    `time` (seconds) and `dist` (metres) — the same units as the overlay's
 *    lap-relative X in each mode, so switching axes preserves both nudges.
 *  - MAP 2-D position nudge `mapX`/`mapY` in METRES (east+/north+), to align
 *    racing lines that GNSS drift has offset between laps on the track map.
 */
export interface LapOffset {
  time: number
  dist: number
  mapX: number
  mapY: number
}

const ZERO_OFFSET: LapOffset = { time: 0, dist: 0, mapX: 0, mapY: 0 }

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
  // Indices of laps the user has MANUALLY marked as garbage (e.g. an off-track
  // "cut" lap) so they don't pollute best-lap / future optimal-time & delta
  // computations. Order is irrelevant (membership only), unlike `selected`.
  const manualExcluded = ref<number[]>([])
  // The currently-detected laps, kept here so the store can derive validity-based
  // exclusions (out-of-band laps) from lap times. Pushed in by `useLaps`; the
  // single feed for the time-band filter and a future LapMetric validity flag.
  const laps = ref<Lap[]>([])
  // Optional valid-lap-time band (seconds, inclusive bounds, either side null to
  // leave it open). When null/empty the included set is identical to manual-only.
  const lapTimeBand = ref<LapTimeBand | null>(null)

  // Lap indices excluded because their lap time falls outside the band; empty
  // when no band is set. A SEPARATE exclusion reason that unions with the manual
  // one — the future "sector completeness" rule can union in the very same way.
  const bandExcluded = computed<number[]>(() => outOfBandLapIndices(laps.value, lapTimeBand.value))

  // The effective exclusion set feeding best-lap / delta / overlays: a lap is
  // excluded iff it is MANUALLY excluded OR out-of-band. With no band this equals
  // `manualExcluded` exactly (no regression). De-duplicated so a lap that is both
  // manually excluded and out-of-band appears once.
  const excluded = computed<number[]>(() => [
    ...new Set([...manualExcluded.value, ...bandExcluded.value]),
  ])
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

  /** Manually mark lap `i` as garbage, or un-mark it when already manually excluded. */
  function toggleExcluded(i: number): void {
    manualExcluded.value = manualExcluded.value.includes(i)
      ? manualExcluded.value.filter((x) => x !== i)
      : [...manualExcluded.value, i]
  }

  /** Whether lap `i` is MANUALLY excluded (the user's per-lap toggle state). */
  function isManuallyExcluded(i: number): boolean {
    return manualExcluded.value.includes(i)
  }

  /**
   * Whether lap `i` is excluded for ANY reason (manual OR out-of-band) — i.e.
   * omitted from best-lap / delta / overlays. This is what UI should test to dim
   * a row; {@link isManuallyExcluded} is for the per-lap toggle's pressed state.
   */
  function isExcluded(i: number): boolean {
    return excluded.value.includes(i)
  }

  /** Clear all MANUAL garbage-lap exclusions (the band, if any, still applies). */
  function clearExcluded(): void {
    manualExcluded.value = []
  }

  /** Replace the detected-laps the store derives band exclusions from. */
  function setLaps(next: Lap[]): void {
    laps.value = next
  }

  /**
   * Set the valid lap-time band (seconds, inclusive). Either bound may be null to
   * leave that side open; an all-null band clears the constraint. Out-of-band
   * laps are then folded into the excluded set automatically.
   */
  function setLapTimeBand(band: LapTimeBand | null): void {
    lapTimeBand.value =
      band && (band.minSec != null || band.maxSec != null) ? band : null
  }

  /** Clear the valid lap-time band (manual exclusions are untouched). */
  function clearLapTimeBand(): void {
    lapTimeBand.value = null
  }

  /** This lap's CHART shift for `axis` (0 when none set). */
  function offsetOf(index: number, axis: XAxis): number {
    const o = offsets.value[index]
    if (!o) return 0
    return axis === 'distance' ? o.dist : o.time
  }

  /** This lap's MAP position shift in metres (east+/north+); zero when none set. */
  function mapOffsetOf(index: number): { x: number; y: number } {
    const o = offsets.value[index]
    return o ? { x: o.mapX, y: o.mapY } : { x: 0, y: 0 }
  }

  /** Nudge lap `index`'s CHART shift along `axis` (seconds for time, metres for distance). */
  function nudgeOffset(index: number, axis: XAxis, delta: number): void {
    const cur = offsets.value[index] ?? { ...ZERO_OFFSET }
    offsets.value[index] =
      axis === 'distance' ? { ...cur, dist: cur.dist + delta } : { ...cur, time: cur.time + delta }
  }

  /** Nudge lap `index`'s MAP position by (`dx` east, `dy` north) metres. */
  function nudgeMapOffset(index: number, dx: number, dy: number): void {
    const cur = offsets.value[index] ?? { ...ZERO_OFFSET }
    offsets.value[index] = { ...cur, mapX: cur.mapX + dx, mapY: cur.mapY + dy }
  }

  /** Reset lap `index`'s CHART shift (both axes) to zero; keeps the map shift. */
  function resetOffset(index: number): void {
    const cur = offsets.value[index]
    if (cur) offsets.value[index] = { ...cur, time: 0, dist: 0 }
  }

  /** Reset lap `index`'s MAP shift to zero; keeps the chart shift. */
  function resetMapOffset(index: number): void {
    const cur = offsets.value[index]
    if (cur) offsets.value[index] = { ...cur, mapX: 0, mapY: 0 }
  }

  /** Clear every lap's alignment shift (both facets). */
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
    manualExcluded,
    bandExcluded,
    lapTimeBand,
    columns,
    offsets,
    setLine,
    clearLine,
    setSource,
    toggleLap,
    clearSelection,
    isSelected,
    toggleExcluded,
    isManuallyExcluded,
    isExcluded,
    clearExcluded,
    setLaps,
    setLapTimeBand,
    clearLapTimeBand,
    offsetOf,
    mapOffsetOf,
    nudgeOffset,
    nudgeMapOffset,
    resetOffset,
    resetMapOffset,
    clearOffsets,
    addColumn,
    removeColumn,
    setColumnChannel,
    setColumnAgg,
  }
})
