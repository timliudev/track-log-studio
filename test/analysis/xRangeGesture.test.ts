import { describe, it, expect } from 'vitest'
import {
  blankTickLabelsOutsideData,
  clampCentreNeedleRange,
  clampRange,
  panCentreNeedleRange,
  panRange,
  pinchCentreNeedleRange,
  pinchRange,
  zoomCentreNeedleRange,
  zoomRange,
  type XRange,
} from '@/features/analyzer/xRangeGesture'

const BOUNDS: XRange = { min: 0, max: 100 }

describe('clampRange', () => {
  it('leaves an in-bounds range untouched', () => {
    expect(clampRange({ min: 20, max: 40 }, BOUNDS)).toEqual({ min: 20, max: 40 })
  })

  it('shifts a range that overflows the max, preserving span', () => {
    expect(clampRange({ min: 90, max: 110 }, BOUNDS)).toEqual({ min: 80, max: 100 })
  })

  it('shifts a range that underflows the min, preserving span', () => {
    expect(clampRange({ min: -20, max: 10 }, BOUNDS)).toEqual({ min: 0, max: 30 })
  })

  it('clamps to exactly bounds when the range is wider than bounds', () => {
    expect(clampRange({ min: -50, max: 200 }, BOUNDS)).toEqual({ min: 0, max: 100 })
  })

  it('falls back to full bounds for a degenerate (zero/negative span) range', () => {
    expect(clampRange({ min: 50, max: 50 }, BOUNDS)).toEqual({ min: 0, max: 100 })
    expect(clampRange({ min: 50, max: 10 }, BOUNDS)).toEqual({ min: 0, max: 100 })
  })

  it('returns a copy of bounds when bounds themselves are degenerate', () => {
    const degenerate: XRange = { min: 5, max: 5 }
    expect(clampRange({ min: 0, max: 10 }, degenerate)).toEqual({ min: 5, max: 5 })
  })
})

describe('panRange', () => {
  it('pans right (positive delta moves the window forward) and preserves span', () => {
    const r = panRange({ min: 20, max: 40 }, 10, BOUNDS)
    expect(r).toEqual({ min: 10, max: 30 })
  })

  it('pans left (negative delta) and preserves span', () => {
    const r = panRange({ min: 20, max: 40 }, -10, BOUNDS)
    expect(r).toEqual({ min: 30, max: 50 })
  })

  it('clamps panning past the lower bound', () => {
    const r = panRange({ min: 5, max: 25 }, 20, BOUNDS)
    expect(r).toEqual({ min: 0, max: 20 })
  })

  it('clamps panning past the upper bound', () => {
    const r = panRange({ min: 80, max: 95 }, -20, BOUNDS)
    expect(r).toEqual({ min: 85, max: 100 })
  })
})

describe('zoomRange', () => {
  it('zooms in (factor > 1) about the midpoint, halving the span', () => {
    const r = zoomRange({ min: 0, max: 100 }, 2, 50, BOUNDS)
    expect(r.max - r.min).toBeCloseTo(50)
    expect(r.min).toBeCloseTo(25)
    expect(r.max).toBeCloseTo(75)
  })

  it('zooms out (factor < 1), doubling the span, clamped to bounds', () => {
    const r = zoomRange({ min: 40, max: 60 }, 0.5, 50, BOUNDS)
    expect(r.max - r.min).toBeCloseTo(40)
    expect(r.min).toBeCloseTo(30)
    expect(r.max).toBeCloseTo(70)
  })

  it('keeps the pinch/scroll point fixed on screen when off-centre', () => {
    // about=20 within [0,40] is at t=0.5 → zooming in 2x keeps it centred in the new span.
    const r = zoomRange({ min: 0, max: 40 }, 2, 20, BOUNDS)
    expect(r.min).toBeCloseTo(10)
    expect(r.max).toBeCloseTo(30)
  })

  it('keeps an off-centre about-point at the same relative position', () => {
    // about=10 within [0,40] is at t=0.25. Zooming in 2x → new span 20,
    // so min = 10 - 0.25*20 = 5, max = 25.
    const r = zoomRange({ min: 0, max: 40 }, 2, 10, BOUNDS)
    expect(r.min).toBeCloseTo(5)
    expect(r.max).toBeCloseTo(25)
  })

  it('enforces a minimum span so pinching cannot collapse the range to zero', () => {
    const r = zoomRange({ min: 49, max: 51 }, 1000, 50, BOUNDS)
    expect(r.max - r.min).toBeGreaterThan(0)
    // Minimum span is a small fraction of the full 100-unit extent.
    expect(r.max - r.min).toBeLessThan(1)
  })

  it('does not zoom out past the full bounds', () => {
    const r = zoomRange({ min: 20, max: 80 }, 0.1, 50, BOUNDS)
    expect(r).toEqual({ min: 0, max: 100 })
  })

  it('clamps the zoomed range back into bounds when about is near an edge', () => {
    const r = zoomRange({ min: 0, max: 20 }, 0.5, 0, BOUNDS)
    // Zooming out about the left edge would push min negative; must clamp to bounds.
    expect(r.min).toBeGreaterThanOrEqual(0)
    expect(r.max).toBeLessThanOrEqual(100)
  })

  it('ignores non-finite or non-positive factors', () => {
    const range = { min: 20, max: 40 }
    expect(zoomRange(range, 0, 50, BOUNDS)).toEqual(range)
    expect(zoomRange(range, -1, 50, BOUNDS)).toEqual(range)
    expect(zoomRange(range, NaN, 50, BOUNDS)).toEqual(range)
    expect(zoomRange(range, Infinity, 50, BOUNDS)).toEqual(range)
  })
})

