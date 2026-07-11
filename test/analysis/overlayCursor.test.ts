import { describe, expect, it } from 'vitest'
import {
  rebasedX,
  sampleIndexAtGridX,
  gridIndexAtSampleIndex,
  lapContaining,
} from '@/domain/analysis/overlayCursor'
import type { Lap } from '@/domain/model/Lap'

// A distance-like (monotonic) axis; the lap spans samples 1..4.
const xValues = [0, 10, 20, 30, 40, 50]
const lap: Lap = { index: 0, startIdx: 1, endIdx: 4, lapTimeMs: 1000 }
// Shared grid the overlay plots against (lap-relative, evenly spaced).
const grid = Float64Array.from([0, 5, 10, 15, 20, 25, 30])

describe('rebasedX', () => {
  it('shifts a sample so the lap starts near 0, plus the offset', () => {
    expect(rebasedX(xValues, lap, 0, 1)).toBe(0)
    expect(rebasedX(xValues, lap, 0, 3)).toBe(20)
    expect(rebasedX(xValues, lap, 5, 3)).toBe(25)
  })
})

describe('sampleIndexAtGridX (grid → session sample)', () => {
  it('finds the lap sample whose rebased X is nearest the grid X', () => {
    expect(sampleIndexAtGridX(xValues, lap, 0, 12)).toBe(2) // rebased 10 vs 20 → 2
    expect(sampleIndexAtGridX(xValues, lap, 0, 18)).toBe(3) // rebased 20 vs 10 → 3
  })

  it('honours the per-lap offset', () => {
    // offset 5 ⇒ rebased Xs are 5,15,25,35 for samples 1..4; 12 is nearest 15 (sample 2).
    expect(sampleIndexAtGridX(xValues, lap, 5, 12)).toBe(2)
  })

  it('never leaves the lap span', () => {
    expect(sampleIndexAtGridX(xValues, lap, 0, -100)).toBe(1) // clamps to first lap sample
    expect(sampleIndexAtGridX(xValues, lap, 0, 999)).toBe(4) // clamps to last lap sample
  })

  it('returns null when the grid value is non-finite', () => {
    expect(sampleIndexAtGridX(xValues, lap, 0, NaN)).toBeNull()
  })
})

describe('gridIndexAtSampleIndex (session sample → grid)', () => {
  it('finds the nearest grid index for an in-lap sample', () => {
    expect(gridIndexAtSampleIndex(xValues, lap, 0, grid, 3)).toBe(4) // rebased 20 → grid[4]=20
    expect(gridIndexAtSampleIndex(xValues, lap, 0, grid, 2)).toBe(2) // rebased 10 → grid[2]=10
  })

  it('returns null for a sample outside the lap', () => {
    expect(gridIndexAtSampleIndex(xValues, lap, 0, grid, 0)).toBeNull() // before startIdx
    expect(gridIndexAtSampleIndex(xValues, lap, 0, grid, 5)).toBeNull() // after endIdx
  })

  it('round-trips with sampleIndexAtGridX', () => {
    const g = 4
    const sample = sampleIndexAtGridX(xValues, lap, 0, grid[g])!
    expect(gridIndexAtSampleIndex(xValues, lap, 0, grid, sample)).toBe(g)
  })
})

describe('lapContaining', () => {
  const laps: Lap[] = [
    { index: 0, startIdx: 1, endIdx: 4, lapTimeMs: 1000 },
    { index: 1, startIdx: 5, endIdx: 9, lapTimeMs: 1100 },
  ]

  it('returns the lap whose span contains the sample', () => {
    expect(lapContaining(laps, 3)?.index).toBe(0)
    expect(lapContaining(laps, 7)?.index).toBe(1)
  })

  it('returns null when no lap contains the sample', () => {
    expect(lapContaining(laps, 0)).toBeNull()
    expect(lapContaining(laps, 42)).toBeNull()
  })
})
