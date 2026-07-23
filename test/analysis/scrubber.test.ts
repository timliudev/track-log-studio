import { describe, it, expect } from 'vitest'
import {
  scrubberDomain,
  clampToDomain,
  fractionToSampleIndex,
  sampleIndexToFraction,
  elapsedMsInDomain,
  domainDurationMs,
  advanceByTime,
  type ScrubberDomain,
} from '@/domain/analysis/scrubber'
import { gridIndexAtSampleIndex, lapContaining } from '@/domain/analysis/overlayCursor'
import type { Lap } from '@/domain/model/Lap'

function lap(index: number, startIdx: number, endIdx: number): Lap {
  return { index, startIdx, endIdx, lapTimeMs: (endIdx - startIdx) * 10 }
}

// 101 samples, timeMs = 0..1000ms in 10ms steps — index i is at t = i*10ms.
const TIME_MS = new Float64Array(Array.from({ length: 101 }, (_, i) => i * 10))

describe('scrubberDomain', () => {
  it('is null for fewer than 2 samples', () => {
    expect(scrubberDomain([], 0)).toBeNull()
    expect(scrubberDomain([], 1)).toBeNull()
  })

  it('is the full session when no lap is selected', () => {
    expect(scrubberDomain([], 101)).toEqual({ startIdx: 0, endIdx: 100 })
  })

  it('is the full session when 2+ laps are selected', () => {
    expect(scrubberDomain([lap(0, 0, 20), lap(1, 21, 50)], 101)).toEqual({ startIdx: 0, endIdx: 100 })
  })

  it('is the selected lap span when exactly one lap is selected', () => {
    expect(scrubberDomain([lap(0, 10, 40)], 101)).toEqual({ startIdx: 10, endIdx: 40 })
  })

  it('clamps a single selected lap to the actual sample count', () => {
    expect(scrubberDomain([lap(0, 90, 500)], 101)).toEqual({ startIdx: 90, endIdx: 100 })
  })

  it('is null for a degenerate (empty/point) single-lap span', () => {
    expect(scrubberDomain([lap(0, 5, 5)], 101)).toBeNull()
    expect(scrubberDomain([lap(0, 200, 300)], 101)).toBeNull()
  })
})

describe('fractionToSampleIndex / sampleIndexToFraction', () => {
  const domain: ScrubberDomain = { startIdx: 10, endIdx: 40 }

  it('round-trips endpoints', () => {
    expect(fractionToSampleIndex(domain, 0)).toBe(10)
    expect(fractionToSampleIndex(domain, 1)).toBe(40)
    expect(sampleIndexToFraction(domain, 10)).toBe(0)
    expect(sampleIndexToFraction(domain, 40)).toBe(1)
  })

  it('maps a mid fraction to the nearest sample', () => {
    expect(fractionToSampleIndex(domain, 0.5)).toBe(25)
  })

  it('clamps out-of-range fractions', () => {
    expect(fractionToSampleIndex(domain, -1)).toBe(10)
    expect(fractionToSampleIndex(domain, 2)).toBe(40)
  })

  it('treats a non-finite fraction as 0', () => {
    expect(fractionToSampleIndex(domain, NaN)).toBe(10)
  })

  it('clamps an out-of-domain sample index before computing a fraction', () => {
    expect(sampleIndexToFraction(domain, 0)).toBe(0)
    expect(sampleIndexToFraction(domain, 999)).toBe(1)
  })

  it('reads 0 for a degenerate single-sample domain instead of NaN', () => {
    const point: ScrubberDomain = { startIdx: 5, endIdx: 5 }
    expect(sampleIndexToFraction(point, 5)).toBe(0)
  })
})

describe('clampToDomain', () => {
  const domain: ScrubberDomain = { startIdx: 10, endIdx: 40 }
  it('clamps below/above and rounds fractional indices', () => {
    expect(clampToDomain(domain, 0)).toBe(10)
    expect(clampToDomain(domain, 999)).toBe(40)
    expect(clampToDomain(domain, 25.6)).toBe(26)
  })
})