describe('pinchRange', () => {
  it('combines zoom about the midpoint with a translation', () => {
    const r = pinchRange({ min: 0, max: 100 }, 2, 50, 5, BOUNDS)
    // zoomRange(2, about=50) -> [25,75]; then pan by +5 -> [20,70].
    expect(r.min).toBeCloseTo(20)
    expect(r.max).toBeCloseTo(70)
  })

  it('clamps the combined result to bounds', () => {
    const r = pinchRange({ min: 0, max: 100 }, 1, 100, 50, BOUNDS)
    expect(r.min).toBeGreaterThanOrEqual(0)
    expect(r.max).toBeLessThanOrEqual(100)
    expect(r.max - r.min).toBeCloseTo(100)
  })

  it('pinch-out (zoom out) then re-clamps span to bounds', () => {
    const r = pinchRange({ min: 40, max: 60 }, 0.1, 50, 0, BOUNDS)
    expect(r).toEqual({ min: 0, max: 100 })
  })
})

describe('B68 centre-needle virtual edge padding', () => {
  it('allows a full-span view to place either endpoint under the centre needle', () => {
    expect(clampCentreNeedleRange({ min: -80, max: 20 }, BOUNDS)).toEqual({ min: -50, max: 50 })
    expect(clampCentreNeedleRange({ min: 80, max: 180 }, BOUNDS)).toEqual({ min: 50, max: 150 })
  })

  it('caps virtual padding at half the current visible span', () => {
    expect(panCentreNeedleRange({ min: 20, max: 40 }, 100, BOUNDS)).toEqual({ min: -10, max: 10 })
    expect(panCentreNeedleRange({ min: 60, max: 80 }, -100, BOUNDS)).toEqual({ min: 90, max: 110 })
  })

  it('does not allow zooming out beyond the real data span', () => {
    expect(zoomCentreNeedleRange({ min: -10, max: 10 }, 0.01, 0, BOUNDS)).toEqual({ min: -50, max: 50 })
  })

  it('preserves a virtual endpoint position when zooming in', () => {
    expect(zoomCentreNeedleRange({ min: -50, max: 50 }, 2, 0, BOUNDS)).toEqual({ min: -25, max: 25 })
  })

  it('keeps centre-mode pinch panning within the same endpoint allowance', () => {
    expect(pinchCentreNeedleRange({ min: 0, max: 20 }, 1, 10, 100, BOUNDS)).toEqual({ min: -10, max: 10 })
  })

  it('hides labels outside the real data while preserving formatted labels inside it', () => {
    expect(blankTickLabelsOutsideData([-10, 0, 25, 100, 110], ['-10', '0:00', '0:25', '1:40', '1:50'], BOUNDS))
      .toEqual(['', '0:00', '0:25', '1:40', ''])
  })
})
