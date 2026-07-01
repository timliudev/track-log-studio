import type { Lap } from '@/domain/model/Lap'

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
