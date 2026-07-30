import { describe, it, expect } from 'vitest'
import {
  playbackDomain,
  clampIndexToDomain,
  clampPosition,
  advanceByTime,
  interpolateSample,
  type PlaybackDomain,
  type PlaybackPosition,
} from '@/domain/analysis/playback'
import type { Lap } from '@/domain/model/Lap'

function lap(index: number, startIdx: number, endIdx: number): Lap {
  return { index, startIdx, endIdx, lapTimeMs: (endIdx - startIdx) * 10 }
}

// 101 samples, timeMs = 0..1000ms in 10ms steps — index i is at t = i*10ms.
const TIME_MS = new Float64Array(Array.from({ length: 101 }, (_, i) => i * 10))

describe('playbackDomain', () => {
  it('is null for fewer than 2 samples', () => {
    expect(playbackDomain([], 0)).toBeNull()
    expect(playbackDomain([], 1)).toBeNull()
  })

  it('is the full session when no lap is selected', () => {
    expect(playbackDomain([], 101)).toEqual({ startIdx: 0, endIdx: 100 })
  })

  it('is the full session when 2+ laps are selected', () => {
    expect(playbackDomain([lap(0, 0, 20), lap(1, 21, 50)], 101)).toEqual({ startIdx: 0, endIdx: 100 })
  })

  it('is the selected lap span when exactly one lap is selected', () => {
    expect(playbackDomain([lap(0, 10, 40)], 101)).toEqual({ startIdx: 10, endIdx: 40 })
  })

  it('clamps a single selected lap to the actual sample count', () => {
    expect(playbackDomain([lap(0, 90, 500)], 101)).toEqual({ startIdx: 90, endIdx: 100 })
  })

  it('is null for a degenerate (empty/point) single-lap span', () => {
    expect(playbackDomain([lap(0, 5, 5)], 101)).toBeNull()
    expect(playbackDomain([lap(0, 200, 300)], 101)).toBeNull()
  })
})

describe('clampIndexToDomain', () => {
  const domain: PlaybackDomain = { startIdx: 10, endIdx: 40 }
  it('clamps below/above and rounds fractional indices', () => {
    expect(clampIndexToDomain(domain, 0)).toBe(10)
    expect(clampIndexToDomain(domain, 999)).toBe(40)
    expect(clampIndexToDomain(domain, 25.6)).toBe(26)
  })
  it('treats a non-finite index as the domain start', () => {
    expect(clampIndexToDomain(domain, NaN)).toBe(10)
  })
})

describe('clampPosition', () => {
  const domain: PlaybackDomain = { startIdx: 10, endIdx: 40 }

  it('clamps idx into the domain and frac into [0, 1]', () => {
    expect(clampPosition(domain, { idx: 5, frac: 0.5 })).toEqual({ idx: 10, frac: 0.5 })
    expect(clampPosition(domain, { idx: 25, frac: -1 })).toEqual({ idx: 25, frac: 0 })
    expect(clampPosition(domain, { idx: 25, frac: 2 })).toEqual({ idx: 25, frac: 1 })
  })

  it('forces frac to 0 once idx reaches the domain end (no endIdx+1 sample to glide toward)', () => {
    expect(clampPosition(domain, { idx: 40, frac: 0.7 })).toEqual({ idx: 40, frac: 0 })
    expect(clampPosition(domain, { idx: 999, frac: 0.7 })).toEqual({ idx: 40, frac: 0 })
  })

  it('truncates (not rounds) a fractional idx — only frac carries the remainder', () => {
    expect(clampPosition(domain, { idx: 25.9, frac: 0 })).toEqual({ idx: 25, frac: 0 })
  })

  it('falls back to the domain start at frac 0 for non-finite input', () => {
    expect(clampPosition(domain, { idx: NaN, frac: NaN })).toEqual({ idx: 10, frac: 0 })
  })
})

