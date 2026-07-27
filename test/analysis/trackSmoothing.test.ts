import { describe, it, expect } from 'vitest'
import {
  smoothTrackRange,
  MAX_SEGMENTS_PER_SPAN,
  MAX_RUN_OUTPUT_POINTS,
} from '@/domain/analysis/trackSmoothing'

describe('smoothTrackRange — amount <= 0 (忠實呈現 passthrough)', () => {
  it('returns the EXACT original values, unchanged', () => {
    const px = Float64Array.from([0, 1, 2, 3, 4])
    const py = Float64Array.from([0, 2, 1, 3, 0])
    const result = smoothTrackRange(px, py, 0, 4, 0)
    expect(Array.from(result.x)).toEqual([0, 1, 2, 3, 4])
    expect(Array.from(result.y)).toEqual([0, 2, 1, 3, 0])
  })

  it('is a zero-copy VIEW onto the input buffers (bit-identical, no allocation)', () => {
    const px = Float64Array.from([0, 1, 2, 3, 4])
    const py = Float64Array.from([0, 2, 1, 3, 0])
    const result = smoothTrackRange(px, py, 1, 3, 0)
    // subarray() shares the same underlying ArrayBuffer as the source.
    expect(result.x.buffer).toBe(px.buffer)
    expect(result.y.buffer).toBe(py.buffer)
    expect(Array.from(result.x)).toEqual([1, 2, 3])
  })

  it('treats a negative or non-finite amount as 0 (clamped, never crashes)', () => {
    const px = Float64Array.from([0, 1, 2])
    const py = Float64Array.from([0, 1, 2])
    expect(Array.from(smoothTrackRange(px, py, 0, 2, -5).x)).toEqual([0, 1, 2])
    expect(Array.from(smoothTrackRange(px, py, 0, 2, NaN).x)).toEqual([0, 1, 2])
  })

  it('an empty range (hi < lo) yields empty output regardless of amount', () => {
    const px = Float64Array.from([0, 1, 2])
    const py = Float64Array.from([0, 1, 2])
    expect(smoothTrackRange(px, py, 2, 1, 0).x.length).toBe(0)
    expect(smoothTrackRange(px, py, 2, 1, 1).x.length).toBe(0)
  })
})

describe('smoothTrackRange — short runs (nothing to spline)', () => {
  it('a lone valid sample between gaps passes through unchanged', () => {
    const px = Float64Array.from([NaN, 5, NaN])
    const py = Float64Array.from([NaN, 6, NaN])
    const result = smoothTrackRange(px, py, 0, 2, 1)
    expect(Array.from(result.x)).toEqual([5])
    expect(Array.from(result.y)).toEqual([6])
  })

  it('a 2-point run (one edge, nothing to spline) passes through unchanged', () => {
    const px = Float64Array.from([1, 2])
    const py = Float64Array.from([1, 2])
    const result = smoothTrackRange(px, py, 0, 1, 1)
    expect(Array.from(result.x)).toEqual([1, 2])
    expect(Array.from(result.y)).toEqual([1, 2])
  })
})