describe('elapsedMsInDomain / domainDurationMs', () => {
  const domain: ScrubberDomain = { startIdx: 10, endIdx: 40 }

  it('is the elapsed time from the domain start', () => {
    expect(elapsedMsInDomain(domain, TIME_MS, 10)).toBe(0)
    expect(elapsedMsInDomain(domain, TIME_MS, 25)).toBe(150)
    expect(elapsedMsInDomain(domain, TIME_MS, 40)).toBe(300)
  })

  it('is null without a time axis', () => {
    expect(elapsedMsInDomain(domain, null, 25)).toBeNull()
  })

  it('domainDurationMs is the elapsed time to the domain end', () => {
    expect(domainDurationMs(domain, TIME_MS)).toBe(300)
  })
})

describe('advanceByTime', () => {
  const domain: ScrubberDomain = { startIdx: 0, endIdx: 100 }

  it('steps forward along timeMs by deltaMs at 1x', () => {
    // t(20) = 200ms; from index 0 (t=0), +200ms real time at 1x lands on index 20.
    expect(advanceByTime(domain, TIME_MS, 0, 200, 1)).toBe(20)
  })

  it('scales by speed', () => {
    expect(advanceByTime(domain, TIME_MS, 0, 200, 2)).toBe(40)
  })

  it('never advances past the domain end', () => {
    expect(advanceByTime(domain, TIME_MS, 90, 10_000, 1)).toBe(100)
  })

  it('is idempotent (no movement) for a non-positive delta', () => {
    expect(advanceByTime(domain, TIME_MS, 30, 0, 1)).toBe(30)
    expect(advanceByTime(domain, TIME_MS, 30, -50, 1)).toBe(30)
  })

  it('returns the clamped current index without a time axis', () => {
    expect(advanceByTime(domain, null, 30, 200, 1)).toBe(30)
  })

  it('accumulates monotonically across successive small steps (typical rAF deltas) without overshoot', () => {
    let idx = 0
    // 20 frames of ~16.7ms (~60fps) at 1x: each frame floors to the last
    // 10ms-spaced sample that doesn't overshoot, so it never advances faster
    // than real time (some intra-frame remainder is dropped each frame,
    // matching a real device's per-frame quantization to a NEW sample).
    for (let i = 0; i < 20; i++) idx = advanceByTime(domain, TIME_MS, idx, 16.7, 1)
    expect(idx).toBe(20)
    expect(TIME_MS[idx]).toBeLessThanOrEqual(20 * 16.7)
  })
})

describe('sample index <-> lap-relative grid index (reusing overlayCursor.ts — the SAME conversion the overlay path uses, not a duplicate)', () => {
  // A single selected lap spanning session samples [10, 40], with its own
  // xValues starting at 0 (so rebased X === offset from lap start).
  const XVALUES = new Float64Array(Array.from({ length: 101 }, (_, i) => i))
  const selectedLap = lap(0, 10, 40)
  const domain = scrubberDomain([selectedLap], 101)!
  // The overlay's shared grid, in this simple case identical to the lap's own
  // rebased span (0..30).
  const grid = new Float64Array(Array.from({ length: 31 }, (_, i) => i))

  it('a scrubber-derived session sample index maps onto the overlay grid index, and lapContaining finds the same lap', () => {
    const sampleIdx = fractionToSampleIndex(domain, 0.5) // -> 25 (mid of [10,40])
    expect(sampleIdx).toBe(25)
    expect(lapContaining([selectedLap], sampleIdx)).toBe(selectedLap)
    const gridIdx = gridIndexAtSampleIndex(XVALUES, selectedLap, 0, grid, sampleIdx)
    expect(gridIdx).toBe(15) // rebased: 25 - 10 + 0
  })

  it('domain endpoints map onto the grid endpoints', () => {
    expect(gridIndexAtSampleIndex(XVALUES, selectedLap, 0, grid, domain.startIdx)).toBe(0)
    expect(gridIndexAtSampleIndex(XVALUES, selectedLap, 0, grid, domain.endIdx)).toBe(30)
  })
})
