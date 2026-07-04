import { describe, it, expect } from 'vitest'
import { buildMergeOverlay } from '@/domain/analysis/mergePreview'

describe('buildMergeOverlay', () => {
  it('returns null when either series has fewer than 2 samples', () => {
    expect(buildMergeOverlay([1], [0], [1, 2], [0, 100], { offsetMs: 0 })).toBeNull()
    expect(buildMergeOverlay([1, 2], [0, 100], [1], [0], { offsetMs: 0 })).toBeNull()
  })

  it('returns null when a speed/time pair has mismatched lengths', () => {
    expect(buildMergeOverlay([1, 2, 3], [0, 100], [1, 2], [0, 100], { offsetMs: 0 })).toBeNull()
    expect(buildMergeOverlay([1, 2], [0, 100], [1, 2, 3], [0, 100], { offsetMs: 0 })).toBeNull()
  })

  it('returns null for a non-positive maxPoints', () => {
    const t = [0, 100, 200]
    const s = [1, 2, 3]
    expect(buildMergeOverlay(s, t, s, t, { offsetMs: 0, maxPoints: 1 })).toBeNull()
    expect(buildMergeOverlay(s, t, s, t, { offsetMs: 0, maxPoints: 0 })).toBeNull()
  })

  it('overlays two identical series at offset 0 — grid matches both exactly', () => {
    const timeMs = [0, 1000, 2000, 3000, 4000]
    const speed = [10, 20, 30, 40, 50]
    const result = buildMergeOverlay(speed, timeMs, speed, timeMs, { offsetMs: 0, maxPoints: 5 })
    expect(result).not.toBeNull()
    expect(result!.timeS).toEqual([0, 1, 2, 3, 4])
    expect(result!.base).toEqual([10, 20, 30, 40, 50])
    expect(result!.gps).toEqual([10, 20, 30, 40, 50])
  })

  it('shifts the GPS trace by offsetMs relative to the (unmoving) base trace', () => {
    // base: speed = 10 + t/1000 (t in ms) sampled 0..4000ms
    const baseTime = [0, 1000, 2000, 3000, 4000]
    const baseSpeed = baseTime.map((t) => 10 + t / 1000)
    // gps records the SAME physical ramp, but its own clock reads +2000ms at
    // the same instant (i.e. gps is "ahead") — gpsTime = baseTime + 2000, and
    // gps's speed-as-a-function-of-its-own-clock is 10 + (gpsTime-2000)/1000.
    const gpsTime = baseTime.map((t) => t + 2000)
    const gpsSpeed = gpsTime.map((t) => 10 + (t - 2000) / 1000)

    // offsetMs=-2000 (added to gps's clock) should line gps back up with base.
    const result = buildMergeOverlay(baseSpeed, baseTime, gpsSpeed, gpsTime, {
      offsetMs: -2000,
      maxPoints: 100,
    })
    expect(result).not.toBeNull()
    // At every point where both are defined, base and gps should now match
    // (same physical ramp, now on the same clock).
    for (let i = 0; i < result!.timeS.length; i++) {
      if (result!.base[i] == null || result!.gps[i] == null) continue
      expect(result!.gps[i]).toBeCloseTo(result!.base[i]!, 5)
    }
  })

  it('produces null (gap) samples outside a series own covered range', () => {
    const baseTime = [0, 1000, 2000]
    const baseSpeed = [10, 20, 30]
    const gpsTime = [5000, 6000, 7000] // far away, no overlap with base at offset 0
    const gpsSpeed = [1, 2, 3]
    const result = buildMergeOverlay(baseSpeed, baseTime, gpsSpeed, gpsTime, { offsetMs: 0, maxPoints: 8 })
    expect(result).not.toBeNull()
    // The grid spans the union [0, 7000] — early grid points have no gps
    // sample, late grid points have no base sample.
    expect(result!.gps[0]).toBeNull()
    expect(result!.base[result!.base.length - 1]).toBeNull()
  })

  it('decimates the shared grid to at most maxPoints', () => {
    const n = 5000
    const timeMs = Array.from({ length: n }, (_, i) => i * 10)
    const speed = Array.from({ length: n }, (_, i) => i)
    const result = buildMergeOverlay(speed, timeMs, speed, timeMs, { offsetMs: 0, maxPoints: 50 })
    expect(result).not.toBeNull()
    expect(result!.timeS.length).toBe(50)
    expect(result!.base.length).toBe(50)
    expect(result!.gps.length).toBe(50)
  })

  it('defaults maxPoints to 400 when omitted', () => {
    const n = 5000
    const timeMs = Array.from({ length: n }, (_, i) => i * 10)
    const speed = Array.from({ length: n }, (_, i) => i)
    const result = buildMergeOverlay(speed, timeMs, speed, timeMs, { offsetMs: 0 })
    expect(result).not.toBeNull()
    expect(result!.timeS.length).toBe(400)
  })

  it('timeS starts at 0 and is monotonically increasing', () => {
    const timeMs = [100, 500, 900]
    const speed = [1, 2, 3]
    const result = buildMergeOverlay(speed, timeMs, speed, timeMs, { offsetMs: 0, maxPoints: 10 })
    expect(result).not.toBeNull()
    expect(result!.timeS[0]).toBe(0)
    for (let i = 1; i < result!.timeS.length; i++) {
      expect(result!.timeS[i]).toBeGreaterThan(result!.timeS[i - 1])
    }
  })
})
