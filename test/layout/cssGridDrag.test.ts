import { describe, expect, it } from 'vitest'
import { clampDragTarget, cssGridDragTarget, type CssGridDragOrigin } from '@/domain/layout/cssGridDrag'
import { colWidthPx, type GridMetrics } from '@/domain/layout/gridGutter'

// Same desktop metrics gridGutter.test.ts's own "pixel metrics" describe
// block uses (1224 - 12*13)/12 = 89 exactly, so grid-unit boundaries are easy
// to hand-verify) — reusing the identical numbers keeps this suite's
// assertions directly comparable to the already-trusted gridGutter.test.ts.
const desktopMetrics: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: 1224 }
// Mobile: single column, no horizontal margin (see dashboardLayout.ts's
// mobileLayout / useDashboardLayout's gridMargin doc: marginX is zeroed on
// mobile, containerWidthPx is whatever the phone's viewport measures to).
const mobileMetrics: GridMetrics = { cols: 1, rowHeight: 24, marginX: 0, marginY: 12, containerWidthPx: 375 }

describe('clampDragTarget', () => {
  it('leaves an already-in-bounds cell untouched', () => {
    expect(clampDragTarget(4, 10, 4, 12)).toEqual({ x: 4, y: 10 })
  })

  it('clamps x at the left edge (cannot go negative)', () => {
    expect(clampDragTarget(-3, 5, 4, 12)).toEqual({ x: 0, y: 5 })
  })

  it('clamps x at the right edge (x + w <= cols)', () => {
    // w=4 at cols=12 -> maxX = 8
    expect(clampDragTarget(20, 5, 4, 12)).toEqual({ x: 8, y: 5 })
  })

  it('clamps y at the top edge (cannot rise above row 0) with no upper bound', () => {
    expect(clampDragTarget(0, -7, 4, 12)).toEqual({ x: 0, y: 0 })
    expect(clampDragTarget(0, 500, 4, 12)).toEqual({ x: 0, y: 500 })
  })

  it('a card exactly as wide as the grid can only ever sit at x=0', () => {
    expect(clampDragTarget(5, 0, 12, 12)).toEqual({ x: 0, y: 0 })
    expect(clampDragTarget(-5, 0, 12, 12)).toEqual({ x: 0, y: 0 })
  })

  it('defensively floors the ceiling at 0 for a card wider than the grid (should not occur for a real layout item)', () => {
    // w=14 > cols=12 -> maxX would be -2 without the Math.max(0, ...) floor.
    expect(clampDragTarget(3, 0, 14, 12)).toEqual({ x: 0, y: 0 })
  })

  it('mobile 1-column case: a w:1 card at cols:1 can only ever sit at x=0', () => {
    expect(clampDragTarget(0, 3, 1, 1)).toEqual({ x: 0, y: 3 })
    expect(clampDragTarget(1, 3, 1, 1)).toEqual({ x: 0, y: 3 })
    expect(clampDragTarget(-1, 3, 1, 1)).toEqual({ x: 0, y: 3 })
  })
})

