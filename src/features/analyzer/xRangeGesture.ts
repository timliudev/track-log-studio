/**
 * Pure X-range math for touch pan/pinch gestures on the uPlot time-series
 * charts (#8). uPlot's built-in drag-box zoom is mouse-only, so touch input
 * (Pointer Events) is translated into `[min, max]` data-space ranges here —
 * kept side-effect-free so the pan/pinch/clamp arithmetic can be unit-tested
 * without a canvas or uPlot instance. The caller (UPlotChart.vue) owns the
 * pointer bookkeeping and applies the result via `u.setScale('x', ...)` /
 * the shared `xRange` owner (analyzerStore), same as the existing mouse path.
 */

export interface XRange {
  min: number
  max: number
}

/** Smallest allowed span, as a fraction of the full data extent — prevents a
 * pinch from collapsing the range to (near-)zero, which would make uPlot's
 * scale degenerate (and make it impossible to zoom back out by pinching). */
const MIN_SPAN_FRACTION = 0.001

/** Clamp `range` into `bounds`, preserving span where possible; if the range
 * is wider than the bounds it's clamped to exactly `bounds`. */
export function clampRange(range: XRange, bounds: XRange): XRange {
  const boundsSpan = bounds.max - bounds.min
  if (!(boundsSpan > 0)) return { ...bounds }
  let { min, max } = range
  let span = max - min
  if (!(span > 0)) span = boundsSpan // degenerate input → fall back to full extent
  if (span >= boundsSpan) return { ...bounds }
  if (min < bounds.min) {
    min = bounds.min
    max = min + span
  }
  if (max > bounds.max) {
    max = bounds.max
    min = max - span
  }
  return { min, max }
}

/** Pan `range` by `deltaX` data units (positive = content moves right, i.e. the
 * visible window moves left/back), then clamp to `bounds`. */
export function panRange(range: XRange, deltaX: number, bounds: XRange): XRange {
  return clampRange({ min: range.min - deltaX, max: range.max - deltaX }, bounds)
}

/**
 * Zoom `range` by `factor` (>1 = zoom in / narrower span, <1 = zoom out) about
 * the data-space point `about`, which stays fixed on screen. Clamps the result
 * span to at least `MIN_SPAN_FRACTION` of the bounds' extent, and the result
 * range to `bounds`.
 */
export function zoomRange(range: XRange, factor: number, about: number, bounds: XRange): XRange {
  if (!(factor > 0) || !Number.isFinite(factor)) return { ...range }
  const span = range.max - range.min
  const boundsSpan = bounds.max - bounds.min
  const minSpan = boundsSpan > 0 ? boundsSpan * MIN_SPAN_FRACTION : 0
  let newSpan = span / factor
  if (boundsSpan > 0) newSpan = Math.min(boundsSpan, Math.max(minSpan, newSpan))
  // Keep `about` at the same relative position within the range.
  const t = span > 0 ? (about - range.min) / span : 0.5
  const min = about - t * newSpan
  const max = min + newSpan
  return clampRange({ min, max }, bounds)
}

/**
 * Combined pinch step: zoom about the pinch midpoint by `factor`, then pan by
 * `deltaX` (midpoint translation between the previous and current pinch
 * frame), matching TrackMap's "pinch also pans" behaviour. `about` and
 * `deltaX` are both in data-space X units.
 */
export function pinchRange(range: XRange, factor: number, about: number, deltaX: number, bounds: XRange): XRange {
  const zoomed = zoomRange(range, factor, about, bounds)
  return panRange(zoomed, deltaX, bounds)
}
