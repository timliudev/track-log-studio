import type { GpsTrack } from './gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'
import { cumulativeDistanceM } from './distance'
import { computeSmoothedCourses } from '@/domain/export/rc3Nmea/heading'
import { findPeaks } from './signalPeaks'

/** A detected corner: one apex found on a reference lap's track. */
export interface Corner {
  /** Sample index (into the session/track's full row range) at the apex. */
  index: number
  /** Cumulative distance (m) at the apex, within the reference range. */
  distanceM: number
  lat: number
  lon: number
  /** Signal value at the apex (deg/m for curvature, deg for lean angle). */
  value: number
  /** Topographic prominence that qualified this peak (see {@link findPeaks}). */
  prominence: number
}

export interface DetectCornersOptions {
  /** Minimum prominence (same unit as the signal) for a peak to count. Default 3. */
  minProminence?: number
  /** Absolute floor a peak must clear regardless of prominence. Default 5. */
  minValue?: number
  /** Box-smoothing half-width in samples applied to the raw signal. Default 2. */
  smoothHalfWidth?: number
  /**
   * Minimum real-world distance (m) between two accepted corners. Real GPS
   * noise routinely fragments one physical corner into 2-3 adjacent peaks a
   * few metres apart (each individually clearing the prominence bar) —
   * spacing is what merges those back into one. Default 15.
   */
  minSpacingM?: number
}

// NOTE: these are first-pass guesses for the curvature (deg/m) signal, not yet
// calibrated against real track data — see docs/DESIGN.md corner-detection
// spike notes. TC_Lean_Angle-based detection (deg, not deg/m) needs its own
// tuned defaults; pass opts explicitly for that path for now.
const DEFAULTS: Required<DetectCornersOptions> = {
  minProminence: 0.15,
  minValue: 0.25,
  smoothHalfWidth: 2,
  minSpacingM: 15,
}

/** Simple centred box-smooth (index-domain, not distance-domain — good enough
 *  for a roughly-constant-rate GPS fix stream; a variable-rate stream would
 *  want a distance-window version instead). */
function boxSmooth(signal: Float64Array, halfWidth: number): Float64Array {
  if (halfWidth <= 0) return signal
  const n = signal.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - halfWidth); j <= Math.min(n - 1, i + halfWidth); j++) {
      sum += signal[j]
      count++
    }
    out[i] = sum / count
  }
  return out
}

/** Smallest signed angular difference b - a, wrapped to (-180, 180]. */
function angleDiffDeg(a: number, b: number): number {
  let d = (b - a) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

/** Indices of valid fixes within [startIdx, endIdx), in order. */
function validIndicesInRange(track: GpsTrack, startIdx: number, endIdx: number): number[] {
  const idxs: number[] = []
  for (let i = startIdx; i < endIdx; i++) if (track.valid[i]) idxs.push(i)
  return idxs
}

export interface ReferenceSignal {
  /** Sample indices (into the full track), aligned to `value`. */
  index: number[]
  distanceM: Float64Array
  value: Float64Array
}

/**
 * Curvature signal over a reference range: smoothed-heading turn-rate
 * (deg per metre) at each valid fix, magnitude only (direction discarded —
 * a corner is a corner whichever way it turns). Uses distance (not sample
 * index) as the arc-length base so it isn't skewed by fix-rate hiccups
 * between consecutive samples, only between the fixed window itself.
 */
export function curvatureSignal(
  track: GpsTrack,
  startIdx = 0,
  endIdx: number = track.valid.length,
): ReferenceSignal {
  const idxs = validIndicesInRange(track, startIdx, endIdx)
  if (idxs.length < 3) {
    return { index: [], distanceM: new Float64Array(0), value: new Float64Array(0) }
  }

  const latList = idxs.map((i) => track.lat[i])
  const lonList = idxs.map((i) => track.lon[i])
  const headings = computeSmoothedCourses(latList, lonList)

  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const dist = idxs.map((i) => fullDist[i])

  // Turn-rate between consecutive fixes, assigned to the earlier of the pair.
  const n = idxs.length - 1
  const rate = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const dd = dist[k + 1] - dist[k]
    if (dd < 1e-3) {
      rate[k] = k > 0 ? rate[k - 1] : 0
      continue
    }
    rate[k] = Math.abs(angleDiffDeg(headings[k], headings[k + 1])) / dd
  }

  const smoothed = boxSmooth(rate, DEFAULTS.smoothHalfWidth)
  return {
    index: idxs.slice(0, n),
    distanceM: Float64Array.from(dist.slice(0, n)),
    value: smoothed,
  }
}

