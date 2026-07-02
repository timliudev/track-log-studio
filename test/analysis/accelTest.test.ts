import { describe, it, expect } from 'vitest'
import { fastestDistanceSegment, fastestSpeedSegment } from '@/domain/analysis/accelTest'

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

describe('fastestDistanceSegment', () => {
  it('finds the min-time 100 m window on a clean 0->100 km/h ramp', () => {
    // 0 -> 200 km/h over 10s (100 samples @ 100ms) then hold at 200 for 2s.
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 200, n: 101 },
      { v0: 200, v1: 200, n: 20 },
    ])
    const result = fastestDistanceSegment(cumDistM, timeMs, speedKmh, { distanceM: 100 })
    expect(result).not.toBeNull()
    expect(result!.distanceM).toBeCloseTo(100, 6)
    // Because speed is monotonic increasing, the fastest 100m must be found
    // at higher speed (later in the ramp), not at the very start.
    expect(result!.entrySpeedKmh).toBeGreaterThan(50)
    expect(result!.timeMs).toBeGreaterThan(0)
  })

  it('picks the faster of two constant-speed sprint sections', () => {
    // Two flat (constant-speed) plateaus separated by a slow section: a
    // 60 km/h plateau (long enough to cover 200m: 12s @ 100ms steps = 120
    // samples), a 20 km/h "traffic" dip, then a 120 km/h plateau (only needs
    // 6s = 60 samples to cover the same 200m). The fastest way to cover 200m
    // is unambiguously the 120 km/h plateau (half the time), regardless of
    // entry-speed gating.
    const slowPlateau = rampSession([{ v0: 60, v1: 60, n: 130 }], 100)
    const dip = rampSession([{ v0: 20, v1: 20, n: 20 }], 100)
    const fastPlateau = rampSession([{ v0: 120, v1: 120, n: 70 }], 100)

    const segs = [slowPlateau, dip, fastPlateau]
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

    const result = fastestDistanceSegment(cumDistM, timeMs, speedKmh, { distanceM: 200 })
    expect(result).not.toBeNull()
    // Must land inside the fast (120 km/h) plateau, not the slow one.
    const fastStartIdx = slowPlateau.speedKmh.length + dip.speedKmh.length
    expect(result!.startIdx).toBeGreaterThanOrEqual(fastStartIdx)
    expect(result!.entrySpeedKmh).toBeCloseTo(120, 0)
  })

  it('honors a rolling-start minEntrySpeedKmh gate', () => {
    // Without a gate, the fastest 50m window is naturally found near the very
    // end of a monotonic ramp (highest speed = least time for a fixed
    // distance) — so a gate requiring entry >= 150 km/h can only ever
    // restrict the candidate set further, never relax it.
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 200, n: 101 }])
    const gated = fastestDistanceSegment(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      minEntrySpeedKmh: 150,
    })
    expect(gated).not.toBeNull()
    // Gated entry speed must respect the floor.
    expect(gated!.entrySpeedKmh).toBeGreaterThanOrEqual(150)

    // An impossibly high gate (above the ramp's top speed) must find nothing.
    const impossible = fastestDistanceSegment(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      minEntrySpeedKmh: 999,
    })
    expect(impossible).toBeNull()
  })

  it('is a no-op when the gate is at/below the winning window\'s own entry speed (B1)', () => {
    // Reproduces the user-reported "changing min-entry-speed has no effect"
    // observation: on a monotonic ramp the ungated winner already enters at
    // the ramp's near-top speed, so any threshold <= that entry speed can't
    // exclude it — the result is IDENTICAL to the ungated search. This is
    // correct trap-timer semantics (the gate only ever narrows the candidate
    // set), not a bug — see the 'honors a rolling-start...' test above for
    // the case where raising the gate ABOVE the winner's entry speed does
    // change the result.
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 200, n: 101 }])
    const ungated = fastestDistanceSegment(cumDistM, timeMs, speedKmh, { distanceM: 50 })
    expect(ungated).not.toBeNull()

    // Any threshold at/below the ungated winner's entry speed must reproduce
    // the exact same window (start/end/time/distance all unchanged).
    for (const thresh of [0, ungated!.entrySpeedKmh / 2, ungated!.entrySpeedKmh]) {
      const gated = fastestDistanceSegment(cumDistM, timeMs, speedKmh, {
        distanceM: 50,
        minEntrySpeedKmh: thresh,
      })
      expect(gated).toEqual(ungated)
    }
  })

  it('returns null when no window covers the requested distance', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 50, n: 10 }])
    const result = fastestDistanceSegment(cumDistM, timeMs, speedKmh, { distanceM: 1_000_000 })
    expect(result).toBeNull()
  })

  it('returns null for a very short log (< 2 samples)', () => {
    const result = fastestDistanceSegment(
      new Float64Array([0]),
      new Float64Array([0]),
      new Float64Array([0]),
      { distanceM: 100 },
    )
    expect(result).toBeNull()
  })

  it('returns null for non-positive distanceM', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 100, n: 20 }])
    expect(fastestDistanceSegment(cumDistM, timeMs, speedKmh, { distanceM: 0 })).toBeNull()
    expect(fastestDistanceSegment(cumDistM, timeMs, speedKmh, { distanceM: -5 })).toBeNull()
  })

  it('skips NaN samples without throwing and still finds a valid window', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 200, n: 101 }])
    // Inject a NaN speed sample mid-ramp — should not break the scan.
    speedKmh[50] = NaN
    const result = fastestDistanceSegment(cumDistM, timeMs, speedKmh, { distanceM: 50 })
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
