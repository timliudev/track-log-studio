import { describe, it, expect } from 'vitest'
import {
  blankTickLabelsOutsideData,
  clampCentreNeedleRange,
  clampRange,
  panCentreNeedleRange,
  panRange,
  pinchCentreNeedleRange,
  pinchRange,
  rubberBandPanRange,
  rubberBandSpringTarget,
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

// B117 stage 4 — rubber-banded pan.
describe('rubberBandPanRange', () => {
  it('behaves exactly like panRange while fully in-bounds (no overshoot to resist)', () => {
    const rubberBanded = rubberBandPanRange({ min: 20, max: 40 }, 10, BOUNDS)
    const plain = panRange({ min: 20, max: 40 }, 10, BOUNDS)
    expect(rubberBanded).toEqual(plain)
  })

  it('creeps PAST the lower bound instead of hard-clamping to it', () => {
    // Same gesture as clampRange's own "shifts a range that underflows the
    // min" test above (panRange({min:-20,max:10}) hard-clamps to min:0) —
    // rubber-banding must go slightly NEGATIVE instead of snapping to 0.
    const r = rubberBandPanRange({ min: 0, max: 30 }, 20, BOUNDS)
    expect(r.min).toBeLessThan(0)
    expect(r.max - r.min).toBeCloseTo(30, 6) // span preserved
  })

  it('creeps PAST the upper bound instead of hard-clamping to it', () => {
    const r = rubberBandPanRange({ min: 80, max: 95 }, -20, BOUNDS)
    expect(r.max).toBeGreaterThan(100)
    expect(r.max - r.min).toBeCloseTo(15, 6)
  })

  it('resists monotonically: a bigger raw overshoot creeps further but always less than the raw amount', () => {
    const small = rubberBandPanRange({ min: 0, max: 20 }, 10, BOUNDS) // 10 past the lower bound
    const large = rubberBandPanRange({ min: 0, max: 20 }, 200, BOUNDS) // 200 past
    const smallOvershoot = -small.min
    const largeOvershoot = -large.min
    expect(smallOvershoot).toBeGreaterThan(0)
    expect(largeOvershoot).toBeGreaterThan(smallOvershoot)
    expect(largeOvershoot).toBeLessThan(200) // always less than the raw drag distance
  })

  it('never lets the resisted edge reach a full extra bounds-span past the true boundary', () => {
    const r = rubberBandPanRange({ min: 0, max: 20 }, 100_000, BOUNDS)
    expect(-r.min).toBeLessThan(BOUNDS.max - BOUNDS.min)
  })

  it('falls back to the plain clamp for a degenerate bounds span', () => {
    const degenerate: XRange = { min: 5, max: 5 }
    expect(rubberBandPanRange({ min: 0, max: 10 }, 3, degenerate)).toEqual({ min: 5, max: 5 })
  })

  it('falls back to the plain clamp when the range span already covers all of bounds', () => {
    expect(rubberBandPanRange({ min: -50, max: 200 }, 10, BOUNDS)).toEqual({ min: 0, max: 100 })
  })

  it('respects a custom coefficient the same way rubberBand() itself does (looser = creeps further for the same overshoot)', () => {
    const tight = rubberBandPanRange({ min: 0, max: 20 }, 30, BOUNDS, 0.2)
    const loose = rubberBandPanRange({ min: 0, max: 20 }, 30, BOUNDS, 0.8)
    expect(-loose.min).toBeGreaterThan(-tight.min)
  })
})

describe('rubberBandSpringTarget', () => {
  it('is exactly clampRange — the true, non-resisted bound to spring back to', () => {
    const cases: XRange[] = [
      { min: -30, max: 10 },
      { min: 90, max: 130 },
      { min: 20, max: 40 },
    ]
    for (const range of cases) {
      expect(rubberBandSpringTarget(range, BOUNDS)).toEqual(clampRange(range, BOUNDS))
    }
  })

  it('clamps a live rubber-banded (out-of-bounds) range back to the true edge', () => {
    const overshot = rubberBandPanRange({ min: 0, max: 20 }, 50, BOUNDS) // creeps below 0
    expect(overshot.min).toBeLessThan(0)
    const target = rubberBandSpringTarget(overshot, BOUNDS)
    expect(target).toEqual({ min: 0, max: 20 })
  })
})
