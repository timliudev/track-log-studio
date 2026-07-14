import { describe, it, expect } from 'vitest'
import type { AccelSegment } from '@/domain/analysis/accelTest'
import { fastestDistanceFromLaunch, fastestSpeedSegment, sortSegmentsByTime } from '@/domain/analysis/accelTest'

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

/** Concatenate several ramp sessions end-to-end, offsetting time/distance so
 *  the combined arrays read as one continuous recording (same helper pattern
 *  used by the "multiple launches"/"multiple runs" tests below). */
function concatSessions(
  segs: Array<{ timeMs: Float64Array; speedKmh: Float64Array; cumDistM: Float64Array }>,
): { timeMs: Float64Array; speedKmh: Float64Array; cumDistM: Float64Array } {
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
  return { timeMs, speedKmh, cumDistM }
}

describe('fastestDistanceFromLaunch', () => {
  it('times a standing start (entrySpeedKmh=0) over the set distance', () => {
    // 0 -> 200 km/h over 10s (100 samples @ 100ms) then hold at 200 for 2s.
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 200, n: 101 },
      { v0: 200, v1: 200, n: 20 },
    ])
    const results = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 100,
      entrySpeedKmh: 0,
    })
    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result.distanceM).toBeCloseTo(100, 6)
    // A standing start must be timed from (very close to) 0 km/h — NOT from
    // some near-top-speed window elsewhere in the ramp (the old floor-filter
    // bug this function replaces).
    expect(result.entrySpeedKmh).toBeCloseTo(0, 0)
    expect(result.startIdx).toBe(0)
    expect(result.timeMs).toBeGreaterThan(0)
    // A single result is trivially the fastest.
    expect(result.isFastest).toBe(true)
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
    expect(rolling).toHaveLength(1)
    expect(standing).toHaveLength(1)
    expect(rolling[0].entrySpeedKmh).toBeCloseTo(100, 0)
    // Launching from a higher speed and covering the same distance takes
    // strictly less time than a standing start on an accelerating ramp.
    expect(rolling[0].timeMs).toBeLessThan(standing[0].timeMs)
  })

  it('reports multiple launches in chronological order, with the fastest flagged (B14)', () => {
    // Three separate standing-start launches (10 traffic lights in miniature):
    // medium, slow, then fast — each separated by a return to 0. All three
    // should come back as separate segments, in the order they occurred, with
    // only the fast one flagged isFastest.
    const mediumLaunch = rampSession([{ v0: 0, v1: 100, n: 81 }], 100)
    const gap1 = rampSession([{ v0: 100, v1: 0, n: 20 }], 100)
    const slowLaunch = rampSession([{ v0: 0, v1: 60, n: 121 }], 100) // gentle ramp
    const gap2 = rampSession([{ v0: 60, v1: 0, n: 20 }], 100)
    const fastLaunch = rampSession([{ v0: 0, v1: 200, n: 61 }], 100) // steep ramp

    const { timeMs, speedKmh, cumDistM } = concatSessions([
      mediumLaunch,
      gap1,
      slowLaunch,
      gap2,
      fastLaunch,
    ])

    const results = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      entrySpeedKmh: 0,
    })

    expect(results).toHaveLength(3)
    // Chronological order: startIdx strictly increasing.
    expect(results[0].startIdx).toBeLessThan(results[1].startIdx)
    expect(results[1].startIdx).toBeLessThan(results[2].startIdx)
    // Exactly one flagged fastest, and it's the third (steep-ramp) launch.
    const fastestFlags = results.map((r) => r.isFastest)
    expect(fastestFlags.filter(Boolean)).toHaveLength(1)
    expect(results[2].isFastest).toBe(true)
    expect(results[0].isFastest).toBe(false)
    expect(results[1].isFastest).toBe(false)
    // The flagged one is indeed the minimum timeMs among the three.
    const minTime = Math.min(...results.map((r) => r.timeMs))
    expect(results[2].timeMs).toBe(minTime)
  })

  it('returns an empty array when speed never launches through entrySpeedKmh', () => {
    // A session that never exceeds 50 km/h can't produce a launch through 100.
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 50, n: 60 }])
    const results = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      entrySpeedKmh: 100,
    })
    expect(results).toEqual([])
  })

  it('returns an empty array when a launch exists but no launch covers the requested distance', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 50, n: 10 }])
    const results = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 1_000_000,
      entrySpeedKmh: 0,
    })
    expect(results).toEqual([])
  })

  it('returns an empty array for a very short log (< 2 samples)', () => {
    const results = fastestDistanceFromLaunch(
      new Float64Array([0]),
      new Float64Array([0]),
      new Float64Array([0]),
      { distanceM: 100, entrySpeedKmh: 0 },
    )
    expect(results).toEqual([])
  })

  it('returns an empty array for non-positive distanceM', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 100, n: 20 }])
    expect(
      fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, { distanceM: 0, entrySpeedKmh: 0 }),
    ).toEqual([])
    expect(
      fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, { distanceM: -5, entrySpeedKmh: 0 }),
    ).toEqual([])
  })

  it('returns an empty array for a non-finite entrySpeedKmh', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 100, n: 20 }])
    expect(
      fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, { distanceM: 50, entrySpeedKmh: NaN }),
    ).toEqual([])
  })

  it('skips NaN samples without throwing and still finds a valid launch', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 200, n: 101 },
      { v0: 200, v1: 200, n: 20 },
    ])
    // Inject a NaN speed sample mid-ramp — should not break the scan.
    speedKmh[50] = NaN
    const results = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 50,
      entrySpeedKmh: 0,
    })
    expect(results.length).toBeGreaterThan(0)
  })

  // B53: a real log showed a "faster" 100m segment ending at a LOWER speed
  // than a "slower" one covering the same distance — this looked like a bug
  // (wrong end-speed sample / phantom rolling start) but is actually a real,
  // physically valid shape: launch hard, peak mid-window, brake for a corner
  // before the distance mark resolves. `peakSpeedKmh` exists so the UI can
  // show that shape instead of just the (correct but misleading-on-its-own)
  // entry/exit pair.
  it('reports peakSpeedKmh above exitSpeedKmh when the run peaks then brakes before the mark (B53)', () => {
    // Standing start, hard accel 0 -> 120 km/h, then heavy braking down to
    // 40 km/h — the 100m mark falls during the braking phase, exactly like
    // the real-log "faster time, lower end speed" case.
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 120, n: 41 }, // hard launch
      { v0: 120, v1: 40, n: 41 }, // braking for a corner
      { v0: 40, v1: 40, n: 20 }, // hold, so the search has room to resolve
    ])
    const results = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 100,
      entrySpeedKmh: 0,
    })
    expect(results).toHaveLength(1)
    const result = results[0]
    // The distance/time/exit-speed themselves are correct — the run really
    // did resolve mid-braking, well below its peak.
    expect(result.exitSpeedKmh).toBeLessThan(result.peakSpeedKmh)
    // The peak is the genuine ~120 km/h high point reached before braking
    // started, not merely the entry or exit speed.
    expect(result.peakSpeedKmh).toBeCloseTo(120, 0)
  })

  it('a hard-peak-then-brake run can legitimately be FASTER over the same distance than a lower, steadier run, despite ending slower (B53)', () => {
    // Run A: hard launch to 150, then heavy braking down to 30 — the 100m
    // mark falls after the braking has already resolved (into the
    // steady-30 hold), so it reaches the mark quickly (strong early
    // acceleration) but ends at a low speed.
    const runA = rampSession([
      { v0: 0, v1: 150, n: 21 },
      { v0: 150, v1: 30, n: 21 },
      { v0: 30, v1: 30, n: 20 },
    ])
    const gap = rampSession([{ v0: 30, v1: 0, n: 10 }], 100)
    // Run B: gentle, steady launch that never exceeds 70 km/h — slower to
    // cover the same 100m, but ends at a higher speed than Run A.
    const runB = rampSession([
      { v0: 0, v1: 70, n: 101 },
      { v0: 70, v1: 70, n: 20 },
    ])
    const { timeMs, speedKmh, cumDistM } = concatSessions([runA, gap, runB])

    const results = fastestDistanceFromLaunch(cumDistM, timeMs, speedKmh, {
      distanceM: 100,
      entrySpeedKmh: 0,
    })
    expect(results).toHaveLength(2)
    const [a, b] = results
    // Run A is faster (lower timeMs) yet ends at a lower speed than Run B —
    // the exact "faster but slower-looking" shape B53 flagged as suspicious.
    expect(a.timeMs).toBeLessThan(b.timeMs)
    expect(a.exitSpeedKmh).toBeLessThan(b.exitSpeedKmh)
    // peakSpeedKmh is what actually explains it: Run A got much faster than
    // Run B at some point, it just braked off before the mark.
    expect(a.peakSpeedKmh).toBeGreaterThan(b.peakSpeedKmh)
    expect(a.isFastest).toBe(true)
  })
})

