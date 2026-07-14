import { describe, expect, it } from 'vitest'
import {
  axisRange,
  axisValues,
  computeAxisRanges,
  equalAspectBoxSize,
  fullAxisRange,
  percentile,
  robustAxisRange,
  xyzPoints,
} from '@/domain/analysis/scatter3d'

describe('xyzPoints', () => {
  it('combines aligned XY points and the third channel into finite XYZ tuples', () => {
    expect(xyzPoints({
      points: [[1, 2], [3, 4]],
      zValues: [10, 20],
    })).toEqual([[1, 2, 10], [3, 4, 20]])
  })

  it('does not fabricate a Z coordinate for a series missing the selected channel', () => {
    expect(xyzPoints({ points: [[1, 2]] })).toEqual([])
  })
})

describe('percentile', () => {
  it('interpolates linearly between the two nearest ranks', () => {
    const sorted = [0, 10, 20, 30, 40]
    expect(percentile(sorted, 50)).toBe(20)
    expect(percentile(sorted, 0)).toBe(0)
    expect(percentile(sorted, 100)).toBe(40)
    expect(percentile(sorted, 25)).toBe(10)
  })

  it('handles a single-element array', () => {
    expect(percentile([5], 50)).toBe(5)
  })

  it('clamps out-of-range percentiles to [0, 100]', () => {
    const sorted = [1, 2, 3]
    expect(percentile(sorted, -10)).toBe(1)
    expect(percentile(sorted, 110)).toBe(3)
  })
})

describe('robustAxisRange (B51)', () => {
  it('clamps to the 0.5–99.5 percentile band, excluding a lone extreme outlier', () => {
    // 200 evenly-spaced samples 0..199 plus one wild outlier at 100000 — the
    // outlier must not dominate the range the way a plain min/max would.
    const values = Array.from({ length: 200 }, (_, i) => i).concat([100000])
    const r = robustAxisRange(values)
    expect(r.max).toBeLessThan(500) // nowhere near the 100000 outlier
    expect(r.min).toBeLessThanOrEqual(0)
  })

  it('ignores non-finite samples', () => {
    const values = [1, 2, 3, 4, 5, NaN, Infinity, -Infinity]
    const r = robustAxisRange(values)
    expect(Number.isFinite(r.min)).toBe(true)
    expect(Number.isFinite(r.max)).toBe(true)
  })

  it('falls back to a padded single-value range for fewer than 2 finite samples', () => {
    expect(robustAxisRange([5])).toEqual({ min: 4.75, max: 5.25 })
  })

  it('falls back to 0..1 for no finite samples at all', () => {
    expect(robustAxisRange([])).toEqual({ min: 0, max: 1 })
    expect(robustAxisRange([NaN, Infinity])).toEqual({ min: 0, max: 1 })
  })
})

describe('fullAxisRange', () => {
  it('covers the exact min/max of every finite value, including a wild outlier', () => {
    const values = [0, 50, 100, 100000]
    const r = fullAxisRange(values)
    expect(r.max).toBeGreaterThan(100000)
    expect(r.min).toBeLessThanOrEqual(0)
  })

  it('falls back to 0..1 for no finite samples', () => {
    expect(fullAxisRange([])).toEqual({ min: 0, max: 1 })
  })
})

describe('axisRange — the include-outliers switch (B51)', () => {
  // 1000 evenly-spaced samples 0..999 plus one wild outlier at 10,000,000 —
  // large enough that the outlier's single sample falls outside the 0.5–99.5
  // percentile band (1 sample in 1001 is ~0.1%, comfortably inside the
  // excluded top 0.5%).
  const values = Array.from({ length: 1000 }, (_, i) => i).concat([10000000])

  it('robust (includeOutliers=false) clamps away the outlier', () => {
    const r = axisRange(values, false)
    expect(r.max).toBeLessThan(2000)
  })

  it('full (includeOutliers=true) keeps the outlier in range', () => {
    const r = axisRange(values, true)
    expect(r.max).toBeGreaterThan(10000000)
  })
})

