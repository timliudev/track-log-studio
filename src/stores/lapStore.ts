import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LapLine } from '@/domain/analysis/laps'
import type { Aggregation } from '@/domain/analysis/lapAggregate'
import type { LapMetric } from '@/domain/analysis/lapMetrics'
import {
  outOfBandLapIndices,
  outOfBandDistanceLapIndices,
  type LapTimeBand,
  type LapDistanceBand,
} from '@/domain/analysis/lapValidity'
import { invalidSectorLapIndices } from '@/domain/analysis/sectorValidity'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { XAxis } from '@/stores/analyzerStore'
import { useSectorStore } from '@/stores/sectorStore'

/** How laps are detected: a user-placed start/finish line, or the ECU channel. */
export type LapSource = 'line' | 'ecu'

/** Stable lap identity once more than one recording is in play. */
export interface SessionLapRef {
  fileId: number
  index: number
}

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
  // Cross-recording selection used by overlay charts. The legacy `selected`
  // remains the primary recording's index list so every single-file consumer
  // keeps its established API and persistence semantics.
  const selectedAcrossSessions = ref<SessionLapRef[]>([])
  // Indices of laps the user has MANUALLY marked as garbage (e.g. an off-track
  // "cut" lap) so they don't pollute best-lap / future optimal-time & delta
  // computations. Order is irrelevant (membership only), unlike `selected`.
  const manualExcluded = ref<number[]>([])
  // The currently-detected laps, kept here so the store can derive validity-based
  // exclusions (out-of-band laps) from lap times. Pushed in by `useLaps`; the
  // single feed for the time-band filter and the sector-completeness rule below.
  const laps = ref<Lap[]>([])
  // The active session's GPS track, kept here (same "pushed in" pattern as
  // `laps`) so the store can derive sector-gate-crossing validity without
  // reaching into `useActiveSession` itself. Pushed in by `useLaps`.
  const track = ref<GpsTrack | null>(null)
  // Optional valid-lap-time band (seconds, inclusive bounds, either side null to
  // leave it open). When null/empty the included set is identical to manual-only.
  const lapTimeBand = ref<LapTimeBand | null>(null)
  // Optional valid-lap-DISTANCE band (metres, same inclusive/open-side rules as
  // the time band). An INDEPENDENT signal from the time band — a cut-course lap
  // can wait inside the track long enough to match the time band, but its
  // distance is clearly short, and a wrong-line/extra-loop lap is clearly long.
  const lapDistanceBand = ref<LapDistanceBand | null>(null)

  // Cross-store read: confirmed sector gates live in sectorStore (drawn/accepted
  // via SectorPanel). Read here, at store setup, same pattern as
  // `converterStore` reading `fileStore`/`suspensionStore`.
  const sectorStore = useSectorStore()

  // Lap indices excluded because their lap time falls outside the band; empty
  // when no band is set. A SEPARATE exclusion reason that unions with the manual
  // one — the sector-completeness rule below unions in the very same way.
  const bandExcluded = computed<number[]>(() => outOfBandLapIndices(laps.value, lapTimeBand.value))

  // Lap indices excluded because their travelled DISTANCE falls outside the
  // distance band; empty when no distance band is set. Independent of, and
  // combined (unioned) with, the time-band exclusion below — a lap must pass
  // BOTH bands to be included.
  const distanceBandExcluded = computed<number[]>(() =>
    outOfBandDistanceLapIndices(laps.value, track.value, lapDistanceBand.value),
  )

  // Lap indices excluded because they fail to cross every confirmed sector gate,
  // in order (missed gate, or an infield cut / 切西瓜 that crosses them out of
  // sequence). Empty whenever there is no track yet or no gates are confirmed —
  // so with zero gates this term contributes nothing, keeping `excluded`
  // byte-identical to before sector gates existed.
  const sectorInvalid = computed<number[]>(() =>
    track.value ? invalidSectorLapIndices(laps.value, track.value, sectorStore.gates) : [],
  )

  // The effective exclusion set feeding best-lap / delta / overlays: a lap is
  // excluded iff it is MANUALLY excluded OR out-of-time-band OR
  // out-of-distance-band OR sector-invalid. With no bands and no confirmed
  // gates this equals `manualExcluded` exactly (no regression). De-duplicated
  // so a lap excluded for multiple reasons appears once.
  const excluded = computed<number[]>(() => [
    ...new Set([
      ...manualExcluded.value,
      ...bandExcluded.value,
      ...distanceBandExcluded.value,
      ...sectorInvalid.value,
    ]),
  ])
  // User-configured statistics columns for the lap table.
  const columns = ref<LapMetricColumn[]>([])
  // Monotonic id source so column ids stay unique across add/remove.
  let nextColumnId = 1
  // Per-lap overlay-alignment shifts, keyed by lap index. Absent = {time:0,dist:0}.
  // The single owner of the #9 alignment nudges; the overlay derives from these.
  const offsets = ref<Record<number, LapOffset>>({})
  const sessionLapOffsets = ref<Record<string, LapOffset>>({})
  const sessionLapKey = (fileId: number, index: number): string => `${fileId}:${index}`

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

  function toggleSessionLap(fileId: number, index: number): void {
    const found = selectedAcrossSessions.value.some((ref) => ref.fileId === fileId && ref.index === index)
    selectedAcrossSessions.value = found
      ? selectedAcrossSessions.value.filter((ref) => ref.fileId !== fileId || ref.index !== index)
      : [...selectedAcrossSessions.value, { fileId, index }]
  }

  function isSessionLapSelected(fileId: number, index: number): boolean {
    return selectedAcrossSessions.value.some((ref) => ref.fileId === fileId && ref.index === index)
  }

  function clearSessionSelection(fileId?: number): void {
    if (fileId == null) selectedAcrossSessions.value = []
    else selectedAcrossSessions.value = selectedAcrossSessions.value.filter((ref) => ref.fileId !== fileId)
  }

  function sessionLapOffsetOf(fileId: number, index: number, axis: XAxis): number {
    const offset = sessionLapOffsets.value[sessionLapKey(fileId, index)] ?? ZERO_OFFSET
    return axis === 'time' ? offset.time : offset.dist
  }

  function nudgeSessionLapOffset(fileId: number, index: number, axis: XAxis, delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return
    const key = sessionLapKey(fileId, index)
    const current = sessionLapOffsets.value[key] ?? ZERO_OFFSET
    sessionLapOffsets.value = {
      ...sessionLapOffsets.value,
      [key]: { ...current, [axis === 'time' ? 'time' : 'dist']: sessionLapOffsetOf(fileId, index, axis) + delta },
    }
  }

  function resetSessionLapOffset(fileId: number, index: number): void {
    const next = { ...sessionLapOffsets.value }
    delete next[sessionLapKey(fileId, index)]
    sessionLapOffsets.value = next
  }

  function clearAllLapSelections(): void {
    selected.value = []
    selectedAcrossSessions.value = []
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
   * Whether lap `i` is excluded for ANY reason (manual OR out-of-band OR
   * sector-invalid) — i.e. omitted from best-lap / delta / overlays. This is
   * what UI should test to dim a row; {@link isManuallyExcluded} is for the
   * per-lap toggle's pressed state.
   */
  function isExcluded(i: number): boolean {
    return excluded.value.includes(i)
  }

  /** Clear all MANUAL garbage-lap exclusions (the band, if any, still applies). */
  function clearExcluded(): void {
    manualExcluded.value = []
  }

  /**
   * Why lap `i` is excluded, for UI that needs to explain (not just show) the
   * exclusion — e.g. the ⦸ toggle's tooltip. `null` when the lap isn't
   * excluded at all. When a lap is excluded for multiple reasons, 'manual'
   * wins (it's the one thing the user can still directly undo), then
   * 'timeBand', then 'distBand', then 'sector'.
   */
  function exclusionReason(i: number): 'manual' | 'timeBand' | 'distBand' | 'sector' | null {
    if (manualExcluded.value.includes(i)) return 'manual'
    if (bandExcluded.value.includes(i)) return 'timeBand'
    if (distanceBandExcluded.value.includes(i)) return 'distBand'
    if (sectorInvalid.value.includes(i)) return 'sector'
    return null
  }

  /** Replace the detected-laps the store derives band exclusions from. */
  function setLaps(next: Lap[]): void {
    laps.value = next
  }

  /** Replace the active session's GPS track the store derives sector-gate validity from. */
  function setTrack(next: GpsTrack | null): void {
    track.value = next
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

  /**
   * Set the valid lap-distance band (metres, inclusive). Either bound may be
   * null to leave that side open; an all-null band clears the constraint.
   * Out-of-band laps are then folded into the excluded set automatically.
   */
  function setLapDistanceBand(band: LapDistanceBand | null): void {
    lapDistanceBand.value = band && (band.minM != null || band.maxM != null) ? band : null
  }

  /** Clear the valid lap-distance band (manual exclusions/time band are untouched). */
  function clearLapDistanceBand(): void {
    lapDistanceBand.value = null
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
    sessionLapOffsets.value = {}
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

  /**
   * Ergonomic editor for sectorTime-kind columns: set which sector (0-based,
   * start/finish -> gate1 is sector 0) the column shows. No-op if the id is
   * unknown or the column's metric is not a sectorTime kind.
   */
  function setColumnSector(id: number, sector: number): void {
    const col = columns.value.find((c) => c.id === id)
    if (col && col.metric.kind === 'sectorTime') col.metric.sector = sector
  }

  return {
    line,
    source,
    selected,
    selectedAcrossSessions,
    excluded,
    manualExcluded,
    bandExcluded,
    distanceBandExcluded,
    sectorInvalid,
    lapTimeBand,
    lapDistanceBand,
    columns,
    offsets,
    sessionLapOffsets,
    setLine,
    clearLine,
    setSource,
    toggleLap,
    clearSelection,
    isSelected,
    toggleSessionLap,
    isSessionLapSelected,
    clearSessionSelection,
    clearAllLapSelections,
    sessionLapOffsetOf,
    nudgeSessionLapOffset,
    resetSessionLapOffset,
    toggleExcluded,
    isManuallyExcluded,
    isExcluded,
    exclusionReason,
    clearExcluded,
    setLaps,
    setTrack,
    setLapTimeBand,
    clearLapTimeBand,
    setLapDistanceBand,
    clearLapDistanceBand,
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
    setColumnSector,
  }
})
