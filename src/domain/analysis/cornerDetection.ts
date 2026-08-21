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
  /**
   * Ranking/selection strength for this candidate, same unit as {@link value}
   * (see {@link findPeaks}): topographic prominence of the apex within its
   * signal. For lean-angle corners this is the peak's prominence in the raw
   * (index-smoothed) |TC_Lean_Angle| signal. For curvature corners (B132,
   * 2026-08-21) it is the prominence of a sub-apex *within* an
   * already-validated turning segment (see {@link detectCornersByCurvature}) —
   * the segment itself is validated by accumulated turn angle |Δθ|, not by
   * this value, so this field's role is purely "which candidate wins
   * non-max-suppression / the persistence-gap cut", same as before.
   */
  prominence: number
}

export interface DetectCornersOptions {
  /** Minimum prominence (same unit as the signal) for a peak to count. Default 3.
   *  Lean-angle path only (B132 replaced the curvature path's peak-prominence
   *  screen with a turning-angle threshold — see {@link DetectCornersOptions.thetaMinDeg}). */
  minProminence?: number
  /** Absolute floor a peak must clear regardless of prominence. Default 5.
   *  Lean-angle path only (see {@link DetectCornersOptions.thetaMinDeg} for curvature). */
  minValue?: number
  /** Box-smoothing half-width in samples applied to the raw signal. Default 2.
   *  Lean-angle path only (curvature now smooths in the distance domain — see
   *  {@link DetectCornersOptions.sigmaFraction}). */
  smoothHalfWidth?: number
  /**
   * Minimum real-world distance (m) between two accepted corners. Real GPS
   * noise routinely fragments one physical corner into 2-3 adjacent peaks a
   * few metres apart (each individually clearing the prominence bar) —
   * spacing is what merges those back into one. Default 15 (lean-angle path,
   * fixed). The curvature path (B132) scales this with the reference lap's
   * length instead of using this default directly — pass this option to
   * override that scaling with a fixed value.
   */
  minSpacingM?: number
  /**
   * Curvature path only (B132). Minimum accumulated turn angle |Δθ|, in
   * degrees, over a turning segment (a maximal run of the smoothed turn-rate
   * signal staying the same sign) for that segment to count as a corner at
   * all. Unlike the old deg/m floor this is dimensionless w.r.t. track scale:
   * a 90° hairpin and a 90° highway-speed sweeper both clear the same bar,
   * whichever radius or GPS sample spacing produced them. Default 30.
   */
  thetaMinDeg?: number
  /**
   * Curvature path only (B132). Distance-domain smoothing window for the
   * turn-rate signal, as a fraction of the reference lap's length — e.g. 0.005
   * means the smoothing window is 0.5% of the lap. Scales the same physical
   * smoothing extent to any track size, unlike the old fixed-sample-count
   * `smoothHalfWidth`. Default 0.005.
   */
  sigmaFraction?: number
  /**
   * Curvature path only (B132). Hard ceiling on the number of gates this
   * function will ever return, regardless of how many candidates clear
   * `thetaMinDeg` — a safety fuse so a still-noisy or mistuned input can't
   * blow up the sector panel again. When more candidates qualify, the
   * `maxGates` with the largest turning-segment prominence win. Default 40.
   */
  maxGates?: number
}

