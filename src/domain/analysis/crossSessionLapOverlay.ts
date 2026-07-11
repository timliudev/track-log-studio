import type { Lap } from '@/domain/model/Lap'
import type { OverlayChannel } from './lapOverlay'

export interface CrossSessionLapSource {
  fileId: number
  sessionName: string
  color: string
  xValues: ArrayLike<number>
  channels: OverlayChannel[]
  lap: Lap
  offset?: number
}

export interface CrossSessionLapSeries {
  fileId: number
  sessionName: string
  color: string
  channelIndex: number
  lapOrder: number
  lap: Lap
  y: Float64Array
}

export interface CrossSessionLapOverlay {
  x: Float64Array
  series: CrossSessionLapSeries[]
}

function resample(source: CrossSessionLapSource, channel: OverlayChannel, grid: Float64Array): Float64Array {
  const y = new Float64Array(grid.length).fill(NaN)
  const { lap, xValues } = source
  const x0 = xValues[lap.startIdx]
  const offset = source.offset ?? 0
  const xs: number[] = []
  const values: number[] = []
  for (let i = lap.startIdx; i <= lap.endIdx; i++) {
    const x = xValues[i]
    const value = channel.data[i]
    if (!Number.isFinite(x) || !Number.isFinite(value)) continue
    xs.push(x - x0 + offset)
    values.push(value)
  }
  if (xs.length === 0) return y
  let p = 0
  for (let g = 0; g < grid.length; g++) {
    const gx = grid[g]
    if (gx < xs[0] || gx > xs[xs.length - 1]) continue
    while (p < xs.length - 1 && xs[p + 1] < gx) p++
    if (p >= xs.length - 1) y[g] = values[values.length - 1]
    else {
      const span = xs[p + 1] - xs[p]
      y[g] = span > 0 ? values[p] + ((values[p + 1] - values[p]) * (gx - xs[p])) / span : values[p]
    }
  }
  return y
}

/** Rebase laps from independent session index spaces onto one shared grid. */
export function buildCrossSessionLapOverlay(
  sources: readonly CrossSessionLapSource[],
  gridPoints = 600,
): CrossSessionLapOverlay {
  if (sources.length === 0 || sources.every((source) => source.channels.length === 0)) {
    return { x: new Float64Array(0), series: [] }
  }
  let min = 0
  let max = 0
  for (const source of sources) {
    const offset = source.offset ?? 0
    const extent = source.xValues[source.lap.endIdx] - source.xValues[source.lap.startIdx]
    if (!Number.isFinite(extent)) continue
    min = Math.min(min, offset)
    max = Math.max(max, offset + extent)
  }
  const span = max > min ? max - min : 1
  const x = new Float64Array(gridPoints)
  for (let i = 0; i < gridPoints; i++) x[i] = min + (span * i) / Math.max(gridPoints - 1, 1)
  const series: CrossSessionLapSeries[] = []
  sources.forEach((source, lapOrder) => {
    source.channels.forEach((channel, channelIndex) => series.push({
      fileId: source.fileId,
      sessionName: source.sessionName,
      color: source.color,
      channelIndex,
      lapOrder,
      lap: source.lap,
      y: resample(source, channel, x),
    }))
  })
  return { x, series }
}