describe('cssGridDragTarget', () => {
  const origin: CssGridDragOrigin = { x: 4, y: 10, w: 4 }
  const colPitch = colWidthPx(desktopMetrics) + desktopMetrics.marginX // 89 + 12 = 101
  const rowPitch = desktopMetrics.rowHeight + desktopMetrics.marginY // 24 + 12 = 36

  it('zero pixel delta is a no-op (same origin cell)', () => {
    expect(cssGridDragTarget(origin, 0, 0, desktopMetrics)).toEqual({ x: 4, y: 10 })
  })

  it('exactly one column pitch moves the target by exactly one column', () => {
    expect(cssGridDragTarget(origin, colPitch, 0, desktopMetrics)).toEqual({ x: 5, y: 10 })
    expect(cssGridDragTarget(origin, -colPitch, 0, desktopMetrics)).toEqual({ x: 3, y: 10 })
  })

  it('exactly one row pitch moves the target by exactly one row', () => {
    expect(cssGridDragTarget(origin, 0, rowPitch, desktopMetrics)).toEqual({ x: 4, y: 11 })
    expect(cssGridDragTarget(origin, 0, -rowPitch, desktopMetrics)).toEqual({ x: 4, y: 9 })
  })

  it('rounds a fractional delta to the nearest whole cell (just under half a pitch stays put, just over rounds)', () => {
    expect(cssGridDragTarget(origin, colPitch / 2 - 1, 0, desktopMetrics)).toEqual({ x: 4, y: 10 })
    expect(cssGridDragTarget(origin, colPitch / 2 + 1, 0, desktopMetrics)).toEqual({ x: 5, y: 10 })
    expect(cssGridDragTarget(origin, 0, rowPitch / 2 - 1, desktopMetrics)).toEqual({ x: 4, y: 10 })
    expect(cssGridDragTarget(origin, 0, rowPitch / 2 + 1, desktopMetrics)).toEqual({ x: 4, y: 11 })
  })

  it('a large delta moves several cells at once (fractional pitches rounded independently)', () => {
    expect(cssGridDragTarget(origin, colPitch * 2.4, rowPitch * -3.6, desktopMetrics)).toEqual({ x: 6, y: 6 })
  })

  it('clamps the resulting target at the left edge', () => {
    expect(cssGridDragTarget(origin, -colPitch * 10, 0, desktopMetrics)).toEqual({ x: 0, y: 10 })
  })

  it('clamps the resulting target at the right edge (x + w <= cols)', () => {
    // origin.x=4, w=4, cols=12 -> maxX=8
    expect(cssGridDragTarget(origin, colPitch * 10, 0, desktopMetrics)).toEqual({ x: 8, y: 10 })
  })

  it('clamps the resulting target at the top edge (cannot rise above row 0)', () => {
    expect(cssGridDragTarget(origin, 0, -rowPitch * 10, desktopMetrics)).toEqual({ x: 4, y: 0 })
  })

  it('has no upper row clamp — a large downward delta is honoured as-is', () => {
    expect(cssGridDragTarget(origin, 0, rowPitch * 50, desktopMetrics)).toEqual({ x: 4, y: 60 })
  })

  describe('mobile 1-column case', () => {
    const mobileOrigin: CssGridDragOrigin = { x: 0, y: 3, w: 1 }
    const mobileRowPitch = mobileMetrics.rowHeight + mobileMetrics.marginY // 36

    it('horizontal movement never changes x (cols=1, w=1 -> maxX=0 always)', () => {
      expect(cssGridDragTarget(mobileOrigin, 999, 0, mobileMetrics)).toEqual({ x: 0, y: 3 })
      expect(cssGridDragTarget(mobileOrigin, -999, 0, mobileMetrics)).toEqual({ x: 0, y: 3 })
    })

    it('vertical movement still reorders normally', () => {
      expect(cssGridDragTarget(mobileOrigin, 0, mobileRowPitch * 2, mobileMetrics)).toEqual({ x: 0, y: 5 })
      expect(cssGridDragTarget(mobileOrigin, 0, -mobileRowPitch, mobileMetrics)).toEqual({ x: 0, y: 2 })
    })

    it('clamps at row 0 on mobile too', () => {
      expect(cssGridDragTarget(mobileOrigin, 0, -mobileRowPitch * 10, mobileMetrics)).toEqual({ x: 0, y: 0 })
    })
  })

  describe('degenerate metrics guard (container not measured yet)', () => {
    it('falls back to a zero cell-delta rather than NaN/Infinity when containerWidthPx <= 0', () => {
      const unmeasured: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: 0 }
      const result = cssGridDragTarget(origin, 500, 500, unmeasured)
      expect(Number.isFinite(result.x)).toBe(true)
      expect(Number.isFinite(result.y)).toBe(true)
      // Row math doesn't depend on containerWidthPx, so it still moves; only
      // the column axis (which DOES depend on it) is guarded to a no-op.
      expect(result.x).toBe(origin.x)
    })

    it('falls back to a zero cell-delta on a negative containerWidthPx', () => {
      const negative: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: -100 }
      const result = cssGridDragTarget(origin, 500, 0, negative)
      expect(result.x).toBe(origin.x)
    })
  })
})