// ---------------------------------------------------------------------------
// HISTORY (kept for context — the values below this comment are NO LONGER
// what's used; see the B132 section further down for what replaced them).
//
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
// This was explicitly flagged as "NOT yet proven to generalise to a
// differently-scaled track (e.g. a big circuit with long, gentle corners)" —
// and it didn't: real 大賽道 (~3.5km/lap) .rcz data produced ~142 gates
// (~1 every 25m). Root cause (B132, docs/ISSUES.md): κ=Δψ/Δs is deg/m, has
// units, and is inversely proportional to corner radius, so a fixed deg/m
// floor is really a fixed-radius floor (minValue=1.4 ⇒ "radius ≤ 41m") —
// it silently stops meaning "a corner" once the track's corners are a
// different size than ARK's.
//
// B132 (2026-08-21): the curvature path below was rewritten around a
// dimensionless, scale-invariant criterion — accumulated turning angle |Δθ|
// (degrees) over a turning-function segment — instead of a deg/m floor. The
// numbers above (minProminence/minValue/minSpacingM=15 fixed) are DEAD for
// the curvature path; `minSpacingM` here now only documents the lean-angle
// path's fixed default (LEAN_ANGLE_DEFAULTS still uses this exact contract).
// See the `thetaMinDeg` / `sigmaFraction` / `maxGates` calibration notes on
// `detectCornersByCurvature` for the new path's own validation.
// ---------------------------------------------------------------------------
export const CURVATURE_DEFAULTS = {
  /** B132: minimum accumulated |Δθ| (deg) for a turning segment to count as
   *  a corner — see {@link DetectCornersOptions.thetaMinDeg}. */
  thetaMinDeg: 30,
  /** B132: distance-domain smoothing window as a fraction of lap length —
   *  see {@link DetectCornersOptions.sigmaFraction}. The B132 write-up's own
   *  suggested starting point was 0.5%; empirically sweeping against the
   *  real ARK-scale files (see the class doc on `detectCornersByCurvature`)
   *  found 1% gave a visibly more stable per-lap count (e.g. 極限.rcz's
   *  laps landed at [12,11,11,11,11] instead of a noisier spread at 0.5%),
   *  so this default deviates from the suggestion on that evidence. */
  sigmaFraction: 0.01,
  /** B132: floor for the lap-length-scaled minSpacingM (`max(this, lapLenM/100)`),
   *  carried over from the pre-B132 fixed default. */
  minSpacingFloorM: 15,
  /** B132: hard ceiling on returned gates regardless of how many candidates
   *  qualify — see {@link DetectCornersOptions.maxGates}. */
  maxGates: 40,
  /** Pre-B132 index-domain smoothing half-width, kept only so the legacy
   *  {@link curvatureSignal} utility (still exported/tested as a standalone
   *  "raw |dψ/ds| signal" helper, no longer used by
   *  {@link detectCornersByCurvature} itself) keeps its previous output. */
  smoothHalfWidth: 2,
}

/** Shape `toCorners` needs from a defaults object — the lean-angle path's
 *  peak+prominence contract (see {@link LEAN_ANGLE_DEFAULTS}). The curvature
 *  path (B132) no longer goes through `toCorners` at all. */
type PeakDetectionDefaults = Required<
  Pick<DetectCornersOptions, 'minProminence' | 'minValue' | 'smoothHalfWidth' | 'minSpacingM'>
>

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
export const LEAN_ANGLE_DEFAULTS: PeakDetectionDefaults = {
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
  defaults: PeakDetectionDefaults,
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

// ---------------------------------------------------------------------------
// B132 — turning-function corner detection (curvature path).
//
// A moving average of a signal by real distance rather than sample count:
// out[i] is the mean of every value whose x-coordinate falls within
// `windowM/2` of x[i]. x must be sorted ascending (true of any cumulative
// distance array). Two pointers each advance monotonically as i increases,
// so the whole pass is O(n) despite the window "resizing" as fix spacing
// varies — this is what makes the smoothing extent a real distance
// (`sigmaFraction * lapLenM`) instead of a sample count, so it automatically
// covers the same physical extent on a 750m ARK lap and a 3.5km circuit.
// ---------------------------------------------------------------------------
function distanceSmooth(
  distanceM: ArrayLike<number>,
  values: Float64Array,
  windowM: number,
): Float64Array {
  const n = values.length
  const out = new Float64Array(n)
  if (n === 0) return out
  if (windowM <= 0) {
    out.set(values)
    return out
  }
  const halfW = windowM / 2
  let lo = 0
  let hi = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    while (hi < n && distanceM[hi] <= distanceM[i] + halfW) {
      sum += values[hi]
      hi++
    }
    while (lo < hi - 1 && distanceM[lo] < distanceM[i] - halfW) {
      sum -= values[lo]
      lo++
    }
    out[i] = sum / (hi - lo)
  }
  return out
}

// A turn-rate reading this small (deg/m) is treated as "not turning" for the
// purpose of deciding whether a turning segment continues or reverses — i.e.
// a dead-band around zero, not a corner-qualification floor (that's
// `thetaMinDeg`, applied to the segment's *accumulated* angle). Absolute
// rather than scaled: it exists only to stop a near-zero straight-line
// wobble from flip-flopping the sign, and residual per-sample heading noise
// after `computeSmoothedCourses` + distance-domain smoothing is roughly the
// same order of magnitude regardless of track size.
const RATE_DEADBAND_DEG_PER_M = 0.05

/** A maximal run of point indices [start, end] over which the smoothed
 *  turn-rate stayed the same sign (small dead-band wobble doesn't break a
 *  run — see {@link RATE_DEADBAND_DEG_PER_M}). `start`/`end` are point
 *  indices (into the same arrays as `theta`/`dist`), not interval indices. */
