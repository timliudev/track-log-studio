import { describe, it, expect } from 'vitest'
import { fastestDistanceFromLaunch, fastestSpeedSegment } from '@/domain/analysis/accelTest'

/**
 * Build synthetic time/distance/speed arrays for a constant-acceleration ramp
 * from `v0` to `v1` (km/h) over `n` samples spaced `dtMs` apart, followed by
 * `holdSamples` more samples at `v1` (a "hold" so a speed-window search has
 * somewhere to find its exit crossing without running off the array).
 * Distance integrates speed (trapezoid) so cumDistM stays consistent with
 * speedKmh, as real GPS-derived data would be.
 */
function rampSession(
  segments: Array<{ v0: number; v1: number; n: number }>,
  dtMs = 100,
): { timeMs: Float64Array; speedKmh: Float64Array; cumDistM: Float64Array } {
  const speeds: number[] = []
  for (const seg of segments) {
    for (let i = 0; i < seg.n; i++) {
      const t = seg.n > 1 ? i / (seg.n - 1) : 0
      speeds.push(seg.v0 + (seg.v1 - seg.v0) * t)
    }
  }
  const n = speeds.length
  const timeMs = new Float64Array(n)
  const cumDistM = new Float64Array(n)
  for (let i = 0; i < n; i++) timeMs[i] = i * dtMs
  for (let i = 1; i < n; i++) {
    // trapezoidal integration of speed (km/h -> m/s) over dtMs
    const avgKmh = (speeds[i - 1] + speeds[i]) / 2
    const avgMs = (avgKmh * 1000) / 3600
    cumDistM[i] = cumDistM[i - 1] + avgMs * (dtMs / 1000)
  }
  return { timeMs, speedKmh: new Float64Array(speeds), cumDistM }
}

describe('fastestDistanceFromLaunch', () => {
  it('times a standing start (entrySpeedKmh=0) over the set distance', () => {
    // 0 -> 200 km/h over 10s (100 samples @ 100ms) then hold at 200 for 2s.
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 200, n: 101 },
      { v0: 200, v1: 200, n: 20 },
    ])
    const result = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 100,
      entrySpeedKmh: 0,
    })
    expect(result).not.toBeNull()
    expect(result!.distanceM).toBeCloseTo(100, 6)
    // A standing start must be timed from (very close to) 0 km/h — NOT from
    // some near-top-speed window elsewhere in the ramp (the old floor-filter
    // bug this function replaces).
    expect(result!.entrySpeedKmh).toBeCloseTo(0, 0)
    expect(result!.startIdx).toBe(0)
    expect(result!.timeMs).toBeGreaterThan(0)
  })

  it('times a rolling launch at a non-zero entry speed', () => {
    // Monotonic 0 -> 200 km/h ramp: launching from 100 km/h should measure
    // the time to cover 100m starting from where speed crosses 100, not from
    // the standing start.
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 200, n: 101 },
      { v0: 200, v1: 200, n: 20 },
    ])
    const rolling = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 100,
      entrySpeedKmh: 100,
    })
    const standing = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 100,
      entrySpeedKmh: 0,
    })
    expect(rolling).not.toBeNull()
    expect(standing).not.toBeNull()
    expect(rolling!.entrySpeedKmh).toBeCloseTo(100, 0)
    // Launching from a higher speed and covering the same distance takes
    // strictly less time than a standing start on an accelerating ramp.
    expect(rolling!.timeMs).toBeLessThan(standing!.timeMs)
  })

  it('picks the fastest of multiple launches in the same session', () => {
    // Two separate standing-start launches: a slow one (long time to cover
    // 100m) and a fast one (short time), separated by a return to 0.
    const slowLaunch = rampSession([{ v0: 0, v1: 60, n: 121 }], 100) // gentle ramp
    const backToZero = rampSession([{ v0: 60, v1: 0, n: 30 }], 100)
    const fastLaunch = rampSession([{ v0: 0, v1: 200, n: 61 }], 100) // steep ramp

    const segs = [slowLaunch, backToZero, fastLaunch]
    const totalN = segs.reduce((s, x) => s + x.speedKmh.length, 0)
    const speedKmh = new Float64Array(totalN)
    const timeMs = new Float64Array(totalN)
    const cumDistM = new Float64Array(totalN)
    let offset = 0
    let tOffset = 0
    let dOffset = 0
    for (const seg of segs) {
      for (let i = 0; i < seg.speedKmh.length; i++) {
        speedKmh[offset + i] = seg.speedKmh[i]
        timeMs[offset + i] = seg.timeMs[i] + tOffset
        cumDistM[offset + i] = seg.cumDistM[i] + dOffset
      }
      offset += seg.speedKmh.length
      tOffset = timeMs[offset - 1] + 100
      dOffset = cumDistM[offset - 1]
    }

    const result = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      entrySpeedKmh: 0,
    })
    expect(result).not.toBeNull()
    // Must land inside the second (fast) launch, not the first (slow) one.
    const fastStartIdx = slowLaunch.speedKmh.length + backToZero.speedKmh.length
    expect(result!.startIdx).toBeGreaterThanOrEqual(fastStartIdx)
  })

  it('returns null when speed never launches through entrySpeedKmh', () => {
    // A session that never exceeds 50 km/h can't produce a launch through 100.
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 50, n: 60 }])
    const result = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      entrySpeedKmh: 100,
    })
    expect(result).toBeNull()
  })

  it('returns null when a launch exists but no launch covers the requested distance', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 50, n: 10 }])
    const result = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 1_000_000,
      entrySpeedKmh: 0,
    })
    expect(result).toBeNull()
  })

  it('returns null for a very short log (< 2 samples)', () => {
    const result = fastestDistanceFromLaunch(
      new Float64Array([0]),
      new Float64Array([0]),
      new Float64Array([0]),
      { distanceM: 100, entrySpeedKmh: 0 },
    )
    expect(result).toBeNull()
  })

  it('returns null for non-positive distanceM', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 100, n: 20 }])
    expect(
      fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, { distanceM: 0, entrySpeedKmh: 0 }),
    ).toBeNull()
    expect(
      fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, { distanceM: -5, entrySpeedKmh: 0 }),
    ).toBeNull()
  })

  it('returns null for a non-finite entrySpeedKmh', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 100, n: 20 }])
    expect(
      fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, { distanceM: 50, entrySpeedKmh: NaN }),
    ).toBeNull()
  })

  it('skips NaN samples without throwing and still finds a valid launch', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 200, n: 101 },
      { v0: 200, v1: 200, n: 20 },
    ])
    // Inject a NaN speed sample mid-ramp — should not break the scan.
    speedKmh[50] = NaN
    const result = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      entrySpeedKmh: 0,
    })
    expect(result).not.toBeNull()
  })
})

