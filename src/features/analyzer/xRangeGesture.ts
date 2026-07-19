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

/**
 * B68 — Clamp a centre-needle range without stranding the first or last
 * sample at the edge of the plot. The virtual padding follows the CURRENT
 * visible span: each side may extend by at most half that span. Consequently
 * either data edge can sit under the fixed centre needle, but the user never
 * scrolls into an unbounded empty timeline.
 *
 * The normal range helpers deliberately keep their original strict data
 * bounds. Centre-needle mode opts into this separate helper so every other
 * chart gesture retains its existing behaviour.
 */
export function clampCentreNeedleRange(range: XRange, dataBounds: XRange): XRange {
  const dataSpan = dataBounds.max - dataBounds.min
  if (!(dataSpan > 0)) return { ...dataBounds }

  let span = range.max - range.min
  if (!(span > 0)) span = dataSpan
  // A zoomed-out chart must not gain extra data span merely because it has
  // virtual edge room. Its extra space is only for centring an endpoint.
  span = Math.min(span, dataSpan)

  const padding = span / 2
  const minStart = dataBounds.min - padding
  const maxStart = dataBounds.max + padding - span
  const start = Math.min(maxStart, Math.max(minStart, range.min))
  return { min: start, max: start + span }
}

/** Pan with B68's span-relative virtual edge padding. */
export function panCentreNeedleRange(range: XRange, deltaX: number, dataBounds: XRange): XRange {
  return clampCentreNeedleRange({ min: range.min - deltaX, max: range.max - deltaX }, dataBounds)
}

/** Zoom with B68's virtual edge padding while retaining the normal minimum
 * pinch span and maximum real-data span. */
export function zoomCentreNeedleRange(
  range: XRange,
  factor: number,
  about: number,
  dataBounds: XRange,
): XRange {
  if (!(factor > 0) || !Number.isFinite(factor)) return { ...range }
  const dataSpan = dataBounds.max - dataBounds.min
  if (!(dataSpan > 0)) return { ...dataBounds }
  const span = range.max - range.min
  const minSpan = dataSpan * MIN_SPAN_FRACTION
  const newSpan = Math.min(dataSpan, Math.max(minSpan, span / factor))
  const t = span > 0 ? (about - range.min) / span : 0.5
  const min = about - t * newSpan
  return clampCentreNeedleRange({ min, max: min + newSpan }, dataBounds)
}

/** Combined centre-needle pinch zoom and pan. */
export function pinchCentreNeedleRange(
  range: XRange,
  factor: number,
  about: number,
  deltaX: number,
  dataBounds: XRange,
): XRange {
  const zoomed = zoomCentreNeedleRange(range, factor, about, dataBounds)
  return panCentreNeedleRange(zoomed, deltaX, dataBounds)
}

/**
 * Keep uPlot's grid ticks but hide their labels in B68's virtual padding.
 * Matching `splits` and `labels` by index preserves uPlot's own formatter
 * (elapsed time, distance, and optional clock) for values inside the data.
 */
export function blankTickLabelsOutsideData(
  splits: readonly number[],
  labels: readonly (string | number | null)[],
  dataBounds: XRange,
): (string | number | null)[] {
  return labels.map((label, index) => {
    const value = splits[index]
    return value == null || value < dataBounds.min || value > dataBounds.max ? '' : label
  })
}
