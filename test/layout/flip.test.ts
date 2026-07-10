import { describe, expect, it } from 'vitest'
import {
  computeFlipInvert,
  isFlipNoop,
  flipTransformCss,
  PIN_FLIP_DURATION_MS,
  PIN_FLIP_EASING,
  type FlipRect,
} from '@/domain/layout/flip'

describe('computeFlipInvert', () => {
  it('is a no-op transform when before and after are identical', () => {
    const rect: FlipRect = { left: 100, top: 50, width: 200, height: 80 }
    expect(computeFlipInvert(rect, rect)).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1 })
  })

  it('computes a pure translate when only position changed (same size)', () => {
    const before: FlipRect = { left: 0, top: 400, width: 300, height: 150 }
    const after: FlipRect = { left: 0, top: 0, width: 300, height: 150 }
    // Pinning: card moves UP from y=400 to y=0 — invert should translate it
    // back DOWN by 400px so it visually starts where it used to be.
    expect(computeFlipInvert(before, after)).toEqual({ dx: 0, dy: 400, sx: 1, sy: 1 })
  })

  it('computes a scale when only size changed (same position)', () => {
    const before: FlipRect = { left: 0, top: 0, width: 400, height: 200 }
    const after: FlipRect = { left: 0, top: 0, width: 200, height: 100 }
    expect(computeFlipInvert(before, after)).toEqual({ dx: 0, dy: 0, sx: 2, sy: 2 })
  })

  it('combines translate and scale for a move that also resizes (grid slot -> pinned anchor)', () => {
    const before: FlipRect = { left: 40, top: 900, width: 380, height: 220 } // grid slot
    const after: FlipRect = { left: 200, top: 0, width: 560, height: 300 } // pinned anchor
    const t = computeFlipInvert(before, after)
    expect(t.dx).toBeCloseTo(40 - 200)
    expect(t.dy).toBeCloseTo(900 - 0)
    expect(t.sx).toBeCloseTo(380 / 560)
    expect(t.sy).toBeCloseTo(220 / 300)
  })

  it('falls back to scale 1 rather than dividing by zero when `after` has collapsed to a zero dimension', () => {
    const before: FlipRect = { left: 0, top: 0, width: 300, height: 150 }
    const after: FlipRect = { left: 0, top: 0, width: 0, height: 0 }
    const t = computeFlipInvert(before, after)
    expect(t.sx).toBe(1)
    expect(t.sy).toBe(1)
    expect(Number.isFinite(t.sx)).toBe(true)
    expect(Number.isFinite(t.sy)).toBe(true)
  })
})

describe('isFlipNoop', () => {
  it('is true for an exact identity transform', () => {
    expect(isFlipNoop({ dx: 0, dy: 0, sx: 1, sy: 1 })).toBe(true)
  })

  it('is true for a sub-pixel/sub-percent transform (rounding noise)', () => {
    expect(isFlipNoop({ dx: 0.2, dy: -0.3, sx: 1.001, sy: 0.998 })).toBe(true)
  })

  it('is false once translation exceeds the epsilon', () => {
    expect(isFlipNoop({ dx: 1, dy: 0, sx: 1, sy: 1 })).toBe(false)
  })

  it('is false once scale deviates from 1 beyond the epsilon', () => {
    expect(isFlipNoop({ dx: 0, dy: 0, sx: 1.05, sy: 1 })).toBe(false)
  })

  it('respects a custom epsilon', () => {
    expect(isFlipNoop({ dx: 2, dy: 0, sx: 1, sy: 1 }, 5)).toBe(true)
    expect(isFlipNoop({ dx: 2, dy: 0, sx: 1, sy: 1 }, 1)).toBe(false)
  })
})

describe('flipTransformCss', () => {
  it('renders translate + scale in the expected CSS function order', () => {
    expect(flipTransformCss({ dx: 10, dy: -5, sx: 1.5, sy: 0.5 })).toBe('translate(10px, -5px) scale(1.5, 0.5)')
  })

  it('round-trips computeFlipInvert -> flipTransformCss into a well-formed transform string', () => {
    const before: FlipRect = { left: 40, top: 900, width: 380, height: 220 }
    const after: FlipRect = { left: 200, top: 0, width: 560, height: 300 }
    const css = flipTransformCss(computeFlipInvert(before, after))
    expect(css).toMatch(/^translate\(-?\d+(\.\d+)?px, -?\d+(\.\d+)?px\) scale\(\d+(\.\d+)?, \d+(\.\d+)?\)$/)
  })
})

describe('shared animation tuning constants', () => {
  it('exposes a single duration/easing pair for callers to reuse', () => {
    expect(PIN_FLIP_DURATION_MS).toBeGreaterThan(0)
    expect(PIN_FLIP_EASING).toMatch(/^cubic-bezier\(/)
  })
})
