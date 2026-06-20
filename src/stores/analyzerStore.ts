import { defineStore } from 'pinia'
import { ref } from 'vue'
import { COLORMAP_IDS, type ColormapId } from '@/domain/analysis/colormap'

export type XAxis = 'time' | 'distance'

/**
 * How a chart plots its channels:
 * - `timeline`: each channel over the full session, shared X (time/distance).
 * - `overlay`: the selected laps re-based to a lap-relative X (from 0) and
 *   overlaid — colour by lap, line style by channel (see {@link buildLapOverlay}).
 */
export type ChartMode = 'timeline' | 'overlay'

/** One chart on the analyzer dashboard. */
export interface ChartConfig {
  id: number
  channels: string[]
  mode: ChartMode
}

/** Transient analyzer UI state. The data itself comes from converterStore. */
export const useAnalyzerStore = defineStore('analyzer', () => {
  const activeFileId = ref<number | null>(null)
  const xAxis = ref<XAxis>('time')
  const charts = ref<ChartConfig[]>([{ id: 1, channels: [], mode: 'timeline' }])
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
  // Track heatmap (#10/#11): colour the track polyline by this channel's value
  // (null = plain track) using the chosen colormap. Transient analyzer state
  // like charts/cursor — not persisted (persistence is queue item D).
  const trackColorChannel = ref<string | null>(null)
  const trackColormap = ref<ColormapId>(COLORMAP_IDS[0])
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

  function setTrackColorChannel(name: string | null): void {
    trackColorChannel.value = name
  }

  function setTrackColormap(id: ColormapId): void {
    trackColormap.value = id
  }

  function addChart(): void {
    charts.value.push({ id: nextId++, channels: [], mode: 'timeline' })
  }

  function removeChart(id: number): void {
    charts.value = charts.value.filter((c) => c.id !== id)
  }

  function setChartChannels(id: number, channels: string[]): void {
    const chart = charts.value.find((c) => c.id === id)
    if (chart) chart.channels = channels
  }

  function setChartMode(id: number, mode: ChartMode): void {
    const chart = charts.value.find((c) => c.id === id)
    if (chart) chart.mode = mode
  }

  return {
    activeFileId,
    xAxis,
    charts,
    xRange,
    cursorIdx,
    overlayCursorIdx,
    trackColorChannel,
    trackColormap,
    setXRange,
    setCursor,
    setOverlayCursor,
    setTrackColorChannel,
    setTrackColormap,
    addChart,
    removeChart,
    setChartChannels,
    setChartMode,
  }
})
