import { describe, it, expect } from 'vitest'
import {
  dataExtent,
  paddedAxisRange,
  squareAxisRanges,
  squareGridBox,
  type GgSeries,
} from '@/features/analyzer/GgChart.vue'

/**
 * XY-aspect feature (#6) — the scatter chart's 1:1 axis scaling: the plotted
 * grid box must be a LITERAL SQUARE (equal pixel width AND height — not just
 * equal pixels-per-data-unit, which an earlier version got wrong: it padded
 * only the grid INSETS to equalise scale, leaving the outer box itself
 * however-shaped the data spans happened to produce — a wide sliver instead
 * of a square whenever the two channels' spans differed a lot, which is
 * exactly the "Y軸被拍扁" bug report this fix addresses), on ANY container
 * shape, and this must keep holding after a window/card resize (GgChart
 * recomputes both `squareAxisRanges` and `squareGridBox` from the CURRENT
 * container size on every resize).
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

describe('squareAxisRanges', () => {
  it('widens the smaller-span axis to match the larger, centred on its own midpoint', () => {
    const { xRange, yRange } = squareAxisRanges({ min: 0, max: 8000 }, { min: 0, max: 200 })
    expect(xRange).toEqual({ min: 0, max: 8000 }) // larger span: untouched
    expect(yRange.max - yRange.min).toBeCloseTo(8000, 6) // matched to the larger span
    expect((yRange.min + yRange.max) / 2).toBeCloseTo(100, 6) // still centred on the original data
  })

  it('is a no-op when both axes already have the same span', () => {
    const { xRange, yRange } = squareAxisRanges({ min: -2, max: 2 }, { min: -2, max: 2 })
    expect(xRange).toEqual({ min: -2, max: 2 })
    expect(yRange).toEqual({ min: -2, max: 2 })
  })

  it('picks whichever axis has the larger span regardless of which is X or Y', () => {
    const { xRange, yRange } = squareAxisRanges({ min: 10, max: 12 }, { min: -50, max: 50 })
    expect(yRange).toEqual({ min: -50, max: 50 }) // larger span: untouched
    expect(xRange.max - xRange.min).toBeCloseTo(100, 6)
    expect((xRange.min + xRange.max) / 2).toBeCloseTo(11, 6)
  })
})

describe('squareGridBox', () => {
  const chrome = { left: 48, right: 16, top: 16, bottom: 40 }

  it('produces a LITERAL square (equal pixel width and height) on a wide container', () => {
    const g = squareGridBox(800, 400, chrome)
    expect(g.width).toBeCloseTo(g.height, 6)
  })

  it('produces a literal square on a tall container too', () => {
    const g = squareGridBox(300, 900, chrome)
    expect(g.width).toBeCloseTo(g.height, 6)
  })

  it('sizes the square to the SMALLER available dimension', () => {
    // availW = 800-48-16=736, availH = 400-16-40=344 — height is limiting.
    const g = squareGridBox(800, 400, chrome)
    expect(g.height).toBeCloseTo(344, 6)
    expect(g.width).toBeCloseTo(344, 6)
  })

  it('keeps the ratio across a resize (recomputed per size — the resize invariant)', () => {
    const before = squareGridBox(800, 400, chrome)
    const after = squareGridBox(500, 700, chrome)
    expect(before.width).toBeCloseTo(before.height, 6)
    expect(after.width).toBeCloseTo(after.height, 6)
  })

  it('centres the square: the constrained dimension splits its spare pixels evenly', () => {
    // Wide container: height is limiting, so the extra width splits between
    // left/right beyond the chrome; top stays flush with the chrome.
    const g = squareGridBox(800, 400, chrome)
    const availW = 800 - chrome.left - chrome.right
    const extraW = availW - g.width
    expect(g.left - chrome.left).toBeCloseTo(extraW / 2, 6)
    expect(g.top).toBeCloseTo(chrome.top, 6)
  })

  it('degrades safely on a container smaller than the chrome (no NaN / negative size)', () => {
    // 60x40 is smaller than the chrome itself — the available plot area
    // floors at 1px, so the square side must stay finite and positive
    // (echarts just renders a squeezed grid, nothing throws).
    const g = squareGridBox(60, 40, chrome)
    expect(Number.isFinite(g.left)).toBe(true)
    expect(Number.isFinite(g.top)).toBe(true)
    expect(g.width).toBeGreaterThan(0)
    expect(g.height).toBeGreaterThan(0)
  })

  it('works with real series data end to end (dataExtent -> paddedAxisRange -> squareAxisRanges -> square grid)', () => {
    const s = series([[0, 0], [10, 2], [5, 1]])
    const e = dataExtent(s)
    const x = paddedAxisRange(e.xMin, e.xMax)
    const y = paddedAxisRange(e.yMin, e.yMax)
    const { xRange, yRange } = squareAxisRanges(x, y)
    expect(xRange.max - xRange.min).toBeCloseTo(yRange.max - yRange.min, 6)
    const g = squareGridBox(640, 480, chrome)
    expect(g.width).toBeCloseTo(g.height, 6)
  })
})

describe('#6 regression — a symmetric circle stays a square/round shape, not a squashed line', () => {
  it('a wide-container 1:1 plot of x,y both -1..1 gets a literal square box (not a horizontal sliver)', () => {
    const chrome = { left: 64, right: 16, top: 16, bottom: 56 }
    const { xRange, yRange } = squareAxisRanges({ min: -1, max: 1 }, { min: -1, max: 1 })
    expect(xRange.max - xRange.min).toBeCloseTo(yRange.max - yRange.min, 6)
    // A very wide, short dashboard-card-like container.
    const g = squareGridBox(900, 220, chrome)
    expect(g.width).toBeCloseTo(g.height, 6)
    // The square must actually use most of the constrained (height) dimension
    // — not collapse to a sliver like the old grid-inset-only letterbox did
    // for disparate ranges.
    expect(g.height).toBeGreaterThan(100)
  })

  it('a disparate-range pair (e.g. RPM vs speed) still yields a square box, not a squashed axis', () => {
    const chrome = { left: 64, right: 16, top: 16, bottom: 56 }
    const raw = squareAxisRanges({ min: 0, max: 8000 }, { min: 0, max: 200 })
    const g = squareGridBox(700, 300, chrome)
    // The box itself is square...
    expect(g.width).toBeCloseTo(g.height, 6)
    // ...and BOTH axes now cover the same numeric span, so pixels-per-unit
    // is identical on X and Y (the actual root cause of the "Y軸被拍扁" bug:
    // the old implementation kept Y's tiny original span but only equalised
    // grid INSETS, producing a ~15px sliver instead of a square).
    expect(raw.xRange.max - raw.xRange.min).toBeCloseTo(raw.yRange.max - raw.yRange.min, 6)
  })
})
