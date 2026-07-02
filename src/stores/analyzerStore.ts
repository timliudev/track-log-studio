import { defineStore } from 'pinia'
import { ref } from 'vue'
import { COLORMAP_IDS, type ColormapId } from '@/domain/analysis/colormap'

export type XAxis = 'time' | 'distance'

/** Phase 7 — acceleration/drag test condition: which of the two
 *  `accelTest.ts` searches to run and its parameters. Discriminated union so
 *  the panel/store only ever hold ONE condition's params at a time (switching
 *  type doesn't require clearing unrelated fields — see `setAccelCondition`). */
export type AccelCondition =
  | { kind: 'distance'; distanceM: number; minEntrySpeedKmh: number | null }
  | { kind: 'speed'; fromKmh: number; toKmh: number }

/**
 * How a chart plots its channels:
 * - `timeline`: each channel over the full session, shared X (time/distance).
 * - `overlay`: the selected laps re-based to a lap-relative X (from 0) and
 *   overlaid — colour by lap, line style by channel (see {@link buildLapOverlay}).
 */
export type ChartMode = 'timeline' | 'overlay'

/** A time-series chart (existing behaviour, unchanged): N channels over a
 *  shared X (time/distance or lap-relative overlay — see {@link ChartMode}). */
export interface TimeSeriesChartConfig {
  kind: 'timeseries'
  id: number
  channels: string[]
  mode: ChartMode
}

/** A10+A12 — XY scatter chart: any two channels plotted against each other
 *  (free choice, not limited to force channels — the friction-circle G-G
 *  diagram is just the default/featured use). Independent per-instance state,
 *  same as timeseries charts; does NOT participate in the shared X
 *  cursor/zoom (different axis domain — see ScatterChart.vue). */
export interface ScatterChartConfig {
  kind: 'scatter'
  id: number
  xChannel: string | null
  yChannel: string | null
}

/** One chart on the analyzer dashboard. Discriminated on `kind` so existing
 *  timeseries behaviour stays byte-compatible; charts are transient UI state
 *  (not persisted), so this shape can evolve freely. */
export type ChartConfig = TimeSeriesChartConfig | ScatterChartConfig

