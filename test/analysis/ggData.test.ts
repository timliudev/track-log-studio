import { describe, it, expect } from 'vitest'
import {
  buildGgPoints,
  buildGgPointsWithColor,
  looksLikeForce,
  looksLikeForcePair,
} from '@/domain/analysis/ggData'

describe('buildGgPoints', () => {
  it('scales x/y by the given factor (e.g. milli-g -> g)', () => {
    const x = [1000, -500, 250]
    const y = [200, -1000, 0]
    const pts = buildGgPoints(x, y, { scale: 0.001 })
    expect(pts).toEqual([
      [1, 0.2],
      [-0.5, -1],
      [0.25, 0],
    ])
  })

  it('defaults to scale 1 when unspecified', () => {
    const pts = buildGgPoints([1, 2], [3, 4])
    expect(pts).toEqual([
      [1, 3],
      [2, 4],
    ])
  })

  it('filters out samples where either channel is non-finite', () => {
    const x = [1, NaN, 3, Infinity, 5]
    const y = [1, 2, NaN, 4, 5]
    const pts = buildGgPoints(x, y)
    expect(pts).toEqual([
      [1, 1],
      [5, 5],
    ])
  })

  it('clamps to the given [start, end) range', () => {
    const x = [0, 1, 2, 3, 4]
    const y = [0, 10, 20, 30, 40]
    const pts = buildGgPoints(x, y, { start: 1, end: 3 })
    expect(pts).toEqual([
      [1, 10],
      [2, 20],
    ])
  })

  it('clamps an out-of-bounds range to the array bounds', () => {
    const x = [0, 1, 2]
    const y = [0, 1, 2]
    const pts = buildGgPoints(x, y, { start: -5, end: 999 })
    expect(pts).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ])
  })

  it('stride-decimates to at most maxPoints and always keeps the last point', () => {
    const n = 100
    const x = Array.from({ length: n }, (_, i) => i)
    const y = Array.from({ length: n }, (_, i) => i * 2)
    const pts = buildGgPoints(x, y, { maxPoints: 10 })
    expect(pts.length).toBeLessThanOrEqual(11) // stride rounding may add 1
    expect(pts[pts.length - 1]).toEqual([99, 198])
    expect(pts[0]).toEqual([0, 0])
  })

  it('does not decimate when already under maxPoints', () => {
    const pts = buildGgPoints([1, 2, 3], [1, 2, 3], { maxPoints: 100 })
    expect(pts).toHaveLength(3)
  })

  it('returns an empty array for empty input', () => {
    expect(buildGgPoints([], [])).toEqual([])
  })
})

// Colour-axis feature — a 3rd channel's value carried alongside each [x, y]
// point (ScatterChart.vue's colour-axis picker / GgChart.vue's visualMap).
describe('buildGgPointsWithColor', () => {
  it('carries the colour channel value alongside each scaled x/y point', () => {
    const x = [1000, -500, 250]
    const y = [200, -1000, 0]
    const c = [10, 20, 30]
    const { points, colorValues } = buildGgPointsWithColor(x, y, c, { scale: 0.001 })
    expect(points).toEqual([
      [1, 0.2],
      [-0.5, -1],
      [0.25, 0],
    ])
    expect(colorValues).toEqual([10, 20, 30])
  })

  it('does NOT scale colour values (only x/y use the milli-g scale)', () => {
    const { colorValues } = buildGgPointsWithColor([1, 2], [1, 2], [1000, 2000], { scale: 0.001 })
    expect(colorValues).toEqual([1000, 2000])
  })

  it('drops a sample if x, y, OR the colour value is non-finite', () => {
    const x = [1, 2, 3, 4]
    const y = [1, 2, 3, 4]
    const c = [1, NaN, 3, Infinity]
    const { points, colorValues } = buildGgPointsWithColor(x, y, c)
    expect(points).toEqual([
      [1, 1],
      [3, 3],
    ])
    expect(colorValues).toEqual([1, 3])
  })

  it('keeps colorValues aligned with points through stride-decimation', () => {
    const n = 100
    const x = Array.from({ length: n }, (_, i) => i)
    const y = Array.from({ length: n }, (_, i) => i)
    const c = Array.from({ length: n }, (_, i) => i * 10)
    const { points, colorValues } = buildGgPointsWithColor(x, y, c, { maxPoints: 10 })
    expect(colorValues).toHaveLength(points.length)
    for (let i = 0; i < points.length; i++) expect(colorValues[i]).toBe(points[i][0] * 10)
    // Last sample always kept (same rule as buildGgPoints).
    expect(points[points.length - 1]).toEqual([99, 99])
    expect(colorValues[colorValues.length - 1]).toBe(990)
  })

  it('respects the [start, end) range for all three arrays', () => {
    const x = [0, 1, 2, 3, 4]
    const y = [0, 10, 20, 30, 40]
    const c = [0, 100, 200, 300, 400]
    const { points, colorValues } = buildGgPointsWithColor(x, y, c, { start: 1, end: 3 })
    expect(points).toEqual([
      [1, 10],
      [2, 20],
    ])
    expect(colorValues).toEqual([100, 200])
  })

  it('returns empty arrays for empty input', () => {
    expect(buildGgPointsWithColor([], [], [])).toEqual({ points: [], colorValues: [] })
  })
})

// #5 equal-aspect fix — shared "is this a force/acceleration channel" rule,
// used both for the milli-g scale (ScatterChart) and the equal-aspect
// default (analyzerStore/chartConfigs): 1:1 axis scaling only makes sense
// when both sides of an XY pair share the same physical unit/magnitude.
describe('looksLikeForce / looksLikeForcePair', () => {
  it('matches any channel name containing "force" (case-insensitive)', () => {
    expect(looksLikeForce('TC_Xforce')).toBe(true)
    expect(looksLikeForce('TC_Yforce')).toBe(true)
    expect(looksLikeForce('Some_FORCE_channel')).toBe(true)
  })

  it('does not match unrelated channel names, null, or undefined', () => {
    expect(looksLikeForce('RPM')).toBe(false)
    expect(looksLikeForce('Vehicle_Speed')).toBe(false)
    expect(looksLikeForce(null)).toBe(false)
    expect(looksLikeForce(undefined)).toBe(false)
  })

  it('looksLikeForcePair requires BOTH sides to look like force channels', () => {
    expect(looksLikeForcePair('TC_Xforce', 'TC_Yforce')).toBe(true)
    expect(looksLikeForcePair('TC_Xforce', 'RPM')).toBe(false)
    expect(looksLikeForcePair('RPM', 'Vehicle_Speed')).toBe(false)
    expect(looksLikeForcePair(null, null)).toBe(false)
  })
})