describe('axisValues', () => {
  it('gathers every series aligned x/y/z, dropping points missing any axis', () => {
    const series = [
      { points: [[1, 2], [3, 4]] as [number, number][], zValues: [10, NaN] },
      { points: [[5, 6]] as [number, number][], zValues: [30] },
      { points: [[7, 8]] as [number, number][] }, // no zValues at all
    ]
    expect(axisValues(series)).toEqual({ x: [1, 5], y: [2, 6], z: [10, 30] })
  })
})

describe('computeAxisRanges', () => {
  it('computes independent ranges per axis from every series at once', () => {
    const series = [
      { points: [[0, 100], [1, 101], [2, 102]] as [number, number][], zValues: [5, 6, 7] },
    ]
    const ranges = computeAxisRanges(series, true)
    expect(ranges.x.min).toBeLessThanOrEqual(0)
    expect(ranges.x.max).toBeGreaterThanOrEqual(2)
    expect(ranges.y.min).toBeLessThanOrEqual(100)
    expect(ranges.z.max).toBeGreaterThanOrEqual(7)
  })

  it('an outlier on one axis does not affect the other axes\' ranges', () => {
    // 1000 well-behaved points on X/Y; Z is well-behaved too EXCEPT for one
    // wild outlier sample — only Z's robust/full ranges should diverge.
    const n = 1000
    const points: [number, number][] = Array.from({ length: n }, (_, i) => [i, i])
    const zValues = Array.from({ length: n }, (_, i) => i + 10)
    zValues[n - 1] = 999999999 // replace the last (otherwise unremarkable) sample
    const series = [{ points, zValues }]
    const robust = computeAxisRanges(series, false)
    const full = computeAxisRanges(series, true)
    // X/Y are well-behaved either way — robust vs full stay within a small
    // relative tolerance of each other (no real outlier to clamp away).
    expect(Math.abs(robust.x.max - full.x.max)).toBeLessThan(full.x.max * 0.2)
    // Z differs hugely between robust and full because of the outlier.
    expect(full.z.max).toBeGreaterThan(robust.z.max * 100)
  })
})

describe('equalAspectBoxSize (B50)', () => {
  it('sizes the largest-span axis to maxSize and scales the others proportionally', () => {
    const ranges = {
      x: { min: 0, max: 100 }, // span 100 (largest)
      y: { min: 0, max: 50 }, // span 50 (half)
      z: { min: -25, max: 25 }, // span 50 (half)
    }
    const box = equalAspectBoxSize(ranges, 100)
    expect(box.boxWidth).toBeCloseTo(100, 6) // x -> boxWidth
    expect(box.boxDepth).toBeCloseTo(50, 6) // y -> boxDepth
    expect(box.boxHeight).toBeCloseTo(50, 6) // z -> boxHeight
  })

  it('produces a literal cube for equal spans on all three axes', () => {
    const ranges = {
      x: { min: -1, max: 1 },
      y: { min: -1, max: 1 },
      z: { min: -1, max: 1 },
    }
    const box = equalAspectBoxSize(ranges, 100)
    expect(box.boxWidth).toBeCloseTo(box.boxHeight, 6)
    expect(box.boxWidth).toBeCloseTo(box.boxDepth, 6)
  })

  it('floors a degenerate (constant) axis span instead of collapsing it to zero', () => {
    const ranges = {
      x: { min: 0, max: 100 },
      y: { min: 5, max: 5 }, // zero span — a constant channel
      z: { min: 0, max: 50 },
    }
    const box = equalAspectBoxSize(ranges, 100)
    expect(box.boxDepth).toBeGreaterThan(0)
    expect(box.boxDepth).toBeCloseTo(5, 6) // 5% floor of maxSize=100
  })
})