describe('fastestSpeedSegment', () => {
  it('times a clean 0->100 km/h ramp', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 100, n: 51 }, // 5s ramp @ 100ms steps
      { v0: 100, v1: 100, n: 5 },
    ])
    const result = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(result).not.toBeNull()
    expect(result!.timeMs).toBeCloseTo(5000, -1) // ~5000ms, allow interpolation slack
    expect(result!.entrySpeedKmh).toBeCloseTo(0, 0)
    expect(result!.exitSpeedKmh).toBeCloseTo(100, 0)
  })

  it('picks the faster of two 0->100 runs', () => {
    const slow = rampSession([{ v0: 0, v1: 100, n: 81 }], 100) // 8s
    const decel = rampSession([{ v0: 100, v1: 0, n: 21 }], 100)
    const fast = rampSession([{ v0: 0, v1: 100, n: 41 }], 100) // 4s

    const segs = [slow, decel, fast]
    const totalN = segs.reduce((s, x) => s + x.speedKmh.length, 0)
    const speedKmh = new Float64Array(totalN)
    const timeMs = new Float64Array(totalN)
    const cumDistM = new Float64Array(totalN)
    let offset = 0
    let tOffset = 0
    let dOffset = 0
    for (const seg of segs) {
      for (let i = 0; i < seg.speedKmh.length; i++) {
        speedKmh[offset + i] = seg.speedKmh[i]
        timeMs[offset + i] = seg.timeMs[i] + tOffset
        cumDistM[offset + i] = seg.cumDistM[i] + dOffset
      }
      offset += seg.speedKmh.length
      tOffset = timeMs[offset - 1] + 100
      dOffset = cumDistM[offset - 1]
    }

    const result = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(result).not.toBeNull()
    expect(result!.timeMs).toBeLessThan(4500) // the fast run, not the slow ~8s one
  })

  it('returns null when the target speed is never reached', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 50, n: 20 }])
    const result = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(result).toBeNull()
  })

  it('returns null when toKmh <= fromKmh', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 100, n: 20 }])
    expect(fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 50, toKmh: 50 })).toBeNull()
    expect(fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 80, toKmh: 20 })).toBeNull()
  })

  it('returns null for a very short log (< 2 samples)', () => {
    const result = fastestSpeedSegment(
      new Float64Array([0]),
      new Float64Array([0]),
      new Float64Array([0]),
      { fromKmh: 0, toKmh: 100 },
    )
    expect(result).toBeNull()
  })

  it('tolerates a noisy plateau near the exit threshold without over-splitting', () => {
    // Ramp 0->100, then wobble around 100 (noise) a few samples — should
    // still report ONE run, ending at the first crossing >= 100.
    const ramp = rampSession([{ v0: 0, v1: 100, n: 51 }], 100)
    const noisy = [100, 99.5, 100.3, 99.8, 100.1]
    const n = ramp.speedKmh.length + noisy.length
    const speedKmh = new Float64Array(n)
    const timeMs = new Float64Array(n)
    const cumDistM = new Float64Array(n)
    speedKmh.set(ramp.speedKmh)
    timeMs.set(ramp.timeMs)
    cumDistM.set(ramp.cumDistM)
    for (let i = 0; i < noisy.length; i++) {
      speedKmh[ramp.speedKmh.length + i] = noisy[i]
      timeMs[ramp.speedKmh.length + i] = ramp.timeMs[ramp.timeMs.length - 1] + (i + 1) * 100
      cumDistM[ramp.speedKmh.length + i] =
        ramp.cumDistM[ramp.cumDistM.length - 1] + (i + 1) * 2.7 // ~100km/h * dt
    }
    const result = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(result).not.toBeNull()
    // Should resolve at the ramp's own crossing, not be dragged out by noise.
    expect(result!.endIdx).toBeLessThanOrEqual(ramp.speedKmh.length)
  })

  it('handles a no-match short log gracefully (NaN/invalid samples)', () => {
    const timeMs = new Float64Array([0, 100, 200, 300])
    const speedKmh = new Float64Array([0, NaN, NaN, 10])
    const cumDistM = new Float64Array([0, 1, 2, 3])
    const result = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(result).toBeNull()
  })
})