describe('smoothTrackRange — NaN gap preservation', () => {
  it('splits at NaN into independently-smoothed runs, one NaN marker between them', () => {
    // Two 4-point runs separated by a gap at index 4.
    const px = Float64Array.from([0, 1, 2, 3, NaN, 10, 11, 12, 13])
    const py = Float64Array.from([0, 0, 0, 0, NaN, 0, 0, 0, 0])
    const result = smoothTrackRange(px, py, 0, 8, 0.5)
    // Exactly one NaN in the whole output, marking the single break.
    const nanCount = Array.from(result.x).filter((v) => Number.isNaN(v)).length
    expect(nanCount).toBe(1)
    // Nothing before the NaN is NaN, nothing after it is NaN either (i.e. the
    // gap is represented exactly once, not smeared across several samples).
    const nanIdx = Array.from(result.x).findIndex((v) => Number.isNaN(v))
    expect(Number.isNaN(result.x[nanIdx - 1])).toBe(false)
    expect(Number.isNaN(result.x[nanIdx + 1])).toBe(false)
    // First point of the whole output is the first run's own first sample,
    // last point is the second run's own last sample (endpoint fidelity).
    expect(result.x[0]).toBe(0)
    expect(result.y[0]).toBe(0)
    expect(result.x[result.x.length - 1]).toBe(13)
  })

  it('never smooths across a gap even with maximum amount', () => {
    // A run ending at (3,0) and a second run starting at (10, 100) — if the
    // spline ever bridged the gap, some interpolated y would land strictly
    // between 0 and 100 immediately adjacent to the break. It must not.
    const px = Float64Array.from([0, 1, 2, 3, NaN, 10, 11, 12, 13])
    const py = Float64Array.from([0, 0, 0, 0, NaN, 100, 100, 100, 100])
    const result = smoothTrackRange(px, py, 0, 8, 1)
    const ys = Array.from(result.y)
    // Every finite y is either close to the first run's own level (0) or the
    // second run's own level (100) — nothing in between.
    for (const y of ys) {
      if (Number.isNaN(y)) continue
      // Floating-point spline arithmetic on a collinear run may drift by an
      // ULP or so, but never anywhere NEAR the gap — nothing should land
      // even close to the midpoint (50) between the two runs' own levels.
      expect(Math.abs(y - 0) < 1e-6 || Math.abs(y - 100) < 1e-6).toBe(true)
    }
  })

  it('a leading/trailing all-NaN span produces no output for that span', () => {
    const px = Float64Array.from([NaN, NaN, 0, 1, 2, 3])
    const py = Float64Array.from([NaN, NaN, 0, 0, 0, 0])
    const result = smoothTrackRange(px, py, 0, 5, 0.5)
    expect(Number.isNaN(result.x[0])).toBe(false)
    expect(result.x[0]).toBe(0)
  })

  it('an all-gap range yields empty output', () => {
    const px = Float64Array.from([NaN, NaN, NaN])
    const py = Float64Array.from([NaN, NaN, NaN])
    const result = smoothTrackRange(px, py, 0, 2, 1)
    expect(result.x.length).toBe(0)
  })
})

describe('smoothTrackRange — straight/monotone lines stay straight', () => {
  it('collinear evenly-spaced points remain exactly collinear after smoothing', () => {
    const n = 6
    const px = Float64Array.from({ length: n }, (_, i) => i * 2)
    const py = Float64Array.from({ length: n }, (_, i) => i * 2) // y = x
    const result = smoothTrackRange(px, py, 0, n - 1, 1)
    for (let i = 0; i < result.x.length; i++) {
      // On the line y = x.
      expect(result.y[i]).toBeCloseTo(result.x[i], 9)
    }
  })

  it('x stays monotonically increasing along a monotone-x run', () => {
    const n = 8
    const px = Float64Array.from({ length: n }, (_, i) => i * i * 0.3) // uneven spacing
    const py = Float64Array.from({ length: n }, (_, i) => Math.sin(i))
    const result = smoothTrackRange(px, py, 0, n - 1, 1)
    for (let i = 1; i < result.x.length; i++) {
      expect(result.x[i]).toBeGreaterThanOrEqual(result.x[i - 1])
    }
  })

  it('the smoothed curve passes exactly through every original sample', () => {
    // For segments = 4 (amount 0.5), the s=0 sample of every span is exactly
    // t=0 -> the span's own start point (proven by the Catmull-Rom formula),
    // and the very last output point is appended as the run's own last point.
    const px = Float64Array.from([0, 3, 5, 9, 12])
    const py = Float64Array.from([0, 1, -2, 4, 1])
    const result = smoothTrackRange(px, py, 0, 4, 0.5)
    const segments = 4 // round(0.5 * MAX_SEGMENTS_PER_SPAN) = 4
    for (let i = 0; i < px.length - 1; i++) {
      const w = i * segments
      expect(result.x[w]).toBeCloseTo(px[i], 9)
      expect(result.y[w]).toBeCloseTo(py[i], 9)
    }
    expect(result.x[result.x.length - 1]).toBeCloseTo(px[px.length - 1], 9)
    expect(result.y[result.y.length - 1]).toBeCloseTo(py[py.length - 1], 9)
  })
})

