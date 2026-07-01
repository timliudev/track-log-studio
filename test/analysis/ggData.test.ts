import { describe, it, expect } from 'vitest'
import { buildGgPoints } from '@/domain/analysis/ggData'

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