describe('fastestSpeedSegment', () => {
  it('times a clean 0->100 km/h ramp', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([
      { v0: 0, v1: 100, n: 51 }, // 5s ramp @ 100ms steps
      { v0: 100, v1: 100, n: 5 },
    ])
    const results = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(results).toHaveLength(1)
    const result = results[0]
    expect(result.timeMs).toBeCloseTo(5000, -1) // ~5000ms, allow interpolation slack
    expect(result.entrySpeedKmh).toBeCloseTo(0, 0)
    expect(result.exitSpeedKmh).toBeCloseTo(100, 0)
    expect(result.isFastest).toBe(true)
    // A clean monotonic ramp's peak is (very close to) its exit speed —
    // no mid-window overshoot to report.
    expect(result.peakSpeedKmh).toBeCloseTo(result.exitSpeedKmh, 0)
  })

  it('reports multiple 0->100 runs in chronological order, with the fastest flagged (B14)', () => {
    const slow = rampSession([{ v0: 0, v1: 100, n: 81 }], 100) // 8s
    const decel1 = rampSession([{ v0: 100, v1: 0, n: 21 }], 100)
    const medium = rampSession([{ v0: 0, v1: 100, n: 61 }], 100) // 6s
    const decel2 = rampSession([{ v0: 100, v1: 0, n: 21 }], 100)
    const fast = rampSession([{ v0: 0, v1: 100, n: 41 }], 100) // 4s

    const { timeMs, speedKmh, cumDistM } = concatSessions([slow, decel1, medium, decel2, fast])

    const results = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })

    expect(results).toHaveLength(3)
    // Chronological order.
    expect(results[0].startIdx).toBeLessThan(results[1].startIdx)
    expect(results[1].startIdx).toBeLessThan(results[2].startIdx)
    // Roughly 8s, 6s, 4s in that order.
    expect(results[0].timeMs).toBeGreaterThan(results[1].timeMs)
    expect(results[1].timeMs).toBeGreaterThan(results[2].timeMs)
    // Only the last (fastest, ~4s) run is flagged.
    expect(results.map((r) => r.isFastest)).toEqual([false, false, true])
  })

  it('returns an empty array when the target speed is never reached', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 50, n: 20 }])
    const results = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(results).toEqual([])
  })

  it('returns an empty array when toKmh <= fromKmh', () => {
    const { timeMs, speedKmh, cumDistM } = rampSession([{ v0: 0, v1: 100, n: 20 }])
    expect(fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 50, toKmh: 50 })).toEqual([])
    expect(fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 80, toKmh: 20 })).toEqual([])
  })

  it('returns an empty array for a very short log (< 2 samples)', () => {
    const results = fastestSpeedSegment(
      new Float64Array([0]),
      new Float64Array([0]),
      new Float64Array([0]),
      { fromKmh: 0, toKmh: 100 },
    )
    expect(results).toEqual([])
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
    const results = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(results).toHaveLength(1)
    // Should resolve at the ramp's own crossing, not be dragged out by noise.
    expect(results[0].endIdx).toBeLessThanOrEqual(ramp.speedKmh.length)
    expect(results[0].isFastest).toBe(true)
  })

  it('handles a no-match short log gracefully (NaN/invalid samples)', () => {
    const timeMs = new Float64Array([0, 100, 200, 300])
    const speedKmh = new Float64Array([0, NaN, NaN, 10])
    const cumDistM = new Float64Array([0, 1, 2, 3])
    const results = fastestSpeedSegment(timeMs, speedKmh, cumDistM, { fromKmh: 0, toKmh: 100 })
    expect(results).toEqual([])
  })
})

