import { describe, it, expect } from 'vitest'
import {
  outOfBandLapIndices,
  outOfBandDistanceLapIndices,
  suggestLapTimeBand,
  suggestLapDistanceBand,
  type LapTimeBand,
  type LapDistanceBand,
} from '@/domain/analysis/lapValidity'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import type { Lap } from '@/domain/model/Lap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

/** Build a Lap with just the fields the band check reads (lapTimeMs given in seconds). */
function lap(index: number, lapTimeSec: number): Lap {
  return { index, startIdx: index * 10, endIdx: index * 10 + 10, lapTimeMs: lapTimeSec * 1000 }
}

/** A straight-line track along longitude, 1 sample per unit index, so
 *  cumulativeDistanceM grows ~linearly with sample index — lets tests control
 *  each lap's "distance" purely via its startIdx/endIdx span. */
function straightTrack(lengthIdx: number): GpsTrack {
  return {
    lat: new Float64Array(lengthIdx).fill(0),
    lon: Float64Array.from({ length: lengthIdx }, (_, i) => i * 0.001),
    valid: new Uint8Array(lengthIdx).fill(1),
  }
}

describe('outOfBandLapIndices', () => {
  // ARK-style laps: 48, 51 valid; 40 too fast; 60 too slow.
  const laps = [lap(0, 48), lap(1, 60), lap(2, 51), lap(3, 40)]

  it('null band excludes nothing', () => {
    expect(outOfBandLapIndices(laps, null)).toEqual([])
  })

  it('a both-null band excludes nothing', () => {
    expect(outOfBandLapIndices(laps, { minSec: null, maxSec: null })).toEqual([])
  })

  it('excludes laps outside [min, max]', () => {
    const band: LapTimeBand = { minSec: 46, maxSec: 53 }
    // index 1 (60s, too slow) and index 3 (40s, too fast).
    expect(outOfBandLapIndices(laps, band).sort()).toEqual([1, 3])
  })

  it('bounds are inclusive', () => {
    // 48 and 51 sit on/inside; tighten so 48 is the exact min and 51 the exact max.
    const band: LapTimeBand = { minSec: 48, maxSec: 51 }
    expect(outOfBandLapIndices(laps, band).sort()).toEqual([1, 3])
  })

  it('only-min set caps the fast side only', () => {
    const band: LapTimeBand = { minSec: 46, maxSec: null }
    // Only the 40s lap is too fast; the 60s slow lap is allowed.
    expect(outOfBandLapIndices(laps, band)).toEqual([3])
  })

  it('only-max set caps the slow side only', () => {
    const band: LapTimeBand = { minSec: null, maxSec: 53 }
    // Only the 60s lap is too slow; the 40s fast lap is allowed.
    expect(outOfBandLapIndices(laps, band)).toEqual([1])
  })

  it('returns indices by lap.index, not array position', () => {
    const reversed = [lap(5, 60), lap(4, 50)]
    expect(outOfBandLapIndices(reversed, { minSec: 46, maxSec: 53 })).toEqual([5])
  })

  it('treats NaN / non-positive lap times as in-band (never silently dropped)', () => {
    const odd = [lap(0, NaN), lap(1, 0), lap(2, -5), lap(3, 50)]
    expect(outOfBandLapIndices(odd, { minSec: 46, maxSec: 53 })).toEqual([])
  })

  it('ignores non-finite bounds (treated as open side)', () => {
    const band: LapTimeBand = { minSec: NaN, maxSec: 53 }
    // NaN min is open → only the 60s slow lap is excluded.
    expect(outOfBandLapIndices(laps, band)).toEqual([1])
  })

  it('empty laps yields no indices', () => {
    expect(outOfBandLapIndices([], { minSec: 46, maxSec: 53 })).toEqual([])
  })
})

