import type { Lap } from '@/domain/model/Lap'
import type { GpsTrack } from './gpsTrack'
import { cumulativeDistanceM } from './distance'

/**
 * A valid lap-time band in SECONDS. Either bound may be null to leave that side
 * open: `{ minSec: 46, maxSec: 53 }` keeps 46‒53 s laps, `{ minSec: null,
 * maxSec: 53 }` only caps the slow side, and `{ minSec: null, maxSec: null }`
 * (or a null band) constrains nothing. Bounds are INCLUSIVE.
 */
export interface LapTimeBand {
  minSec: number | null
  maxSec: number | null
}

/**
 * A valid lap-DISTANCE band in METRES (the same unit {@link cumulativeDistanceM}
 * and the `distance` lap metric use internally; the UI converts to km for
 * display). Same null/open-side/inclusive-bounds conventions as {@link LapTimeBand}:
 * a cut-course ("切西瓜") lap can still land inside the TIME band if it waited
 * long enough inside the track, but its distance is clearly short — and a
 * wrong-line/extra-loop lap is clearly long — so this is an independent signal.
 */
export interface LapDistanceBand {
  minM: number | null
  maxM: number | null
}

/** True when the band has no effective constraint (null, or both bounds null/non-finite). */
function isEmptyBand<K extends string>(band: Record<K, number | null> | null, minKey: K, maxKey: K): boolean {
  if (!band) return true
  const hasMin = band[minKey] != null && Number.isFinite(band[minKey])
  const hasMax = band[maxKey] != null && Number.isFinite(band[maxKey])
  return !hasMin && !hasMax
}

/**
 * Decide whether one numeric value falls OUTSIDE the band. The band's bounds
 * are inclusive; a null/non-finite bound leaves that side unconstrained.
 *
 * Safety rule: an unknown value (NaN / non-finite / non-positive) is treated as
 * IN-band — the band never silently drops a lap whose time/distance we can't
 * trust. Manual exclusion remains the user's tool for those.
 */
function isOutOfBand(value: number, min: number | null, max: number | null): boolean {
  if (!Number.isFinite(value) || value <= 0) return false
  if (min != null && Number.isFinite(min) && value < min) return true
  if (max != null && Number.isFinite(max) && value > max) return true
  return false
}

/**
 * Given detected laps and an optional valid-lap-time band, return the `index`es
 * of laps whose lap time falls OUTSIDE the band. Pure.
 *
 * - A null/empty band → no laps are out-of-band (behaviour unchanged).
 * - Bounds are inclusive; only-min or only-max constrains a single side.
 * - Unknown lap times (NaN / ≤ 0) are kept IN-band (never silently dropped).
 *
 * Returned indices are `lap.index` values, matching the convention of the
 * exclusion machinery (e.g. {@link fastestLapIndex}), so they can be unioned
 * straight into the existing "excluded" set.
 */
export function outOfBandLapIndices(laps: readonly Lap[], band: LapTimeBand | null): number[] {
  if (isEmptyBand(band, 'minSec', 'maxSec') || band == null) return []
  const out: number[] = []
  for (const lap of laps) {
    if (isOutOfBand(lap.lapTimeMs / 1000, band.minSec, band.maxSec)) out.push(lap.index)
  }
  return out
}

/**
 * Given detected laps, the session's GPS track, and an optional valid-lap-
 * distance band, return the `index`es of laps whose travelled distance falls
 * OUTSIDE the band. Pure — mirrors {@link outOfBandLapIndices} exactly, just
 * measuring distance (metres) instead of time.
 *
 * - A null/empty band → no laps are out-of-band (behaviour unchanged).
 * - Bounds are inclusive; only-min or only-max constrains a single side.
 * - Unknown distances (NaN / ≤ 0, e.g. no track yet) are kept IN-band.
 */
export function outOfBandDistanceLapIndices(
  laps: readonly Lap[],
  track: GpsTrack | null,
  band: LapDistanceBand | null,
): number[] {
  if (isEmptyBand(band, 'minM', 'maxM') || band == null || !track) return []
  const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const out: number[] = []
  for (const lap of laps) {
    if (isOutOfBand(lapDistanceM(lap, cum), band.minM, band.maxM)) out.push(lap.index)
  }
  return out
}