// B48: the panel displays results fastest-to-slowest; the search functions
// above stay chronological (asserted above), so the UI applies this separate
// sort on top.
describe('sortSegmentsByTime (B48)', () => {
  function seg(startIdx: number, timeMs: number, isFastest = false): AccelSegment {
    return {
      startIdx,
      endIdx: startIdx + 1,
      timeMs,
      distanceM: 100,
      entrySpeedKmh: 0,
      exitSpeedKmh: 100,
      peakSpeedKmh: 100,
      isFastest,
    }
  }

  it('sorts ascending by timeMs, fastest first', () => {
    const chronological = [seg(0, 8000), seg(10, 4000, true), seg(20, 6000)]
    const sorted = sortSegmentsByTime(chronological)
    expect(sorted.map((s) => s.startIdx)).toEqual([10, 20, 0])
    expect(sorted[0].isFastest).toBe(true)
  })

  it('does not mutate the input array', () => {
    const chronological = [seg(0, 8000), seg(10, 4000, true)]
    const copy = [...chronological]
    sortSegmentsByTime(chronological)
    expect(chronological).toEqual(copy)
  })

  it('is stable for equal timeMs values (keeps chronological order among ties)', () => {
    const chronological = [seg(0, 5000), seg(10, 5000), seg(20, 5000)]
    const sorted = sortSegmentsByTime(chronological)
    expect(sorted.map((s) => s.startIdx)).toEqual([0, 10, 20])
  })

  it('returns an empty array unchanged', () => {
    expect(sortSegmentsByTime([])).toEqual([])
  })
})
