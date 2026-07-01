import type { GpsTrack } from './gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'
import type { LapLine } from './laps'
import type { Lap } from '@/domain/model/Lap'
import { cumulativeDistanceM } from './distance'
import { computeSmoothedCourses } from '@/domain/export/rc3Nmea/heading'
import { toRadians, toDegrees } from '@/domain/export/rc3Nmea/geo'
import { findPeaks } from './signalPeaks'

const EARTH_R = 6371000

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

// Calibrated 2026-07-01, RE-VALIDATED 2026-07-02 against two independent real
// raceAmp .loga sessions on the same physical circuit (ARK, 23.10/120.22;
// b1(5).loga and b1(9).loga — see LogaExample/, gitignored). Track has a
// documented ~12 corners (DESIGN.md). A throwaway script (loga importer -> ECU
// lap-channel laps -> curvatureSignal/leanAngleSignal -> findPeaks + NMS,
// deleted after use) swept minSpacingM in {15,20,25,30,35} and
// minProminence/minValue around the existing values:
//  - minSpacingM=15: the tightest real consecutive-apex gap measured on a
//    reference lap was ~15.1m (b1(9) lap 5); raising spacing to 20+ started
//    silently merging that pair (and others in the 20-30m range) into one
//    apex, i.e. eating real distinct corners (the ARK combo case) rather than
//    only deduplicating GPS-noise fragments. 15 is the largest value that
//    doesn't do this on either session — keep as-is.
//  - curvature minProminence=0.9 / minValue=1.4: of the threshold combos
//    tried, this pair gave the per-lap count closest to the known ~12 (mean
//    ~12.1 across 13 real "full-ish" laps from both sessions, e.g. b1(5) lap3
//    (reference, 746.6m/50.6s) -> 11 corners, b1(9) lap5 (reference,
//    748.1m/50.3s) -> curvature-only 10 corners); raising minValue to 1.8
//    dropped the mean to ~9.1 by cutting real-but-shallow high-speed corners.
//  - Cross-session apex agreement (same lap-relative distance, independently
//    detected): 10/11 reference-lap apexes landed within 20m of a same-signal
//    apex in the other session (6/11 within 10m) — the residual offset looks
//    like a small systematic shift from the ECU lap-boundary crossing point
//    differing slightly session-to-session, not detector noise.
// NOT yet proven to generalise to a differently-scaled track (e.g. a big
// circuit with long, gentle corners) — treat as a reasonable starting point.
export const CURVATURE_DEFAULTS: Required<DetectCornersOptions> = {
  minProminence: 0.9,
  minValue: 1.4,
  smoothHalfWidth: 2,
  minSpacingM: 15,
}

// Lean angle is in degrees, not deg/m, hence its own scale of defaults.
// Re-validated 2026-07-02 (see CURVATURE_DEFAULTS comment for method): only
// b1(9).loga carries real |TC_Lean_Angle| values (b1(5).loga's channel is
// present but degenerate — see isDegenerateLeanSignal below — so it always
// falls back to curvature and couldn't be used for this signal's sweep).
// prom=10/val=16/spacing=15 (current values) gave a tight, stable count on
// b1(9)'s steady-state laps 4-6: [13, 12, 12] apexes — right at the track's
// known ~12. Pushing spacing to 25-30 does tighten the count further (down to
// ~11) but that's from merging real apexes, the same failure mode as
// curvature's spacing sweep, not from removing noise — not worth the
// trade-off given lean-angle is already the more stable of the two signals.
export const LEAN_ANGLE_DEFAULTS: Required<DetectCornersOptions> = {
  minProminence: 10,
  minValue: 16,
  smoothHalfWidth: 2,
  minSpacingM: 15,
}

// Below this, a lean-angle channel is treated as unpopulated (present in the
// format but never actually written by this ECU/session — observed for real
// on one sample) rather than usable signal; callers fall back to curvature.
const LEAN_ANGLE_DEGENERATE_MAX_DEG = 3

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

  const smoothed = boxSmooth(rate, CURVATURE_DEFAULTS.smoothHalfWidth)
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
  return { index: idxs, distanceM, value: boxSmooth(value, LEAN_ANGLE_DEFAULTS.smoothHalfWidth) }
}

/** True when a lean-angle signal never exceeds a trivial floor — i.e. the
 *  channel exists but this session never actually wrote real values to it. */
