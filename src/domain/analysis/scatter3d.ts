/** A point cloud that has already been filtered and sampled for XY scatter. */
export interface Scatter3dSeriesInput {
  points: readonly [number, number][]
  zValues?: readonly number[]
}

/** Combine aligned XY points and a selected third channel into finite XYZ tuples. */
export function xyzPoints(series: Scatter3dSeriesInput): [number, number, number][] {
  if (!series.zValues) return []
  return series.points.flatMap((point, index) => {
    const z = series.zValues![index]
    return Number.isFinite(z) ? [[point[0], point[1], z]] : []
  })
}

/** One axis's numeric range: `[min, max]`. */
export interface AxisRange {
  min: number
  max: number
}

/** Every finite XYZ tuple's values, split per axis (B51). Only points that
 *  carry a finite value on ALL THREE axes are counted — same "a point needs
 *  a genuine X, Y, AND Z to exist" rule `xyzPoints` already applies, kept
 *  consistent here so the axis ranges below are computed from exactly the
 *  points that actually get rendered. */
export function axisValues(series: readonly Scatter3dSeriesInput[]): {
  x: number[]
  y: number[]
  z: number[]
} {
  const x: number[] = []
  const y: number[] = []
  const z: number[] = []
  for (const s of series) {
    if (!s.zValues) continue
    for (let i = 0; i < s.points.length; i++) {
      const [px, py] = s.points[i]
      const pz = s.zValues[i]
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue
      x.push(px)
      y.push(py)
      z.push(pz)
    }
  }
  return { x, y, z }
}

/** The p-th percentile (0..100) of an ALREADY-SORTED ascending array of
 *  finite values, via linear interpolation between the two nearest ranks
 *  (same convention as Excel's PERCENTILE.INC / numpy's default 'linear'
 *  method) — deterministic and doesn't require the requested percentile to
 *  land exactly on a sample index. Callers are responsible for filtering out
 *  non-finite values and sorting first (see `robustAxisRange`, which sorts
 *  each channel's values once and reuses it for both the low and high cut). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const clamped = Math.min(100, Math.max(0, p))
  const idx = (clamped / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const frac = idx - lo
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac
}

/** Pad a raw `[min, max]` extent by a fraction of its span (or, for a
 *  degenerate constant extent, a fraction of its magnitude) so plotted
 *  points don't sit flush against the grid3D box edge — same spirit as
 *  GgChart.vue's `paddedAxisRange`, kept as a tiny local copy rather than an
 *  import so this domain module doesn't reach into a feature/component file. */
function padRange(min: number, max: number, padFrac = 0.05): AxisRange {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (min === max) {
    const pad = Math.abs(min) * padFrac || 1
    return { min: min - pad, max: max + pad }
  }
  const span = max - min
  const pad = span * padFrac
  return { min: min - pad, max: max + pad }
}

/**
 * B51 — outlier-robust axis range for one channel's raw sample values:
 * clamps to the `[lowerPct, upperPct]` percentile band (default 0.5–99.5)
 * instead of the full min/max extent, so a handful of extreme outlier/noise
 * samples (a GPS glitch, a sensor spike) don't squash the rest of the point
 * cloud into a sliver of the 3D box — the reported "3D 軸自動縮放到極端值,
 * 整團點被壓扁" bug. Falls back to the exact (unpadded) single value when
 * there are fewer than 2 finite samples — too few points for percentiles to
 * mean anything — and to a fixed 0..1 range when there are none at all
 * (nothing plotted yet).
 */
export function robustAxisRange(
  values: readonly number[],
  lowerPct = 0.5,
  upperPct = 99.5,
): AxisRange {
  const finite = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (finite.length === 0) return { min: 0, max: 1 }
  if (finite.length < 2) return padRange(finite[0], finite[0])
  const min = percentile(finite, lowerPct)
  const max = percentile(finite, upperPct)
  return padRange(min, max)
}

/** Full (non-robust) axis range: the raw min/max of every finite value —
 *  this is what the 3D chart used unconditionally before B51, and remains
 *  the behaviour once the user opts back in via the "include outliers"
 *  escape hatch. Mirrors `robustAxisRange`'s degenerate-input fallbacks. */
export function fullAxisRange(values: readonly number[]): AxisRange {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  return padRange(min, max)
}

/** One channel's axis range, chosen per the "include outliers" escape hatch
 *  (B51): robust (percentile-clamped) by default, full extent when the user
 *  opts in. Kept as a one-line switch so callers don't have to branch. */
export function axisRange(values: readonly number[], includeOutliers: boolean): AxisRange {
  return includeOutliers ? fullAxisRange(values) : robustAxisRange(values)
}

/** The X/Y/Z axis ranges the 3D scatter should actually render, per B51. */
export interface Scatter3dAxisRanges {
  x: AxisRange
  y: AxisRange
  z: AxisRange
}

/** Computes all three axes' ranges from every series' points at once — the
 *  single entry point `Scatter3dChart.vue` calls per render (see
 *  `axisValues` for how points are gathered/filtered). */
export function computeAxisRanges(
  series: readonly Scatter3dSeriesInput[],
  includeOutliers: boolean,
): Scatter3dAxisRanges {
  const { x, y, z } = axisValues(series)
  return {
    x: axisRange(x, includeOutliers),
    y: axisRange(y, includeOutliers),
    z: axisRange(z, includeOutliers),
  }
}

/**
 * B50 — echarts-gl `grid3D` box dimensions (`boxWidth`/`boxHeight`/
 * `boxDepth` — mapped to the X/Z/Y axes respectively, see grid3DCreator.js:
 * `getAxis('x')` uses `boxWidth`, `getAxis('z')` uses `boxHeight`,
 * `getAxis('y')` uses `boxDepth`) that make "1:1" mean the same thing in 3D
 * as GgChart.vue's 2D equal-aspect mode: equal DATA units map to equal
 * VISUAL length on every axis, so a roughly spherical point cloud plots as a
 * sphere instead of an ellipsoid. Unlike the 2D case (a single square pixel
 * box via `squareGridBox`), grid3D's box has three independently-settable
 * side lengths — so achieving "equal scale" here is simpler: just size each
 * dimension proportional to its axis's numeric SPAN (from the SAME ranges
 * passed to `xAxis3D`/`yAxis3D`/`zAxis3D`, so this stays consistent with
 * whichever B51 outlier mode is active), scaled so the LARGEST span maps to
 * `maxSize` (matching the box's own default visual scale of ~100..120 units
 * used by the pre-existing fixed "auto" box). A zero/degenerate span
 * (constant channel, or no data yet) floors at 5% of `maxSize` so that axis
 * doesn't collapse to an invisible sliver.
 */
export function equalAspectBoxSize(
  ranges: Scatter3dAxisRanges,
  maxSize = 100,
): { boxWidth: number; boxHeight: number; boxDepth: number } {
  const xSpan = Math.max(ranges.x.max - ranges.x.min, 0)
  const ySpan = Math.max(ranges.y.max - ranges.y.min, 0)
  const zSpan = Math.max(ranges.z.max - ranges.z.min, 0)
  const largest = Math.max(xSpan, ySpan, zSpan, 1e-9)
  const floor = maxSize * 0.05
  return {
    boxWidth: Math.max((xSpan / largest) * maxSize, floor),
    boxHeight: Math.max((zSpan / largest) * maxSize, floor),
    boxDepth: Math.max((ySpan / largest) * maxSize, floor),
  }
}
