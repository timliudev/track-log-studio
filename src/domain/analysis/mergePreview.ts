/**
 * Phase 5 — session merge, alignment PREVIEW: before committing a merge, show
 * the user both sessions' speed curves overlaid (base as-is, GPS-source
 * shifted by the current `offsetMs`) so a bad auto-alignment or a nudge that
 * overshoots is visually obvious, instead of only a numeric offset + a
 * correlation score (see docs/PHASE5-MERGE-STATUS.md's "not done" list).
 *
 * Kept separate from sessionAlign.ts/sessionMerge.ts: this never resamples
 * onto the base session's OWN time axis (like mergeSessions does) — it builds
 * its own coarse, decimated common grid purely for a cheap live chart, so
 * nudging the offset by ±100ms doesn't have to re-touch full-resolution data.
 */

/** Linear-interpolate `data` (indexed by parallel `timeMs`) at time `t`. NaN if `t` is outside range or the bracketing samples are NaN. */
function sampleAt(timeMs: ArrayLike<number>, data: ArrayLike<number>, t: number): number {
  const n = timeMs.length
  if (n === 0) return NaN
  if (t < timeMs[0] || t > timeMs[n - 1]) return NaN

  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (timeMs[mid] < t) lo = mid + 1
    else hi = mid
  }
  const i1 = lo
  if (timeMs[i1] === t) return data[i1]
  if (i1 === 0) return NaN
  const i0 = i1 - 1
  const t0 = timeMs[i0]
  const t1 = timeMs[i1]
  const span = t1 - t0
  if (!(span > 0)) return data[i0]
  const frac = (t - t0) / span
  const v0 = data[i0]
  const v1 = data[i1]
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return NaN
  return v0 + frac * (v1 - v0)
}

export interface BuildMergeOverlayOptions {
  /** Milliseconds added to the GPS session's time axis to match the base
   *  session's clock — same convention as {@link crossCorrelateOffset}'s and
   *  {@link mergeSessions}'s `offsetMs`. */
  offsetMs: number
  /** Decimate the shared grid to at most this many points. Default 400 — an
   *  alignment-preview chart doesn't need full sample-rate resolution, and a
   *  low point count keeps every ±100ms nudge feeling instant. */
  maxPoints?: number
}

/** Chart-ready result of {@link buildMergeOverlay}: a shared time grid (seconds,
 *  relative to the earliest sample across both series after the offset is
 *  applied) plus each session's speed resampled onto it. Gaps outside a
 *  series' covered range are `null` (uPlot treats `null` — not `NaN` — as "no
 *  data here", matching TimeSeriesChart's own overlay-gap convention). */
export interface MergeOverlayData {
  /** Shared X axis, in seconds from the grid's start. */
  timeS: number[]
  /** Base session's speed at each grid point (`null` where out of range). */
  base: (number | null)[]
  /** GPS session's speed (offset applied) at each grid point (`null` where out of range). */
  gps: (number | null)[]
}

/**
 * Build a decimated, shared-time-grid overlay of both sessions' speed curves
 * for a live alignment-preview chart: `gpsTimeMs` is shifted by `offsetMs`
 * before resampling, so at `offsetMs = 0` this literally overlays each
 * session's own raw clock, and as the user nudges the offset the GPS trace
 * visibly slides left/right relative to the (unmoving) base trace.
 *
 * Grid spans the union of both (offset-applied) time ranges, at a step large
 * enough to keep the point count at/under `maxPoints` (never finer than the
 * data's own smallest native step would warrant, but this function doesn't
 * know that — it only ever coarsens by request).
 *
 * Returns null if either input is empty/malformed (mismatched array lengths,
 * <2 samples, or a non-finite time range) — nothing usable to preview.
 */
export function buildMergeOverlay(
  baseSpeed: ArrayLike<number>,
  baseTimeMs: ArrayLike<number>,
  gpsSpeed: ArrayLike<number>,
  gpsTimeMs: ArrayLike<number>,
  opts: BuildMergeOverlayOptions,
): MergeOverlayData | null {
  const { offsetMs, maxPoints = 400 } = opts
  if (baseSpeed.length < 2 || baseTimeMs.length < 2 || gpsSpeed.length < 2 || gpsTimeMs.length < 2) return null
  if (baseSpeed.length !== baseTimeMs.length || gpsSpeed.length !== gpsTimeMs.length) return null
  if (!(maxPoints >= 2)) return null

  const baseStart = baseTimeMs[0]
  const baseEnd = baseTimeMs[baseTimeMs.length - 1]
  // Shifted GPS clock: adding offsetMs is exactly the convention used to line
  // GPS time up with base time (see mergeSessions).
  const gpsStart = gpsTimeMs[0] + offsetMs
  const gpsEnd = gpsTimeMs[gpsTimeMs.length - 1] + offsetMs
  if (![baseStart, baseEnd, gpsStart, gpsEnd].every(Number.isFinite)) return null

  const gridStart = Math.min(baseStart, gpsStart)
  const gridEnd = Math.max(baseEnd, gpsEnd)
  if (!(gridEnd > gridStart)) return null

  const count = Math.min(maxPoints, Math.max(2, Math.ceil(maxPoints)))
  const stepMs = (gridEnd - gridStart) / (count - 1)

  const timeS: number[] = new Array(count)
  const base: (number | null)[] = new Array(count)
  const gps: (number | null)[] = new Array(count)

  for (let i = 0; i < count; i++) {
    const t = gridStart + i * stepMs
    timeS[i] = (t - gridStart) / 1000
    const b = sampleAt(baseTimeMs, baseSpeed, t)
    base[i] = Number.isFinite(b) ? b : null
    // gps's own clock reads (t - offsetMs) at shifted-instant t.
    const g = sampleAt(gpsTimeMs, gpsSpeed, t - offsetMs)
    gps[i] = Number.isFinite(g) ? g : null
  }

  return { timeS, base, gps }
}