/** Transient analyzer UI state. The data itself comes from converterStore. */
export const useAnalyzerStore = defineStore('analyzer', () => {
  const activeFileId = ref<number | null>(null)
  const xAxis = ref<XAxis>('time')
  const charts = ref<ChartConfig[]>([{ kind: 'timeseries', id: 1, channels: [], mode: 'timeline' }])
  // Shared X-axis zoom range across all charts (null = auto / full extent).
  const xRange = ref<{ min: number; max: number } | null>(null)
  // Shared hovered sample index across charts + track map (null = no hover).
  // Owned here (not locally in AnalyzerView) so future cursor-following readouts
  // can subscribe to it; presentational charts still receive it as a prop.
  const cursorIdx = ref<number | null>(null)
  // Separate shared cursor for OVERLAY charts: an index into the shared
  // lap-relative grid (not a session sample index). Overlay charts all build the
  // same grid (same xValues + selected laps + gridPoints), so this index aligns
  // across them — but it's meaningless to timeline charts / the track map, which
  // live in session-index space, hence a distinct ref instead of reusing cursorIdx.
  const overlayCursorIdx = ref<number | null>(null)
  // A9 — unified track-channel control (梁道上色 + 極值標記 merged into one
  // channel-driven control): pick ONE channel, then independently choose to
  // colour the track by it (heatmap, ex-trackColorChannel/#10/#11) and/or mark
  // its local minima/maxima on the map (ex-showCornerSpeed, generalised from
  // speed-only apexes to any channel — see cornerSpeed.ts's
  // detectChannelExtrema). Transient analyzer state like charts/cursor — not
  // persisted (persistence is queue item D). One owner (this group); the
  // heatmap norm and extrema themselves are DERIVED in AnalyzerView, not
  // stored here (same "one owner, derive via computed" rule as cornerApexes
  // used to follow).
  const trackChannel = ref<string | null>(null)
  const trackColormap = ref<ColormapId>(COLORMAP_IDS[0])
  const trackColorEnabled = ref(false)
  const markMinima = ref(false)
  const markMaxima = ref(false)
  // Phase 7 — acceleration/drag test (加速測試): the panel's condition config.
  // Transient like the other analyzer toggles above (not persisted); the
  // RESULT itself is not stored here — it's derived in AnalyzerView from this
  // config + the active session (see accelTest.ts), same "one owner, derive
  // via computed" rule as cornerApexes.
  const accelCondition = ref<AccelCondition>({
    kind: 'distance',
    distanceM: 100,
    minEntrySpeedKmh: null,
  })
  let nextId = 2

  function setXRange(range: { min: number; max: number } | null): void {
    xRange.value = range
  }

  function setCursor(i: number | null): void {
    cursorIdx.value = i
  }

  function setOverlayCursor(i: number | null): void {
    overlayCursorIdx.value = i
  }

  /** Picking a new channel doesn't implicitly change the enabled toggles —
   *  switching from "speed, min-marked" to "RPM" keeps min-marking on, now
   *  for RPM. Matches the task's "pick a channel once, then independently
   *  choose" framing: the channel and the three toggles are orthogonal. */
  function setTrackChannel(name: string | null): void {
    trackChannel.value = name
  }

  function setTrackColormap(id: ColormapId): void {
    trackColormap.value = id
  }

  function setTrackColorEnabled(on: boolean): void {
    trackColorEnabled.value = on
  }

  function setMarkMinima(on: boolean): void {
    markMinima.value = on
  }

  function setMarkMaxima(on: boolean): void {
    markMaxima.value = on
  }

  function setAccelCondition(condition: AccelCondition): void {
    accelCondition.value = condition
  }

  /** Add a new chart. `kind` defaults to 'timeseries' (existing behaviour,
   *  unchanged call sites keep working). For 'scatter', callers may pass an
   *  initial X/Y pick (e.g. AnalyzerView defaulting to TC_Xforce/TC_Yforce
   *  for the friction-circle convenience when those channels exist) — the
   *  store itself doesn't know about sessions/channels. */
  function addChart(kind?: 'timeseries'): void
  function addChart(kind: 'scatter', initial?: { xChannel?: string | null; yChannel?: string | null }): void
  function addChart(
    kind: ChartConfig['kind'] = 'timeseries',
    initial?: { xChannel?: string | null; yChannel?: string | null },
  ): void {
    if (kind === 'scatter') {
      charts.value.push({
        kind: 'scatter',
        id: nextId++,
        xChannel: initial?.xChannel ?? null,
        yChannel: initial?.yChannel ?? null,
      })
    } else {
      charts.value.push({ kind: 'timeseries', id: nextId++, channels: [], mode: 'timeline' })
    }
  }

  function removeChart(id: number): void {
    charts.value = charts.value.filter((c) => c.id !== id)
  }

  function setChartChannels(id: number, channels: string[]): void {
    const chart = charts.value.find((c) => c.id === id)
    if (chart && chart.kind === 'timeseries') chart.channels = channels
  }

  function setChartMode(id: number, mode: ChartMode): void {
    const chart = charts.value.find((c) => c.id === id)
    if (chart && chart.kind === 'timeseries') chart.mode = mode
  }

  /** Set a scatter chart's X and/or Y channel (whichever is provided);
   *  omitted sides are left unchanged — mirrors setChartChannels' "only
   *  touch the targeted chart" contract. */
  function setChartXY(id: number, axis: 'x' | 'y', channel: string | null): void {
    const chart = charts.value.find((c) => c.id === id)
    if (!chart || chart.kind !== 'scatter') return
    if (axis === 'x') chart.xChannel = channel
    else chart.yChannel = channel
  }

  return {
    activeFileId,
    xAxis,
    charts,
    xRange,
    cursorIdx,
    overlayCursorIdx,
    trackChannel,
    trackColormap,
    trackColorEnabled,
    markMinima,
    markMaxima,
    accelCondition,
    setXRange,
    setCursor,
    setOverlayCursor,
    setTrackChannel,
    setTrackColormap,
    setTrackColorEnabled,
    setMarkMinima,
    setMarkMaxima,
    setAccelCondition,
    addChart,
    removeChart,
    setChartChannels,
    setChartMode,
    setChartXY,
  }
})