/**
 * Lean-angle signal over a reference range: |TC_Lean_Angle| at each valid
 * fix. Returns null when the session has no lean-angle channel — callers
 * should fall back to {@link curvatureSignal}.
 */
export function leanAngleSignal(
  session: LogSession,
  track: GpsTrack,
  startIdx = 0,
  endIdx: number = track.valid.length,
): ReferenceSignal | null {
  const ch = session.get('TC_Lean_Angle')
  if (!ch) return null
  const idxs = validIndicesInRange(track, startIdx, endIdx)
  if (idxs.length === 0) return null

  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const value = new Float64Array(idxs.length)
  const distanceM = new Float64Array(idxs.length)
  for (let k = 0; k < idxs.length; k++) {
    const i = idxs[k]
    value[k] = Math.abs(ch.data[i])
    distanceM[k] = fullDist[i]
  }
  return { index: idxs, distanceM, value: boxSmooth(value, DEFAULTS.smoothHalfWidth) }
}

/**
 * Non-max suppression by real distance: visit candidates most-prominent
 * first, accept a candidate unless it falls within `minSpacingM` of an
 * already-accepted one. Merges GPS-noise-fragmented multi-peak corners back
 * into a single apex (the most prominent of the cluster) without needing the
 * signal to dip to any particular floor between them.
 */
function suppressNearby(corners: Corner[], minSpacingM: number): Corner[] {
  const bySpacing = [...corners].sort((a, b) => b.prominence - a.prominence)
  const accepted: Corner[] = []
  for (const c of bySpacing) {
    if (accepted.every((a) => Math.abs(a.distanceM - c.distanceM) >= minSpacingM)) {
      accepted.push(c)
    }
  }
  return accepted.sort((a, b) => a.distanceM - b.distanceM)
}

function toCorners(track: GpsTrack, sig: ReferenceSignal, opts: DetectCornersOptions): Corner[] {
  const { minProminence, minValue, minSpacingM } = { ...DEFAULTS, ...opts }
  const peaks = findPeaks(sig.value, { minProminence, minValue })
  const corners = peaks.map((p) => {
    const i = sig.index[p.index]
    return {
      index: i,
      distanceM: sig.distanceM[p.index],
      lat: track.lat[i],
      lon: track.lon[i],
      value: p.value,
      prominence: p.prominence,
    }
  })
  return suppressNearby(corners, minSpacingM)
}

/** Detect corners on a reference range using GPS-track curvature (always available). */
export function detectCornersByCurvature(
  track: GpsTrack,
  startIdx = 0,
  endIdx: number = track.valid.length,
  opts: DetectCornersOptions = {},
): Corner[] {
  return toCorners(track, curvatureSignal(track, startIdx, endIdx), opts)
}

/**
 * Detect corners using |TC_Lean_Angle| when the session has it, else fall
 * back to curvature. `opts` for the lean-angle path should typically use a
 * degrees-of-lean floor (e.g. minValue ~8) rather than the curvature
 * deg/metre defaults — pass explicitly when calling with lean angle.
 */
export function detectCorners(
  session: LogSession,
  track: GpsTrack,
  startIdx = 0,
  endIdx: number = track.valid.length,
  opts: DetectCornersOptions = {},
): { source: 'leanAngle' | 'curvature'; corners: Corner[] } {
  const lean = leanAngleSignal(session, track, startIdx, endIdx)
  if (lean) return { source: 'leanAngle', corners: toCorners(track, lean, opts) }
  return { source: 'curvature', corners: detectCornersByCurvature(track, startIdx, endIdx, opts) }
}
