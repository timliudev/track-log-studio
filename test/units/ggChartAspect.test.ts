import { describe, it, expect } from 'vitest'
import { dataExtent, paddedAxisRange, equalAspectGrid, type GgSeries } from '@/features/analyzer/GgChart.vue'

/**
 * XY-aspect feature — the scatter chart's 1:1 axis scaling: the same data
 * span must cover the same number of pixels on X and Y, on ANY container
 * shape, and keep holding after a window/card resize (GgChart recomputes
 * `equalAspectGrid` from the CURRENT container size on every resize).
 */

function series(points: [number, number][]): GgSeries[] {
  return [{ points, color: '#000', name: 's' }]
}

describe('dataExtent', () => {
  it('finds min/max across every series on both axes', () => {
    const s: GgSeries[] = [
      { points: [[-1, 2], [3, -4]], color: '#000', name: 'a' },
      { points: [[0, 7]], color: '#000', name: 'b' },
    ]
    expect(dataExtent(s)).toEqual({ xMin: -1, xMax: 3, yMin: -4, yMax: 7 })
  })

  it('returns non-finite extents for no points (caller falls back via paddedAxisRange)', () => {
    const e = dataExtent([])
    expect(Number.isFinite(e.xMin)).toBe(false)
    expect(Number.isFinite(e.yMax)).toBe(false)
  })
})

describe('paddedAxisRange', () => {
  it('pads the span by the given fraction on both sides', () => {
    expect(paddedAxisRange(0, 100, 0.1)).toEqual({ min: -10, max: 110 })
  })

  it('handles a constant channel (min === max) with a magnitude-based pad', () => {
    const r = paddedAxisRange(50, 50, 0.1)
    expect(r.min).toBeLessThan(50)
    expect(r.max).toBeGreaterThan(50)
  })

  it('pads a constant zero channel by ±1 (not a degenerate zero-span range)', () => {
    expect(paddedAxisRange(0, 0)).toEqual({ min: -1, max: 1 })
  })

  it('falls back to 0..1 for non-finite input (no points yet)', () => {
    expect(paddedAxisRange(Infinity, -Infinity)).toEqual({ min: 0, max: 1 })
  })
})

describe('equalAspectGrid', () => {
  const chrome = { left: 48, right: 16, top: 16, bottom: 40 }

  /** Pixels-per-data-unit on each axis under the returned insets. */
  function scales(
    w: number,
    h: number,
    x: { min: number; max: number },
    y: { min: number; max: number },
  ): { sx: number; sy: number } {
    const g = equalAspectGrid(w, h, chrome, x, y)
    const plotW = w - g.left - g.right
    const plotH = h - g.top - g.bottom
    return { sx: plotW / (x.max - x.min), sy: plotH / (y.max - y.min) }
  }

  it('gives both axes the same pixels-per-data-unit on a wide container', () => {
    const { sx, sy } = scales(800, 400, { min: -2, max: 2 }, { min: -2, max: 2 })
    expect(sx).toBeCloseTo(sy, 6)
  })

  it('holds the ratio on a tall container too (letterboxes the other axis)', () => {
    const { sx, sy } = scales(300, 900, { min: 0, max: 10 }, { min: 0, max: 2 })
    expect(sx).toBeCloseTo(sy, 6)
  })

  it('keeps the ratio across a resize (recomputed per size — the resize invariant)', () => {
    const before = scales(800, 400, { min: 0, max: 4 }, { min: 0, max: 1 })
    const after = scales(500, 700, { min: 0, max: 4 }, { min: 0, max: 1 })
    expect(before.sx).toBeCloseTo(before.sy, 6)
    expect(after.sx).toBeCloseTo(after.sy, 6)
  })

  it('centres the plot: the letterboxed axis splits its spare pixels evenly', () => {
    // Equal spans on an 800x400 container: height is limiting, so the extra
    // width splits between left/right beyond the chrome.
    const g = equalAspectGrid(800, 400, chrome, { min: -1, max: 1 }, { min: -1, max: 1 })
    expect(g.left - chrome.left).toBeCloseTo(g.right - chrome.right, 6)
    expect(g.top).toBeCloseTo(chrome.top, 6)
    expect(g.bottom).toBeCloseTo(chrome.bottom, 6)
  })

  it('degrades safely on a container smaller than the chrome (no NaN / negative letterbox)', () => {
    // 60x40 is smaller than the chrome itself — the available plot area
    // floors at 1px, so the extra insets must stay finite and non-negative
    // (echarts just renders a squeezed grid, nothing throws).
    const g = equalAspectGrid(60, 40, chrome, { min: 0, max: 1 }, { min: 0, max: 1 })
    for (const v of [g.left, g.right, g.top, g.bottom]) expect(Number.isFinite(v)).toBe(true)
    expect(g.left).toBeGreaterThanOrEqual(chrome.left)
    expect(g.right).toBeGreaterThanOrEqual(chrome.right)
    expect(g.top).toBeGreaterThanOrEqual(chrome.top)
    expect(g.bottom).toBeGreaterThanOrEqual(chrome.bottom)
  })

  it('works with real series data end to end (dataExtent -> paddedAxisRange -> grid)', () => {
    const s = series([[0, 0], [10, 2], [5, 1]])
    const e = dataExtent(s)
    const x = paddedAxisRange(e.xMin, e.xMax)
    const y = paddedAxisRange(e.yMin, e.yMax)
    const g = equalAspectGrid(640, 480, chrome, x, y)
    const sx = (640 - g.left - g.right) / (x.max - x.min)
    const sy = (480 - g.top - g.bottom) / (y.max - y.min)
    expect(sx).toBeCloseTo(sy, 6)
  })
})