describe('smoothTrackRange — known 4-point case against hand-computed values', () => {
  // Points: (0,0) -> (1,0) -> (1,1) -> (2,1) — a symmetric unit "L" bend
  // (point-symmetric about the midpoint of the middle edge, (1, 0.5)).
  // amount = 0.5 -> segmentsForAmount = round(0.5 * 8) = 4, so the middle
  // span (edge (1,0)->(1,1), i.e. i=1 of 3 spans) is evaluated at local
  // t = 0, 0.25, 0.5, 0.75 — output indices 4..7 (spans*segments = 3*4 = 12
  // total interior points + 1 final point = 13).
  //
  // Hand-derived via the standard centripetal Catmull-Rom two-stage blend
  // (all three knot spacings equal 1, since every edge here has length 1):
  //   t=0    -> exactly p1 = (1, 0)
  //   t=0.25 -> (1.046875, 0.203125)
  //   t=0.5  -> (1.0, 0.5)             (forced by the configuration's point
  //                                     symmetry about (1, 0.5))
  const px = Float64Array.from([0, 1, 1, 2])
  const py = Float64Array.from([0, 0, 1, 1])

  it('matches the hand-computed points on the middle span', () => {
    const result = smoothTrackRange(px, py, 0, 3, 0.5)
    expect(result.x.length).toBe(13) // 3 spans * 4 segments + 1
    // Index 4 = span i=1, s=0 -> t=0 -> exactly p1.
    expect(result.x[4]).toBeCloseTo(1, 9)
    expect(result.y[4]).toBeCloseTo(0, 9)
    // Index 5 = span i=1, s=1 -> t=0.25.
    expect(result.x[5]).toBeCloseTo(1.046875, 9)
    expect(result.y[5]).toBeCloseTo(0.203125, 9)
    // Index 6 = span i=1, s=2 -> t=0.5.
    expect(result.x[6]).toBeCloseTo(1.0, 9)
    expect(result.y[6]).toBeCloseTo(0.5, 9)
  })

  it('the whole run starts and ends exactly on the original endpoints', () => {
    const result = smoothTrackRange(px, py, 0, 3, 0.5)
    expect(result.x[0]).toBeCloseTo(0, 9)
    expect(result.y[0]).toBeCloseTo(0, 9)
    expect(result.x[result.x.length - 1]).toBeCloseTo(2, 9)
    expect(result.y[result.y.length - 1]).toBeCloseTo(1, 9)
  })
})

describe('smoothTrackRange — amount -> subdivision mapping', () => {
  it('any amount > 0 yields at least 2 segments/span (visible rounding, no dead zone)', () => {
    const px = Float64Array.from([0, 1, 2, 3])
    const py = Float64Array.from([0, 0, 0, 0])
    // A tiny amount should still subdivide (>= 2 points/span), not collapse
    // back to the 1-segment/span "no-op" shape.
    const result = smoothTrackRange(px, py, 0, 3, 0.01)
    const spans = 3
    expect(result.x.length).toBeGreaterThanOrEqual(spans * 2 + 1)
  })

  it('amount = 1 yields MAX_SEGMENTS_PER_SPAN segments per span', () => {
    const px = Float64Array.from([0, 1, 2, 3])
    const py = Float64Array.from([0, 0, 0, 0])
    const result = smoothTrackRange(px, py, 0, 3, 1)
    const spans = 3
    expect(result.x.length).toBe(spans * MAX_SEGMENTS_PER_SPAN + 1)
  })

  it('amount > 1 is clamped to the amount=1 mapping', () => {
    const px = Float64Array.from([0, 1, 2, 3])
    const py = Float64Array.from([0, 0, 0, 0])
    const result = smoothTrackRange(px, py, 0, 3, 5)
    const spans = 3
    expect(result.x.length).toBe(spans * MAX_SEGMENTS_PER_SPAN + 1)
  })
})

describe('smoothTrackRange — subdivision cap on a long run', () => {
  it('reduces segments/span so total output never exceeds MAX_RUN_OUTPUT_POINTS', () => {
    // spans = 2500, amount = 1 (would-be 8 segments/span -> 20001 points,
    // 1 over the cap) -> reduced to 7 segments/span -> 17501 points.
    const n = 2501
    const px = Float64Array.from({ length: n }, (_, i) => i)
    const py = new Float64Array(n) // flat line, only the point COUNT matters here
    const result = smoothTrackRange(px, py, 0, n - 1, 1)
    const spans = n - 1
    expect(result.x.length).toBeLessThanOrEqual(MAX_RUN_OUTPUT_POINTS)
    expect(result.x.length).toBe(spans * 7 + 1)
  })
})
