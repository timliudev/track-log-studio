import { describe, it, expect } from 'vitest'
import { crossCorrelateOffset } from '@/domain/analysis/sessionAlign'

/** A speed profile with a couple of distinct humps so cross-correlation has real structure to lock onto (a flat/constant series has no lag-dependent signal). */
function humpProfile(n: number, dtMs: number): { timeMs: Float64Array; speedKmh: Float64Array } {
  const timeMs = new Float64Array(n)
  const speedKmh = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i * dtMs
    timeMs[i] = t
    const sec = t / 1000
    // Two gaussian-ish humps at 5s and 15s, baseline 20 km/h.
    const hump1 = 80 * Math.exp(-((sec - 5) ** 2) / 2)
    const hump2 = 60 * Math.exp(-((sec - 15) ** 2) / 4)
    speedKmh[i] = 20 + hump1 + hump2
  }
  return { timeMs, speedKmh }
}

describe('crossCorrelateOffset', () => {
  it('recovers zero lag for identical series', () => {
    const { timeMs, speedKmh } = humpProfile(200, 100)
    const result = crossCorrelateOffset(speedKmh, timeMs, speedKmh, timeMs, { maxLagMs: 3000, stepMs: 50 })
    expect(result).not.toBeNull()
    expect(result!.offsetMs).toBeCloseTo(0, 6)
    expect(result!.score).toBeGreaterThan(0.9)
  })

  it('recovers a known positive shift (other recorded later)', () => {
    const { timeMs, speedKmh } = humpProfile(200, 100)
    const shiftMs = 1200
    const otherTimeMs = new Float64Array(timeMs.length)
    for (let i = 0; i < timeMs.length; i++) otherTimeMs[i] = timeMs[i] + shiftMs
    const result = crossCorrelateOffset(speedKmh, timeMs, speedKmh, otherTimeMs, { maxLagMs: 3000, stepMs: 50 })
    expect(result).not.toBeNull()
    expect(result!.offsetMs).toBeCloseTo(-shiftMs, -2) // within a step or two
    expect(result!.score).toBeGreaterThan(0.8)
  })

  it('recovers a known negative shift (other recorded earlier)', () => {
    const { timeMs, speedKmh } = humpProfile(200, 100)
    const shiftMs = -800
    const otherTimeMs = new Float64Array(timeMs.length)
    for (let i = 0; i < timeMs.length; i++) otherTimeMs[i] = timeMs[i] + shiftMs
    const result = crossCorrelateOffset(speedKmh, timeMs, speedKmh, otherTimeMs, { maxLagMs: 3000, stepMs: 50 })
    expect(result).not.toBeNull()
    expect(result!.offsetMs).toBeCloseTo(-shiftMs, -2)
    expect(result!.score).toBeGreaterThan(0.8)
  })

  it('recovers a shift approximately under additive gaussian noise', () => {
    const { timeMs, speedKmh } = humpProfile(300, 100)
    const shiftMs = 2000
    const otherTimeMs = new Float64Array(timeMs.length)
    const otherSpeed = new Float64Array(timeMs.length)
    // simple deterministic pseudo-noise (no RNG dependency): small periodic wobble
    for (let i = 0; i < timeMs.length; i++) {
      otherTimeMs[i] = timeMs[i] + shiftMs
      otherSpeed[i] = speedKmh[i] + 3 * Math.sin(i * 0.7) + (i % 5 === 0 ? 2 : -1)
    }
    const result = crossCorrelateOffset(speedKmh, timeMs, otherSpeed, otherTimeMs, { maxLagMs: 4000, stepMs: 50 })
    expect(result).not.toBeNull()
    expect(Math.abs(result!.offsetMs - -shiftMs)).toBeLessThanOrEqual(150)
    expect(result!.score).toBeGreaterThan(0.5)
  })

  it('returns a low score for uncorrelated random-ish series', () => {
    const n = 200
    const dtMs = 100
    const timeMs = new Float64Array(n)
    const a = new Float64Array(n)
    const b = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      timeMs[i] = i * dtMs
      // Two very different frequencies, no shared structure at any lag within range.
      a[i] = 50 + 10 * Math.sin(i * 0.9)
      b[i] = 50 + 10 * Math.sin(i * 5.7 + 1.3)
    }
    const result = crossCorrelateOffset(a, timeMs, b, timeMs, { maxLagMs: 2000, stepMs: 50 })
    expect(result).not.toBeNull()
    expect(Math.abs(result!.score)).toBeLessThan(0.6)
  })

  it('returns null for empty series', () => {
    const empty = new Float64Array(0)
    const { timeMs, speedKmh } = humpProfile(50, 100)
    expect(crossCorrelateOffset(empty, empty, speedKmh, timeMs, { maxLagMs: 1000, stepMs: 50 })).toBeNull()
    expect(crossCorrelateOffset(speedKmh, timeMs, empty, empty, { maxLagMs: 1000, stepMs: 50 })).toBeNull()
  })

  it('returns null for a single-sample series', () => {
    const one = new Float64Array([10])
    const oneT = new Float64Array([0])
    const { timeMs, speedKmh } = humpProfile(50, 100)
    expect(crossCorrelateOffset(one, oneT, speedKmh, timeMs, { maxLagMs: 1000, stepMs: 50 })).toBeNull()
  })

  it('returns null for a constant (zero-variance) reference series', () => {
    const n = 100
    const timeMs = new Float64Array(n)
    const flat = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      timeMs[i] = i * 100
      flat[i] = 42
    }
    const { speedKmh, timeMs: otherT } = humpProfile(100, 100)
    expect(crossCorrelateOffset(flat, timeMs, speedKmh, otherT, { maxLagMs: 1000, stepMs: 50 })).toBeNull()
  })

  it('handles very different durations (short other series inside a long ref)', () => {
    const { timeMs, speedKmh } = humpProfile(400, 100) // 40s
    // "other" only covers the second hump, shifted +500ms.
    const shiftMs = 500
    const startIdx = 100 // t=10s
    const endIdx = 220 // t=22s
    const otherTimeMs = timeMs.slice(startIdx, endIdx).map((t) => t + shiftMs)
    const otherSpeed = speedKmh.slice(startIdx, endIdx)
    const result = crossCorrelateOffset(
      speedKmh,
      timeMs,
      new Float64Array(otherSpeed),
      new Float64Array(otherTimeMs),
      { maxLagMs: 2000, stepMs: 50 },
    )
    expect(result).not.toBeNull()
    expect(result!.offsetMs).toBeCloseTo(-shiftMs, -2)
  })

  it('returns null for invalid options (non-positive stepMs)', () => {
    const { timeMs, speedKmh } = humpProfile(50, 100)
    expect(crossCorrelateOffset(speedKmh, timeMs, speedKmh, timeMs, { maxLagMs: 1000, stepMs: 0 })).toBeNull()
  })
})