interface TurningSegment {
  start: number
  end: number
}

/**
 * Split a signed turn-rate signal into maximal same-sign runs. `rate[k]`
 * covers the interval between point k and point k+1, so a run spanning
 * intervals [a, b) is the point range [a, b].
 */
function findTurningSegments(rate: Float64Array, deadbandDegPerM: number): TurningSegment[] {
  const segments: TurningSegment[] = []
  let sign = 0
  let segStart = -1
  for (let k = 0; k < rate.length; k++) {
    const s = rate[k] > deadbandDegPerM ? 1 : rate[k] < -deadbandDegPerM ? -1 : 0
    if (s === 0) continue
    if (sign === 0) {
      sign = s
      segStart = k
      continue
    }
    if (s === sign) continue
    segments.push({ start: segStart, end: k })
    sign = s
    segStart = k
  }
  if (sign !== 0) segments.push({ start: segStart, end: rate.length })
  return segments
}

// A sub-apex within a turning segment must clear this fraction of the
// segment's OWN peak |rate| to count as a separate corner (rather than
// noise riding on the segment's main apex). Relative to the segment's own
// dynamics, not an absolute deg/m value, so it stays meaningful whatever the
// segment's absolute curvature happens to be. This is what still lets a
// same-direction multi-apex combo (e.g. ARK's 8-9-10, which never reverses
// sign) come out as separate corners — findPeaks does the actual splitting,
// scoped to just this segment instead of the whole lap.
// Calibrated 2026-08-21 against the same real ARK-circuit data as
// CURVATURE_DEFAULTS (b1(5).loga, b1(9).loga's .rcz re-encoding, and the
// standalone 極限.rcz): 0.2 (an initial guess) let real-but-minor internal
// wobble split single physical corners into 2+ candidates, overshooting the
// known ~12 (reference-lap counts of 16-19 across the three curvature-path
// files); sweeping upward, 0.45 was the point where all three settled to a
// stable 11-14 without needing the (unreliable — see GAP_RATIO_THRESHOLD)
// persistence-gap cut to do the work.
const SUBPEAK_PROMINENCE_FRACTION = 0.45

/** Collapse runs of peaks at consecutive (or near-consecutive) indices —
 *  the exact-plateau artifact {@link findPeaks} produces (see its call site
 *  in {@link detectCornersByCurvature}) — into a single peak, keeping the
 *  strongest of the run. `findPeaks` always returns peaks in ascending
 *  index order, so this is a single linear pass. */
function mergeAdjacentPeaks<T extends { index: number; prominence: number }>(peaks: T[]): T[] {
  const merged: T[] = []
  for (const p of peaks) {
    const last = merged[merged.length - 1]
    if (last && p.index - last.index <= 1) {
      if (p.prominence > last.prominence) merged[merged.length - 1] = p
      continue
    }
    merged.push(p)
  }
  return merged
}

/** Auto-select how many candidates are "real" corners vs. residual noise
 *  that still cleared `thetaMinDeg`: sort by prominence descending, cut at
 *  the single largest relative drop (persistence-gap), but only if that drop
 *  is itself large enough to look like a genuine break rather than a smooth
 *  taper — otherwise keep every candidate that cleared thetaMinDeg.
 *
 *  Calibrated 2026-08-21 against the same real data as SUBPEAK_PROMINENCE_FRACTION:
 *  a "reasonable-sounding" 1.6 (any >60% relative drop counts as a gap) turned
 *  out to fire on ordinary, continuously-varying real corner-prominence
 *  distributions — not just genuine noise-vs-signal splits — and collapsed
 *  a 16-candidate reference lap to 5 (once even to 1, on an off lap). Real
 *  prominence rankings rarely have a clean bimodal gap; they taper. 4.0 is
 *  high enough that it never fired on any of the ARK-scale real files tested
 *  (thetaMinDeg + the lap-scaled minSpacingM + SUBPEAK_PROMINENCE_FRACTION do
 *  the actual count control there) while still catching a truly dramatic
 *  split should one occur on a track this hasn't been validated against —
 *  kept as a conservative safety net rather than deleted outright. */
const GAP_RATIO_THRESHOLD = 4.0