describe('outOfBandDistanceLapIndices', () => {
  // straightTrack: ~111.19 m per index step (haversine along this lon spacing).
  const track = straightTrack(400)
  // Laps spanning 90/100/110/40 index-steps -> distances ~10007.5 / 11119.5 /
  // 12231.4 / 4447.8 m. Built with disjoint index ranges so each lap's span is
  // exactly controlled (lap-time value is irrelevant here).
  const laps: Lap[] = [
    { index: 0, startIdx: 0, endIdx: 90, lapTimeMs: 50000 }, // ~10007.5 m (short)
    { index: 1, startIdx: 90, endIdx: 190, lapTimeMs: 50000 }, // ~11119.5 m (normal)
    { index: 2, startIdx: 190, endIdx: 300, lapTimeMs: 50000 }, // ~12231.4 m (long)
    { index: 3, startIdx: 300, endIdx: 340, lapTimeMs: 50000 }, // ~4447.8 m (very short)
  ]

  it('null band excludes nothing', () => {
    expect(outOfBandDistanceLapIndices(laps, track, null)).toEqual([])
  })

  it('a both-null band excludes nothing', () => {
    expect(outOfBandDistanceLapIndices(laps, track, { minM: null, maxM: null })).toEqual([])
  })

  it('no track excludes nothing (even with a band set)', () => {
    const band: LapDistanceBand = { minM: 9000, maxM: 13000 }
    expect(outOfBandDistanceLapIndices(laps, null, band)).toEqual([])
  })

  it('excludes laps outside [minM, maxM]', () => {
    const band: LapDistanceBand = { minM: 9000, maxM: 13000 }
    // Lap 3 (~4447.8 m) is too short; laps 0/1/2 (~10007/11119/12231 m) are inside.
    expect(outOfBandDistanceLapIndices(laps, track, band)).toEqual([3])
  })

  it('only-min set caps the short side only', () => {
    const band: LapDistanceBand = { minM: 9000, maxM: null }
    expect(outOfBandDistanceLapIndices(laps, track, band)).toEqual([3])
  })

  it('only-max set caps the long side only', () => {
    const band: LapDistanceBand = { minM: null, maxM: 11500 }
    // Lap 2 (~12231.4 m) is too long.
    expect(outOfBandDistanceLapIndices(laps, track, band)).toEqual([2])
  })

  it('bounds are inclusive', () => {
    // Use the SAME cumulative-distance function under test to get lap 0's exact
    // distance (avoids float drift from approximating via M_PER_STEP * steps).
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const lap0Dist = cum[90] - cum[0]
    const band: LapDistanceBand = { minM: lap0Dist, maxM: lap0Dist }
    // Only lap 0 sits exactly on the (single-point) band; everything else is out.
    expect(outOfBandDistanceLapIndices(laps, track, band).sort()).toEqual([1, 2, 3])
  })

  it('returns indices by lap.index, not array position', () => {
    const reversed = [
      { index: 7, startIdx: 190, endIdx: 300, lapTimeMs: 50000 }, // long
      { index: 6, startIdx: 90, endIdx: 190, lapTimeMs: 50000 }, // normal
    ]
    expect(outOfBandDistanceLapIndices(reversed, track, { minM: 9000, maxM: 11500 })).toEqual([7])
  })

  it('treats non-finite/non-positive distances as in-band (never silently dropped)', () => {
    // A degenerate lap (endIdx === startIdx) has zero distance.
    const degenerate: Lap[] = [{ index: 0, startIdx: 5, endIdx: 5, lapTimeMs: 50000 }]
    expect(outOfBandDistanceLapIndices(degenerate, track, { minM: 9000, maxM: 13000 })).toEqual([])
  })

  it('ignores non-finite bounds (treated as open side)', () => {
    const band: LapDistanceBand = { minM: NaN, maxM: 11500 }
    // NaN min is open -> only lap 2 (too long) is excluded.
    expect(outOfBandDistanceLapIndices(laps, track, band)).toEqual([2])
  })

  it('empty laps yields no indices', () => {
    expect(outOfBandDistanceLapIndices([], track, { minM: 9000, maxM: 13000 })).toEqual([])
  })
})

describe('suggestLapTimeBand', () => {
  it('returns null with no laps', () => {
    expect(suggestLapTimeBand(straightTrack(100), [])).toBeNull()
  })

  it('suggests median ± 20% over plausible (similar-distance) laps', () => {
    const track = straightTrack(400)
    // All laps span 100 samples (equal distance) -> all plausible.
    // Lap times: 48, 60, 51 -> median 51 -> band [40.8, 61.2].
    const laps = [lap(0, 48), lap(1, 60), lap(2, 51)].map((l, i) => ({
      ...l,
      startIdx: i * 100,
      endIdx: i * 100 + 100,
    }))
    const band = suggestLapTimeBand(track, laps)
    expect(band).not.toBeNull()
    expect(band!.minSec).toBeCloseTo(51 * 0.8)
    expect(band!.maxSec).toBeCloseTo(51 * 1.2)
  })

  it('excludes an implausible short/partial lap from the median (mirrors pickReferenceLap)', () => {
    const track = straightTrack(500)
    // Three "full" laps of equal distance (100 samples) at ~48-51s, plus one
    // short partial lap (10 samples, a fifth of the distance) that is
    // numerically fast (21s) but should not skew the suggested band.
    const laps = [
      { ...lap(0, 48), startIdx: 0, endIdx: 100 },
      { ...lap(1, 51), startIdx: 100, endIdx: 200 },
      { ...lap(2, 50), startIdx: 200, endIdx: 300 },
      { ...lap(3, 21), startIdx: 300, endIdx: 310 },
    ]
    const band = suggestLapTimeBand(track, laps)
    expect(band).not.toBeNull()
    // Median of the plausible pool (48, 51, 50) is 50 (sorted: 48,50,51 -> index 1 -> 50).
    expect(band!.minSec).toBeCloseTo(50 * 0.8)
    expect(band!.maxSec).toBeCloseTo(50 * 1.2)
  })

  it('falls back to all laps when none look distance-plausible (median is 0)', () => {
    // Every lap has zero span -> zero distance -> medianDist is 0 -> pool is every lap.
    const track = straightTrack(10)
    const laps = [
      { ...lap(0, 40), startIdx: 0, endIdx: 0 },
      { ...lap(1, 60), startIdx: 0, endIdx: 0 },
    ]
    const band = suggestLapTimeBand(track, laps)
    expect(band).not.toBeNull()
    // Median of [40, 60] (lower of pair, index 1) -> 60.
    expect(band!.minSec).toBeCloseTo(60 * 0.8)
    expect(band!.maxSec).toBeCloseTo(60 * 1.2)
  })

  it('ignores non-finite/non-positive lap times when computing the median', () => {
    const track = straightTrack(400)
    const laps = [
      { ...lap(0, 50), startIdx: 0, endIdx: 100 },
      { ...lap(1, NaN), startIdx: 100, endIdx: 200 },
      { ...lap(2, 0), startIdx: 200, endIdx: 300 },
    ]
    const band = suggestLapTimeBand(track, laps)
    expect(band).not.toBeNull()
    expect(band!.minSec).toBeCloseTo(50 * 0.8)
    expect(band!.maxSec).toBeCloseTo(50 * 1.2)
  })

  it('returns null when every lap time is non-finite/non-positive', () => {
    const track = straightTrack(200)
    const laps = [
      { ...lap(0, NaN), startIdx: 0, endIdx: 100 },
      { ...lap(1, 0), startIdx: 100, endIdx: 200 },
    ]
    expect(suggestLapTimeBand(track, laps)).toBeNull()
  })
})

