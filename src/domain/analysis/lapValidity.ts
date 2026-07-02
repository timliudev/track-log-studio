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

/** True when the band has no effective constraint (null, or both bounds null/non-finite). */
function isEmptyBand(band: LapTimeBand | null): boolean {
  if (!band) return true
  const hasMin = band.minSec != null && Number.isFinite(band.minSec)
  const hasMax = band.maxSec != null && Number.isFinite(band.maxSec)
  return !hasMin && !hasMax
}

/**
 * Decide whether one lap's time (in seconds) falls OUTSIDE the band. The band's
 * bounds are inclusive; a null/non-finite bound leaves that side unconstrained.
 *
 * Safety rule: an unknown lap time (NaN / non-finite / non-positive) is treated
 * as IN-band — the band never silently drops a lap whose duration we can't trust.
 * Manual exclusion remains the user's tool for those.
 */
function isOutOfBand(lapTimeSec: number, band: LapTimeBand): boolean {
  if (!Number.isFinite(lapTimeSec) || lapTimeSec <= 0) return false
  if (band.minSec != null && Number.isFinite(band.minSec) && lapTimeSec < band.minSec) return true
  if (band.maxSec != null && Number.isFinite(band.maxSec) && lapTimeSec > band.maxSec) return true
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
  if (isEmptyBand(band) || band == null) return []
  const out: number[] = []
  for (const lap of laps) {
    if (isOutOfBand(lap.lapTimeMs / 1000, band)) out.push(lap.index)
  }
  return out
}

/** Fraction (±) applied to the median PLAUSIBLE-lap distance to pick the
 *  distance-plausibility pool, and separately to the median time of that pool
 *  to derive the suggested band — same 20% used by {@link pickReferenceLap}. */
const PLAUSIBILITY_FRACTION = 0.2

/** The middle value of a non-empty numeric array (lower-of-pair on ties, same
 *  convention as {@link pickReferenceLap}'s median). */
function median(sorted: readonly number[]): number {
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Suggest a sane default valid-lap-time band from a session's detected laps:
 * median lap TIME (in seconds) ± 20%, computed over the "plausible" subset of
 * laps — those whose DISTANCE is within 20% of the median distance — so a
 * broken/partial lap (e.g. a short pit-lane sliver) doesn't skew the
 * suggestion the same way {@link pickReferenceLap} avoids picking one as the
 * corner-detection reference.
 *
 * Pure; returns null when there's nothing to suggest from (no laps, or no
 * valid track to measure distance with).
 */
export function suggestLapTimeBand(track: GpsTrack, laps: readonly Lap[]): LapTimeBand | null {
  if (laps.length === 0) return null

  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const distanceOf = (l: Lap): number => {
    const n = fullDist.length
    if (n === 0) return 0
    const end = Math.min(l.endIdx, n - 1)
    const start = Math.min(l.startIdx, n - 1)
    return fullDist[end] - fullDist[start]
  }

  const distances = laps.map(distanceOf)
  const sortedDist = [...distances].sort((a, b) => a - b)
  const medianDist = median(sortedDist)
  const plausible =
    medianDist > 0
      ? laps.filter((_, i) => Math.abs(distances[i] - medianDist) <= medianDist * PLAUSIBILITY_FRACTION)
      : laps
  const pool = (plausible.length > 0 ? plausible : laps).filter(
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