describe('advanceByTime', () => {
  const domain: PlaybackDomain = { startIdx: 0, endIdx: 100 }

  it('steps forward along timeMs by deltaMs at 1x, landing exactly on a sample with frac 0', () => {
    // t(20) = 200ms; from idx 0 (t=0), +200ms real time at 1x lands exactly on index 20.
    expect(advanceByTime(domain, TIME_MS, { idx: 0, frac: 0 }, 200, 1)).toEqual({ idx: 20, frac: 0 })
  })

  it('decomposes a between-samples advance into idx + frac', () => {
    // +205ms lands 0.5 of the way from sample 20 (200ms) to sample 21 (210ms).
    expect(advanceByTime(domain, TIME_MS, { idx: 0, frac: 0 }, 205, 1)).toEqual({ idx: 20, frac: 0.5 })
  })

  it('resumes correctly from a position that already carries a fraction', () => {
    // Starting mid-glide at idx 20 frac 0.5 (t=205ms), +5ms more real time lands exactly on sample 21 (210ms).
    expect(advanceByTime(domain, TIME_MS, { idx: 20, frac: 0.5 }, 5, 1)).toEqual({ idx: 21, frac: 0 })
  })

  it('scales by speed', () => {
    expect(advanceByTime(domain, TIME_MS, { idx: 0, frac: 0 }, 200, 2)).toEqual({ idx: 40, frac: 0 })
  })

  it('never advances past the domain end, and frac is pinned to 0 there', () => {
    expect(advanceByTime(domain, TIME_MS, { idx: 90, frac: 0 }, 10_000, 1)).toEqual({ idx: 100, frac: 0 })
  })

  it('is idempotent (no movement) for a non-positive delta', () => {
    expect(advanceByTime(domain, TIME_MS, { idx: 30, frac: 0.3 }, 0, 1)).toEqual({ idx: 30, frac: 0.3 })
    expect(advanceByTime(domain, TIME_MS, { idx: 30, frac: 0.3 }, -50, 1)).toEqual({ idx: 30, frac: 0.3 })
  })

  it('returns the clamped current position without a time axis', () => {
    expect(advanceByTime(domain, null, { idx: 30, frac: 0.2 }, 200, 1)).toEqual({ idx: 30, frac: 0.2 })
  })

  it('accumulates monotonically across successive small steps (typical rAF deltas) without overshoot', () => {
    let pos: PlaybackPosition = { idx: 0, frac: 0 }
    // 20 frames of ~16.7ms (~60fps) at 1x should land close to 20*16.7 = 334ms
    // of elapsed session time, i.e. between samples 33 (330ms) and 34 (340ms).
    for (let i = 0; i < 20; i++) pos = advanceByTime(domain, TIME_MS, pos, 16.7, 1)
    const elapsed = TIME_MS[pos.idx] + pos.frac * 10
    expect(elapsed).toBeCloseTo(20 * 16.7, 0)
  })
})

describe('interpolateSample', () => {
  const px = new Float64Array([0, 10, 20, NaN, 40])
  const py = new Float64Array([0, 5, 10, NaN, 20])
  const n = px.length

  it('is the exact sample at frac 0', () => {
    expect(interpolateSample(px, py, n, 1, 0)).toEqual({ x: 10, y: 5 })
  })

  it('is the linear blend at frac 0.5', () => {
    expect(interpolateSample(px, py, n, 1, 0.5)).toEqual({ x: 15, y: 7.5 })
  })

  it('is (numerically) the next sample at frac 1', () => {
    const p = interpolateSample(px, py, n, 1, 1)!
    expect(p.x).toBeCloseTo(20)
    expect(p.y).toBeCloseTo(10)
  })

  it('clamps an out-of-range frac', () => {
    expect(interpolateSample(px, py, n, 1, -1)).toEqual({ x: 10, y: 5 })
    expect(interpolateSample(px, py, n, 1, 2)).toEqual({ x: 20, y: 10 })
  })

  it('falls back to the exact sample when the NEXT sample is a NaN gap', () => {
    expect(interpolateSample(px, py, n, 2, 0.5)).toEqual({ x: 20, y: 10 })
  })

  it('is null when the sample itself is a NaN gap', () => {
    expect(interpolateSample(px, py, n, 3, 0.5)).toBeNull()
  })

  it('is null out of range (negative, >= n, or the last sample with no next)', () => {
    expect(interpolateSample(px, py, n, -1, 0.5)).toBeNull()
    expect(interpolateSample(px, py, n, n, 0.5)).toBeNull()
  })

  it('is the exact sample at the last index regardless of frac (no next to glide toward)', () => {
    expect(interpolateSample(px, py, n, 4, 0.9)).toEqual({ x: 40, y: 20 })
  })

  it('is null for a null/undefined idx', () => {
    expect(interpolateSample(px, py, n, null, 0.5)).toBeNull()
    expect(interpolateSample(px, py, n, undefined, 0.5)).toBeNull()
  })
})