/**
 * One lap's travelled distance (metres) from a track's precomputed cumulative-
 * distance array. Clamps `startIdx`/`endIdx` into range (mirrors how a lap can
 * reference the very last sample) so a lap at the track's tail doesn't read
 * past the array; returns 0 for a degenerate (empty) track.
 */
function lapDistanceM(lap: Lap, cumDistM: Float64Array): number {
  const n = cumDistM.length
  if (n === 0) return 0
  const end = Math.min(lap.endIdx, n - 1)
  const start = Math.min(lap.startIdx, n - 1)
  return cumDistM[end] - cumDistM[start]
}

/** Fraction (±) applied to the median PLAUSIBLE-lap distance to pick the
 *  distance-plausibility pool, and separately to the median time/distance of
 *  that pool to derive the suggested band — same 20% used by {@link pickReferenceLap}. */
const PLAUSIBILITY_FRACTION = 0.2

/** The middle value of a non-empty numeric array (lower-of-pair on ties, same
 *  convention as {@link pickReferenceLap}'s median). */
function median(sorted: readonly number[]): number {
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * The "plausible" subset of laps — those whose DISTANCE is within 20% of the
 * median distance — plus that pool's median distance. Shared by
 * {@link suggestLapTimeBand} and {@link suggestLapDistanceBand} so a
 * broken/partial lap (e.g. a short pit-lane sliver) doesn't skew either
 * suggestion, the same way {@link pickReferenceLap} avoids picking one as the
 * corner-detection reference. Falls back to ALL laps when nothing measures as
 * plausible (e.g. every lap has zero distance).
 */
function plausibleLaps(
  track: GpsTrack,
  laps: readonly Lap[],
): { laps: readonly Lap[]; medianDistM: number } {
  const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const distances = laps.map((l) => lapDistanceM(l, cum))
  const sortedDist = [...distances].sort((a, b) => a - b)
  const medianDist = median(sortedDist)
  const plausible =
    medianDist > 0
      ? laps.filter((_, i) => Math.abs(distances[i] - medianDist) <= medianDist * PLAUSIBILITY_FRACTION)
      : laps
  return { laps: plausible.length > 0 ? plausible : laps, medianDistM: medianDist }
}

/**
 * Suggest a sane default valid-lap-time band from a session's detected laps:
 * median lap TIME (in seconds) ± 20%, computed over the "plausible" subset of
 * laps (see {@link plausibleLaps}).
 *
 * Pure; returns null when there's nothing to suggest from (no laps, or no
 * valid track to measure distance with).
 */
export function suggestLapTimeBand(track: GpsTrack, laps: readonly Lap[]): LapTimeBand | null {
  if (laps.length === 0) return null

  const pool = plausibleLaps(track, laps).laps.filter(
    (l) => Number.isFinite(l.lapTimeMs) && l.lapTimeMs > 0,
  )
  if (pool.length === 0) return null

  const times = pool.map((l) => l.lapTimeMs / 1000)
  const sortedTimes = [...times].sort((a, b) => a - b)
  const medianTime = median(sortedTimes)
  if (!(medianTime > 0)) return null

  return {
    minSec: medianTime * (1 - PLAUSIBILITY_FRACTION),
    maxSec: medianTime * (1 + PLAUSIBILITY_FRACTION),
  }
}

/**
 * Suggest a sane default valid-lap-distance band from a session's detected
 * laps: median lap DISTANCE (in metres) ± 20%, computed over the same
 * "plausible" subset of laps used by {@link suggestLapTimeBand} (see
 * {@link plausibleLaps}) — so the two defaults are consistent with each other
 * and share the same "ignore a broken/partial lap" behaviour.
 *
 * Pure; returns null when there's nothing to suggest from (no laps, or no
 * valid track to measure distance with).
 */
export function suggestLapDistanceBand(track: GpsTrack, laps: readonly Lap[]): LapDistanceBand | null {
  if (laps.length === 0) return null

  const { medianDistM } = plausibleLaps(track, laps)
  if (!(medianDistM > 0)) return null

  return {
    minM: medianDistM * (1 - PLAUSIBILITY_FRACTION),
    maxM: medianDistM * (1 + PLAUSIBILITY_FRACTION),
  }
}
