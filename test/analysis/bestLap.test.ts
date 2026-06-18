import { describe, it, expect } from 'vitest'
import { fastestLapIndex, slowestLapIndex } from '@/domain/analysis/bestLap'
import type { Lap } from '@/domain/model/Lap'

/** Build a Lap with just the fields the best-lap search reads. */
function lap(index: number, lapTimeMs: number): Lap {
  return { index, startIdx: index * 10, endIdx: index * 10 + 10, lapTimeMs }
}

describe('fastestLapIndex', () => {
  it('returns null for no laps', () => {
    expect(fastestLapIndex([], [])).toBeNull()
  })

  it('finds the smallest positive lap time', () => {
    const laps = [lap(0, 90000), lap(1, 88000), lap(2, 91000)]
    expect(fastestLapIndex(laps, [])).toBe(1)
  })

  it('ignores excluded laps even when they are the fastest', () => {
    const laps = [lap(0, 90000), lap(1, 85000), lap(2, 88000)]
    expect(fastestLapIndex(laps, [1])).toBe(2)
  })

  it('returns null when every lap is excluded', () => {
    const laps = [lap(0, 90000), lap(1, 88000)]
    expect(fastestLapIndex(laps, [0, 1])).toBeNull()
  })

  it('skips non-finite and non-positive lap times', () => {
    const laps = [lap(0, NaN), lap(1, 0), lap(2, -5), lap(3, 95000)]
    expect(fastestLapIndex(laps, [])).toBe(3)
  })

  it('returns null when no lap has a valid time', () => {
    expect(fastestLapIndex([lap(0, NaN), lap(1, 0)], [])).toBeNull()
  })

  it('matches exclusions by lap.index, not array position', () => {
    // Lap order is reversed; excluding index 5 must skip THAT lap.
    const laps = [lap(5, 80000), lap(4, 82000)]
    expect(fastestLapIndex(laps, [5])).toBe(4)
  })
})

describe('slowestLapIndex', () => {
  it('returns null for no laps', () => {
    expect(slowestLapIndex([], [])).toBeNull()
  })

  it('finds the largest positive lap time', () => {
    const laps = [lap(0, 90000), lap(1, 88000), lap(2, 91000)]
    expect(slowestLapIndex(laps, [])).toBe(2)
  })

  it('ignores excluded laps even when they are the slowest', () => {
    const laps = [lap(0, 90000), lap(1, 99000), lap(2, 88000)]
    expect(slowestLapIndex(laps, [1])).toBe(0)
  })

  it('skips non-finite and non-positive lap times', () => {
    const laps = [lap(0, NaN), lap(1, 0), lap(2, -5), lap(3, 95000)]
    expect(slowestLapIndex(laps, [])).toBe(3)
  })

  it('with one valid lap, fastest and slowest coincide', () => {
    const laps = [lap(0, 90000)]
    expect(fastestLapIndex(laps, [])).toBe(0)
    expect(slowestLapIndex(laps, [])).toBe(0)
  })
})