function isDegenerateLeanSignal(sig: ReferenceSignal): boolean {
  let max = 0
  for (let i = 0; i < sig.value.length; i++) if (sig.value[i] > max) max = sig.value[i]
  return max < LEAN_ANGLE_DEGENERATE_MAX_DEG
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

function toCorners(
  track: GpsTrack,
  sig: ReferenceSignal,
  defaults: Required<DetectCornersOptions>,
  opts: DetectCornersOptions,
): Corner[] {
  const { minProminence, minValue, minSpacingM } = { ...defaults, ...opts }
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
  return toCorners(track, curvatureSignal(track, startIdx, endIdx), CURVATURE_DEFAULTS, opts)
}

/**
 * Detect corners using |TC_Lean_Angle| when the session has it AND the
 * channel actually carries real values this session (see
 * {@link isDegenerateLeanSignal} — the format can list the channel while the
 * ECU never wrote to it), else fall back to curvature. Each path uses its own
 * calibrated defaults ({@link LEAN_ANGLE_DEFAULTS} / {@link CURVATURE_DEFAULTS});
 * `opts` overrides whichever path is actually used.
 */
export function detectCorners(
  session: LogSession,
  track: GpsTrack,
  startIdx = 0,
  endIdx: number = track.valid.length,
  opts: DetectCornersOptions = {},
): { source: 'leanAngle' | 'curvature'; corners: Corner[] } {
  const lean = leanAngleSignal(session, track, startIdx, endIdx)
  if (lean && !isDegenerateLeanSignal(lean)) {
    return { source: 'leanAngle', corners: toCorners(track, lean, LEAN_ANGLE_DEFAULTS, opts) }
  }
  return { source: 'curvature', corners: detectCornersByCurvature(track, startIdx, endIdx, opts) }
}

/**
 * Pick a lap to use as the corner-detection reference: the fastest lap among
 * those with a plausible total distance (within 20% of the median distance
 * across non-excluded laps). A raw "fastest by time" pick can be fooled by a
 * broken/partial lap — e.g. a pit-lane sliver that's numerically quick but
 * covers a fraction of the track (observed for real: a 21s "lap" covering
 * 0.14km amid a set of ~50s/~0.75km laps) — so corners would be detected off
 * a lap that never actually completed the track. Falls back to every
 * non-excluded lap if none look "plausible" (e.g. every lap looks short).
 * Returns undefined if there's nothing to pick from.
 *
 * Re-verified 2026-07-02 against real data: b1(5).loga's ECU lap channel
 * produces exactly this pattern (laps of ~746-799m/~51-97s, plus a trailing
 * lap 6 at 144.0m/21.41s) and the median±20% filter correctly excludes lap 6
 * from the candidate pool, landing on lap 3 (746.6m/50.59s, the fastest of
 * the plausible ones) rather than the short lap.
 */
export function pickReferenceLap(
  track: GpsTrack,
  laps: Lap[],
  excluded: readonly number[],
): Lap | undefined {
  const skip = new Set(excluded)
  const included = laps.filter((l) => !skip.has(l.index))
  if (included.length === 0) return undefined

  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const distanceOf = (l: Lap): number => {
    const n = fullDist.length
    if (n === 0) return 0
    const end = Math.min(l.endIdx, n - 1)
    const start = Math.min(l.startIdx, n - 1)
    return fullDist[end] - fullDist[start]
  }

  const distances = included.map(distanceOf)
  const sorted = [...distances].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const plausible =
    median > 0 ? included.filter((_, i) => Math.abs(distances[i] - median) <= median * 0.2) : included
  const pool = plausible.length > 0 ? plausible : included

  let best: Lap | undefined
  for (const l of pool) {
    if (!Number.isFinite(l.lapTimeMs) || l.lapTimeMs <= 0) continue
    if (!best || l.lapTimeMs < best.lapTimeMs) best = l
  }
  return best
}

/** Local heading (deg, compass bearing) at `index`, from a small window of
 *  neighbouring valid fixes on either side — same smoothing as the curvature
 *  signal, just windowed around one point instead of a whole lap. */
function headingAtIndex(track: GpsTrack, index: number, halfWindow = 6): number {
  const before: number[] = []
  for (let k = index; k >= 0 && before.length <= halfWindow; k--) if (track.valid[k]) before.unshift(k)
  const after: number[] = []
  for (let k = index + 1; k < track.valid.length && after.length < halfWindow; k++) {
    if (track.valid[k]) after.push(k)
  }
  const idxs = [...before, ...after]
  if (idxs.length < 2) return 0
  const lat = idxs.map((i) => track.lat[i])
  const lon = idxs.map((i) => track.lon[i])
  const headings = computeSmoothedCourses(lat, lon)
  return headings[Math.max(0, before.length - 1)]
}

/**
 * A {@link LapLine} gate perpendicular to the local track heading at a
 * corner's apex, `halfWidthM` metres to each side — the same shape as the
 * start/finish line, so it reuses all existing crossing-detection and (once
 * wired up) drag-handle UI unchanged.
 */
export function cornerGateLine(track: GpsTrack, corner: Corner, halfWidthM = 15): LapLine {
  const heading = headingAtIndex(track, corner.index)
  const rad = toRadians(heading)
  const cosLat = Math.cos(toRadians(corner.lat)) || 1
  // Perpendicular unit vector (east, north) — rotate the heading vector -90°.
  const east = Math.cos(rad)
  const north = -Math.sin(rad)
  const dLat = toDegrees((north * halfWidthM) / EARTH_R)
  const dLon = toDegrees((east * halfWidthM) / (EARTH_R * cosLat))
  return {
    a: { lat: corner.lat + dLat, lon: corner.lon + dLon },
    b: { lat: corner.lat - dLat, lon: corner.lon - dLon },
  }
}