function persistenceGapSelect(sortedByProminenceDesc: Corner[]): Corner[] {
  if (sortedByProminenceDesc.length <= 2) return sortedByProminenceDesc
  let bestRatio = 1
  let bestCut = sortedByProminenceDesc.length
  for (let i = 0; i < sortedByProminenceDesc.length - 1; i++) {
    const a = sortedByProminenceDesc[i].prominence
    const b = sortedByProminenceDesc[i + 1].prominence
    if (b <= 1e-9) continue
    const ratio = a / b
    if (ratio > bestRatio) {
      bestRatio = ratio
      bestCut = i + 1
    }
  }
  return bestRatio >= GAP_RATIO_THRESHOLD
    ? sortedByProminenceDesc.slice(0, bestCut)
    : sortedByProminenceDesc
}

/**
 * Detect corners on a reference range using GPS-track curvature (always
 * available). B132 (2026-08-21): rewritten around a turning function —
 * unwrapped cumulative heading θ(s) — instead of the old deg/m peak floor,
 * which was inversely proportional to corner radius and so silently stopped
 * meaning "a corner" once track scale departed from the ARK data it was
 * calibrated on (see the CURVATURE_DEFAULTS comment above for the full
 * history/root-cause).
 *
 * Pipeline: (1) signed per-interval turn dPsi/ds, distance-domain smoothed
 * over a window that scales with the reference lap's length; (2) split into
 * maximal same-sign runs ("turning segments" — see {@link findTurningSegments});
 * (3) a segment counts as a corner candidate only if its accumulated |Δθ|
 * clears `thetaMinDeg` — dimensionless, so a hairpin and a highway sweeper
 * both clear the same bar regardless of radius or track size, and zero-mean
 * GPS noise integrates toward zero over a run instead of being amplified by
 * dividing by a small Δs; (4) within a qualifying segment, `findPeaks` splits
 * same-direction multi-apex combos (e.g. ARK 8-9-10) that never reverse sign;
 * (5) non-max suppression by real distance, with `minSpacingM` scaled to the
 * lap length (`max(minSpacingFloorM, lapLenM/100)`) unless overridden;
 * (6) a persistence-gap cut auto-selects how many surviving candidates are
 * "real" vs. residual noise; (7) a hard `maxGates` ceiling as a safety fuse.
 *
 * Calibration (2026-08-21, see docs/ISSUES.md B132 for the full before/after
 * table): thetaMinDeg=30 / sigmaFraction=0.01 / maxGates=40 (plus
 * SUBPEAK_PROMINENCE_FRACTION=0.45 and GAP_RATIO_THRESHOLD=4.0, see their own
 * calibration notes above) keep the known ~12-corner ARK circuit at 10-11
 * reference-lap corners across three independently-encoded real recordings
 * of it (.loga and two .rcz exports) — down from 11-21 (and per-lap swings
 * as wide as 5-21) on the same three files before this rewrite — while a
 * synthetic same-shape track scaled 5x produces the same corner count (the
 * direct scale-invariance check — see test/analysis/cornerDetection.test.ts).
 */
