/**
 * Pure conversion from the analyzer's shared X-axis zoom range (value units —
 * seconds/metres, see {@link useAnalyzerStore.xRange}) to a session SAMPLE
 * INDEX range, for driving the track map's chart-zoom-follow focus (#7).
 *
 * `analyzerStore.xRange` is written ONLY by TIMELINE-mode charts (overlay
 * charts live in a lap-relative grid space and structurally never call
 * `setXRange` — see `TimeSeriesChart.vue`'s `onXZoom`, which is a no-op unless
 * `mode === 'timeline'`), so no separate "is this a timeline range" flag is
 * needed here; `xRange` in the store is always either `null` or a
 * timeline/session-value range already. Callers that might one day feed this
 * helper a non-timeline range should still gate on their own chart mode
 * before calling it — see the mode check in AnalyzerView.
 */

export interface IndexRange {
  startIdx: number
  endIdx: number
}

export interface ValueRange {
  min: number
  max: number
}

/** Below this fraction of the full session span, a range is NOT treated as
 * "covering the whole session" — i.e. above `1 - WHOLE_SESSION_SLACK` of the
 * full extent counts as "no focus" (auto/full view), per the task's "when the
 * range covers (nearly) the whole session, treat as no focus" rule. */
const WHOLE_SESSION_SLACK = 0.02

/**
 * Convert `xRange` (value-space min/max) to a session index range using
 * `xValues` (the same monotonically-increasing array the charts plot
 * against, in time or distance units — whichever axis is active). Returns
 * `null` when there's nothing to focus:
 *  - `xRange` itself is null (no zoom active),
 *  - `xValues` is unavailable,
 *  - the resolved index span is degenerate (< 2 samples), or
 *  - the range covers (nearly) the whole session — see `WHOLE_SESSION_SLACK`.
 */
export function xRangeToFocusIndices(
  xRange: ValueRange | null,
  xValues: Float64Array | null,
): IndexRange | null {
  if (!xRange || !xValues || xValues.length < 2) return null

  const n = xValues.length
  const first = xValues[0]
  const last = xValues[n - 1]
  const fullSpan = last - first
  if (!(fullSpan > 0)) return null

  // xValues is monotonically increasing (time/distance axis), so a binary
  // search finds the bounding indices; a plain scan is also fine at typical
  // session sizes but binary search keeps this cheap for long sessions.
  const startIdx = clampIdx(lowerBound(xValues, xRange.min), n)
  const endIdx = clampIdx(upperBound(xValues, xRange.max), n)
  if (endIdx - startIdx < 1) return null

  // "Covers (nearly) the whole session" ⇒ no focus (don't emphasize
  // everything). Compare the RESOLVED value span (not the raw xRange, which
  // may slightly overshoot the data) against the full session span.
  const resolvedSpan = xValues[endIdx] - xValues[startIdx]
  if (resolvedSpan >= fullSpan * (1 - WHOLE_SESSION_SLACK)) return null

  return { startIdx, endIdx }
}

/** First index i such that xValues[i] >= v (like std::lower_bound). */
function lowerBound(xValues: Float64Array, v: number): number {
  let lo = 0
  let hi = xValues.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (xValues[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Last index i such that xValues[i] <= v (like std::upper_bound - 1). */
function upperBound(xValues: Float64Array, v: number): number {
  let lo = 0
  let hi = xValues.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (xValues[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

function clampIdx(i: number, n: number): number {
  return Math.max(0, Math.min(n - 1, i))
}
