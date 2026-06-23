import { describe, it, expect } from 'vitest'
import { outOfBandLapIndices, type LapTimeBand } from '@/domain/analysis/lapValidity'
import type { Lap } from '@/domain/model/Lap'

/** Build a Lap with just the fields the band check reads (lapTimeMs given in seconds). */
function lap(index: number, lapTimeSec: number): Lap {
  return { index, startIdx: index * 10, endIdx: index * 10 + 10, lapTimeMs: lapTimeSec * 1000 }
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