export function detectCornersByCurvature(
  track: GpsTrack,
  startIdx = 0,
  endIdx: number = track.valid.length,
  opts: DetectCornersOptions = {},
): Corner[] {
  const idxs = validIndicesInRange(track, startIdx, endIdx)
  const m = idxs.length
  if (m < 3) return []

  const latList = idxs.map((i) => track.lat[i])
  const lonList = idxs.map((i) => track.lon[i])
  const headings = computeSmoothedCourses(latList, lonList)

  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const dist = Float64Array.from(idxs.map((i) => fullDist[i]))
  const lapLenM = dist[m - 1] - dist[0]
  if (!(lapLenM > 0)) return []

  // Signed per-interval turn (deg) and its raw (unsmoothed) rate (deg/m),
  // point k paired with the interval [k, k+1) — same convention as the old
  // curvatureSignal. A near-zero interval distance (duplicate/near-duplicate
  // GPS fix) would blow rate up to a spurious spike; carry the previous rate
  // forward instead, same guard as the old code.
  const n = m - 1
  const theta = new Float64Array(m)
  const rawRate = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const dPsi = angleDiffDeg(headings[k], headings[k + 1])
    theta[k + 1] = theta[k] + dPsi
    const ds = dist[k + 1] - dist[k]
    rawRate[k] = ds < 1e-3 ? (k > 0 ? rawRate[k - 1] : 0) : dPsi / ds
  }

  const {
    thetaMinDeg = CURVATURE_DEFAULTS.thetaMinDeg,
    sigmaFraction = CURVATURE_DEFAULTS.sigmaFraction,
    maxGates = CURVATURE_DEFAULTS.maxGates,
  } = opts
  const minSpacingM = opts.minSpacingM ?? Math.max(CURVATURE_DEFAULTS.minSpacingFloorM, lapLenM / 100)
  const sigmaM = sigmaFraction * lapLenM

  const smoothedRate = distanceSmooth(dist.subarray(0, n), rawRate, sigmaM)
  const segments = findTurningSegments(smoothedRate, RATE_DEADBAND_DEG_PER_M)

  const candidates: Corner[] = []
  for (const seg of segments) {
    const magnitude = Math.abs(theta[seg.end] - theta[seg.start])
    if (magnitude < thetaMinDeg) continue

    let peakVal = 0
    let peakLocalIdx = 0
    for (let k = seg.start; k < seg.end; k++) {
      const v = Math.abs(smoothedRate[k])
      if (v > peakVal) {
        peakVal = v
        peakLocalIdx = k - seg.start
      }
    }
    if (peakVal <= 0) continue

    const segAbs = new Float64Array(seg.end - seg.start)
    for (let k = seg.start; k < seg.end; k++) segAbs[k - seg.start] = Math.abs(smoothedRate[k])
    // findPeaks's local-max test (v >= neighbour, strictly greater than at
    // least one) counts BOTH endpoints of a length-2 exact-equal plateau as
    // separate local maxima (only interior points of a length >=3 plateau
    // get rejected) — distance-smoothing routinely produces such 2-sample
    // plateaus, so raw findPeaks output needs an adjacent-index merge pass
    // (mergeAdjacentPeaks below) or every one becomes a spurious duplicate
    // corner a metre or two apart.
    const subPeaks = mergeAdjacentPeaks(findPeaks(segAbs, { minProminence: peakVal * SUBPEAK_PROMINENCE_FRACTION }))

    // findPeaks can come back empty for a very short segment (its own peak
    // sits at a boundary, which the prominence walk treats specially) even
    // though the segment itself cleared thetaMinDeg — fall back to the
    // segment's own strongest point so a real, if brief, corner isn't lost.
    const picks =
      subPeaks.length > 0
        ? subPeaks
        : [{ index: peakLocalIdx, value: peakVal, prominence: peakVal }]

    for (const p of picks) {
      const k = seg.start + p.index
      const pointIdx = idxs[k]
      candidates.push({
        index: pointIdx,
        distanceM: dist[k],
        lat: track.lat[pointIdx],
        lon: track.lon[pointIdx],
        value: p.value,
        prominence: p.prominence,
      })
    }
  }

  const spaced = suppressNearby(candidates, minSpacingM)
  const kept = persistenceGapSelect([...spaced].sort((a, b) => b.prominence - a.prominence))
  let result = kept.sort((a, b) => a.distanceM - b.distanceM)

  if (result.length > maxGates) {
    result = [...result]
      .sort((a, b) => b.prominence - a.prominence)
      .slice(0, maxGates)
      .sort((a, b) => a.distanceM - b.distanceM)
  }

  return result
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
  // A detected corner sits exactly on one recorded GPS sample. Centring the
  // gate on that same sample makes the reference path touch the gate at a
  // segment endpoint twice (previous -> sample, sample -> next), while the
  // shared robust intersection test intentionally rejects endpoint-only
  // touches to avoid double counting. Put the gate halfway toward the next
  // valid fix instead: the reference segment now properly straddles it, with
  // a sub-sample spatial shift that is negligible versus the 15 m half-width.
  let next = corner.index + 1
  while (
    next < track.valid.length &&
    (!track.valid[next] || (track.lat[next] === corner.lat && track.lon[next] === corner.lon))
  ) next++
  const centreLat = next < track.valid.length ? (corner.lat + track.lat[next]) / 2 : corner.lat
  const centreLon = next < track.valid.length ? (corner.lon + track.lon[next]) / 2 : corner.lon
  const rad = toRadians(heading)
  const cosLat = Math.cos(toRadians(centreLat)) || 1
  // Perpendicular unit vector (east, north) — rotate the heading vector -90°.
  const east = Math.cos(rad)
  const north = -Math.sin(rad)
  const dLat = toDegrees((north * halfWidthM) / EARTH_R)
  const dLon = toDegrees((east * halfWidthM) / (EARTH_R * cosLat))
  return {
    a: { lat: centreLat + dLat, lon: centreLon + dLon },
    b: { lat: centreLat - dLat, lon: centreLon - dLon },
  }
}