describe('suggestLapDistanceBand', () => {
  it('returns null with no laps', () => {
    expect(suggestLapDistanceBand(straightTrack(100), [])).toBeNull()
  })

  it('suggests median distance ± 20% over the plausible pool', () => {
    const track = straightTrack(400)
    // All laps span 100 samples -> identical distance -> all plausible -> median
    // equals that one shared distance value.
    const laps = [lap(0, 48), lap(1, 60), lap(2, 51)].map((l, i) => ({
      ...l,
      startIdx: i * 100,
      endIdx: i * 100 + 100,
    }))
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const expectedDist = cum[100] - cum[0]
    const band = suggestLapDistanceBand(track, laps)
    expect(band).not.toBeNull()
    expect(band!.minM).toBeCloseTo(expectedDist * 0.8)
    expect(band!.maxM).toBeCloseTo(expectedDist * 1.2)
  })

  it('excludes an implausible short/partial lap from the median (mirrors suggestLapTimeBand)', () => {
    const track = straightTrack(500)
    // Three "full" 100-sample laps, plus one short 10-sample partial lap that
    // should not skew the distance median.
    const laps = [
      { ...lap(0, 48), startIdx: 0, endIdx: 100 },
      { ...lap(1, 51), startIdx: 100, endIdx: 200 },
      { ...lap(2, 50), startIdx: 200, endIdx: 300 },
      { ...lap(3, 21), startIdx: 300, endIdx: 310 },
    ]
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const fullLapDist = cum[100] - cum[0]
    const band = suggestLapDistanceBand(track, laps)
    expect(band).not.toBeNull()
    // All three "full" laps share the same 100-sample distance, so the median
    // of the plausible pool is that shared distance regardless of which lap
    // times they carry.
    expect(band!.minM).toBeCloseTo(fullLapDist * 0.8)
    expect(band!.maxM).toBeCloseTo(fullLapDist * 1.2)
  })

  it('falls back to all laps when every lap has zero distance (median is 0) -> null', () => {
    // Every lap has zero span -> zero distance -> medianDist is 0 -> nothing to
    // suggest a distance band from (unlike the time band, which can still fall
    // back to a lap-TIME median even when distance is degenerate).
    const track = straightTrack(10)
    const laps = [
      { ...lap(0, 40), startIdx: 0, endIdx: 0 },
      { ...lap(1, 60), startIdx: 0, endIdx: 0 },
    ]
    expect(suggestLapDistanceBand(track, laps)).toBeNull()
  })

  it('is consistent with suggestLapTimeBand’s plausibility pool (same laps kept/dropped)', () => {
    const track = straightTrack(500)
    const laps = [
      { ...lap(0, 48), startIdx: 0, endIdx: 100 },
      { ...lap(1, 51), startIdx: 100, endIdx: 200 },
      { ...lap(2, 50), startIdx: 200, endIdx: 300 },
      { ...lap(3, 21), startIdx: 300, endIdx: 310 }, // implausible partial lap
    ]
    const timeBand = suggestLapTimeBand(track, laps)
    const distBand = suggestLapDistanceBand(track, laps)
    expect(timeBand).not.toBeNull()
    expect(distBand).not.toBeNull()
    // Median lap TIME of the plausible pool (48, 51, 50) is 50s -> band [40, 60].
    expect(timeBand!.minSec).toBeCloseTo(40)
    expect(timeBand!.maxSec).toBeCloseTo(60)
  })
})
