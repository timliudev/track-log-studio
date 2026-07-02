import { describe, it, expect } from 'vitest'
import { outOfBandLapIndices, suggestLapTimeBand, type LapTimeBand } from '@/domain/analysis/lapValidity'
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
