import { lttb } from './downsample'

export interface TimelineSource {
  id: number
  label: string
  color: string
  primary: boolean
  xValues: ArrayLike<number>
  channels: ReadonlyMap<string, ArrayLike<number>>
}

export interface TimelineSeriesMeta {
  sourceId: number
  sourceLabel: string
  channel: string
  color: string
  primary: boolean
  channelIndex: number
}

export interface TimelineBuildResult {
  data: [number[], ...(Array<number | null>)[]]
  series: TimelineSeriesMeta[]
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBound(values: ArrayLike<number>, target: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function visibleSlice(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  range: { min: number; max: number } | null,
): { x: number[]; y: number[] } {
  const n = Math.min(x.length, y.length)
  if (n === 0) return { x: [], y: [] }
  let start = 0
  let end = n
  if (range) {
    if (x[n - 1] < range.min || x[0] > range.max) return { x: [], y: [] }
    // Keep one point beyond each visible edge so line interpolation reaches
    // the viewport boundary instead of stopping at its first in-range sample.
    start = Math.max(0, lowerBound(x, range.min) - 1)
    end = Math.min(n, upperBound(x, range.max) + 1)
  }
  return {
    x: Array.from({ length: end - start }, (_, i) => x[start + i]),
    y: Array.from({ length: end - start }, (_, i) => y[start + i]),
  }
}

/** Build one aligned uPlot table from independent session axes. Each source
 * series is range-cropped then LTTB-downsampled before axes are joined, so
 * memory/render cost is bounded by (visible series × maxPoints), not raw logs. */
export function buildTimelineData(
  sources: readonly TimelineSource[],
  channelNames: readonly string[],
  range: { min: number; max: number } | null,
  maxPoints: number,
): TimelineBuildResult {
  const tables: { x: number[]; y: number[] }[] = []
  const series: TimelineSeriesMeta[] = []

  for (const source of sources) {
    channelNames.forEach((channel, channelIndex) => {
      const values = source.channels.get(channel)
      if (!values) return
      const visible = visibleSlice(source.xValues, values, range)
      const sampled = visible.x.length > maxPoints
        ? lttb(visible.x, visible.y, maxPoints)
        : visible
      tables.push(sampled)
      series.push({
        sourceId: source.id,
        sourceLabel: source.label,
        channel,
        color: source.color,
        primary: source.primary,
        channelIndex,
      })
    })
  }

  const xs = Array.from(new Set(tables.flatMap((table) => table.x))).sort((a, b) => a - b)
  const indexByX = new Map(xs.map((x, index) => [x, index]))
  const ys = tables.map((table) => {
    const aligned = new Array<number | null>(xs.length).fill(null)
    for (let i = 0; i < table.x.length; i++) {
      const index = indexByX.get(table.x[i])
      if (index != null) aligned[index] = Number.isFinite(table.y[i]) ? table.y[i] : null
    }
    return aligned
  })
  return { data: [xs, ...ys], series }
}

/** Nearest finite X sample, used to translate between the joined/downsampled
 * chart index and the primary session's full-resolution cursor index. */
export function nearestXIndex(values: ArrayLike<number>, target: number): number | null {
  if (values.length === 0 || !Number.isFinite(target)) return null
  const right = lowerBound(values, target)
  if (right <= 0) return 0
  if (right >= values.length) return values.length - 1
  return target - values[right - 1] <= values[right] - target ? right - 1 : right
}
