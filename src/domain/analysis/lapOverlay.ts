import type { Lap } from '@/domain/model/Lap'

/** One channel's per-sample data plus a display name, for overlaying. */
export interface OverlayChannel {
  name: string
  data: ArrayLike<number>
}

export interface LapOverlayInput {
  /**
   * Session-wide X axis (cumulative distance in metres, or time in ms/s) —
   * monotonically non-decreasing. The lap-relative axis is derived from this by
   * subtracting each lap's start value.
   */
  xValues: ArrayLike<number>
  /** Channels to plot; one resampled trace is produced per (channel, lap). */
  channels: OverlayChannel[]
  /** Laps to overlay, in the order their colours should be assigned. */
  laps: Lap[]
  /**
   * Optional per-lap X shift (parallel to `laps`, same units as `xValues`),
   * added to each lap's lap-relative X so the user can nudge laps left/right to
   * align corresponding features (the #9 GNSS-offset fine-tune). Missing/omitted
   * entries are treated as 0; all-zero offsets reproduce the un-shifted overlay.
   */
  offsets?: number[]
  /** Number of points on the shared lap-relative grid (default 600). */
  gridPoints?: number
}

/** One resampled trace: a single channel of a single lap, on the shared grid. */
export interface LapOverlaySeries {
  /** Index into `input.channels` — drives the line style (dash). */
  channelIndex: number
  /** Index into `input.laps` (= selection order) — drives the colour. */
  lapOrder: number
  lap: Lap
  /** Values on the shared grid; NaN where the grid extends past this lap's span. */
  y: Float64Array
}

export interface LapOverlayResult {
  /** Shared lap-relative grid, 0 .. maxRel, `gridPoints` evenly spaced points. */
  x: Float64Array
  /** One entry per (channel, lap), grouped lap-outer / channel-inner. */
  series: LapOverlaySeries[]
}

/** The span of session-X each lap covers, measured from its own start. */
function lapRelExtent(xValues: ArrayLike<number>, lap: Lap): number {
  return xValues[lap.endIdx] - xValues[lap.startIdx]
}

/**
 * Linear-interpolate a channel onto `grid`, where the source samples are the
 * lap's relative-X (`xValues[i] - x0 + offset`) against the channel value. The
 * `offset` slides this lap along the shared grid (the #9 alignment nudge). Both
 * `grid` and the source relative-X are ascending, so a single forward-moving
 * pointer walks the source once. Grid points outside this lap's own (shifted)
 * span → NaN (the line simply ends); non-finite source samples are skipped.
 */
function resampleLap(
  grid: Float64Array,
  xValues: ArrayLike<number>,
  data: ArrayLike<number>,
  lap: Lap,
  offset: number,
): Float64Array {
  const y = new Float64Array(grid.length).fill(NaN)
  const x0 = xValues[lap.startIdx]

  // Collect this lap's valid (relX, value) samples in order. relX is ascending
  // because xValues is non-decreasing (offset is a constant shift); equal-X
  // duplicates are harmless (the interpolation just picks the first segment that
  // brackets a grid point).
  const relX: number[] = []
  const val: number[] = []
  for (let i = lap.startIdx; i <= lap.endIdx; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) continue
    relX.push(xValues[i] - x0 + offset)
    val.push(v)
  }
  if (relX.length === 0) return y

  const lo = relX[0]
  const hi = relX[relX.length - 1]
  let p = 0 // index of the source segment start being considered
  for (let g = 0; g < grid.length; g++) {
    const gx = grid[g]
    if (gx < lo || gx > hi) continue // outside this lap's shifted span → NaN
    // Advance until relX[p+1] >= gx, so [p, p+1] brackets gx.
    while (p < relX.length - 1 && relX[p + 1] < gx) p++
    if (p >= relX.length - 1) {
      y[g] = val[relX.length - 1]
    } else {
      const xa = relX[p]
      const xb = relX[p + 1]
      const span = xb - xa
      y[g] = span > 0 ? val[p] + ((val[p + 1] - val[p]) * (gx - xa)) / span : val[p]
    }
  }
  return y
}

/**
 * Build distance/time-aligned overlay traces for a set of laps. Each lap is
 * re-based so its X starts at 0, then every channel is resampled onto one shared
 * grid (0 .. the longest lap's extent). This is what lets uPlot — which needs a
 * single shared X array — draw laps of different lengths on the same chart.
 *
 * Pure; returns an empty result when there are no laps or channels.
 */
export function buildLapOverlay(input: LapOverlayInput): LapOverlayResult {
  const { xValues, channels, laps, offsets } = input
  const gridPoints = input.gridPoints ?? 600
  const offsetAt = (i: number): number => offsets?.[i] ?? 0

  if (laps.length === 0 || channels.length === 0) {
    return { x: new Float64Array(0), series: [] }
  }

  // The grid spans every lap's shifted extent. 0 is kept in range as the nominal
  // alignment point, so with all-zero offsets this is exactly [0, maxRel]; a
  // lap nudged left/right extends the grid so its trace stays fully visible.
  let gridMin = 0
  let gridMax = 0
  laps.forEach((lap, i) => {
    const ext = lapRelExtent(xValues, lap)
    if (!Number.isFinite(ext)) return
    const o = offsetAt(i)
    if (o < gridMin) gridMin = o
    if (o + ext > gridMax) gridMax = o + ext
  })

  // Guard the degenerate case (every lap's extent non-finite/zero, so span ≤ 0):
  // force a minimal positive span so the grid is always STRICTLY increasing.
  // uPlot needs an ascending x array — feeding it all-equal values blanks the
  // whole chart, so never let that happen regardless of the input data.
  const span = gridMax - gridMin
  const safeSpan = span > 0 ? span : 1
  const grid = new Float64Array(gridPoints)
  const step = gridPoints > 1 ? safeSpan / (gridPoints - 1) : 0
  for (let g = 0; g < gridPoints; g++) grid[g] = gridMin + g * step

  const series: LapOverlaySeries[] = []
  // Lap-outer / channel-inner so a lap's traces stay grouped (matching the
  // colour-by-lap, style-by-channel encoding the legend reads top-down).
  laps.forEach((lap, lapOrder) => {
    channels.forEach((ch, channelIndex) => {
      series.push({
        channelIndex,
        lapOrder,
        lap,
        y: resampleLap(grid, xValues, ch.data, lap, offsetAt(lapOrder)),
      })
    })
  })

  return { x: grid, series }
}
