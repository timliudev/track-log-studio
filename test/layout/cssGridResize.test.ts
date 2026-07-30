import { describe, expect, it } from 'vitest'
import { clampResizeTarget, cssGridResizeTarget, type CssGridResizeOrigin } from '@/domain/layout/cssGridResize'
import { colWidthPx, type GridMetrics } from '@/domain/layout/gridGutter'

// Same desktop metrics cssGridDrag.test.ts/gridGutter.test.ts already use
// ((1224 - 12*13)/12 = 89 exactly), so grid-unit boundaries are easy to
// hand-verify and directly comparable to those already-trusted suites.
const desktopMetrics: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: 1224 }
const mobileMetrics: GridMetrics = { cols: 1, rowHeight: 24, marginX: 0, marginY: 12, containerWidthPx: 375 }

describe('clampResizeTarget', () => {
  it('leaves an already-in-bounds size untouched', () => {
    expect(clampResizeTarget(4, 6, 2, 12, 2, 3)).toEqual({ w: 4, h: 6 })
  })

  it('clamps w up to the minimum', () => {
    expect(clampResizeTarget(1, 6, 2, 12, 3, 3)).toEqual({ w: 3, h: 6 })
  })

  it('clamps h up to the minimum', () => {
    expect(clampResizeTarget(4, 1, 2, 12, 2, 5)).toEqual({ w: 4, h: 5 })
  })

  it('clamps w at the right grid edge (x + w <= cols)', () => {
    // x=8, cols=12 -> maxW=4
    expect(clampResizeTarget(20, 6, 8, 12, 2, 3)).toEqual({ w: 4, h: 6 })
  })

  it('the right-edge ceiling never drops below the minimum (defensive — should not occur for a real layout item)', () => {
    // x=11, cols=12 -> plain ceiling would be 1, but minW=3 wins.
    expect(clampResizeTarget(20, 6, 11, 12, 3, 3)).toEqual({ w: 3, h: 6 })
  })

  it('h has no upper bound — a huge growth is honoured as-is', () => {
    expect(clampResizeTarget(4, 500, 2, 12, 2, 3)).toEqual({ w: 4, h: 500 })
  })
})

describe('cssGridResizeTarget', () => {
  const origin: CssGridResizeOrigin = { x: 4, y: 10, w: 4, h: 6 }
  const colPitch = colWidthPx(desktopMetrics) + desktopMetrics.marginX // 89 + 12 = 101
  const rowPitch = desktopMetrics.rowHeight + desktopMetrics.marginY // 24 + 12 = 36
  const minW = 2
  const minH = 3

  it('zero pixel delta is a no-op (same origin size)', () => {
    expect(cssGridResizeTarget(origin, 0, 0, desktopMetrics, minW, minH, false)).toEqual({ w: 4, h: 6 })
  })

  it('exactly one column pitch grows/shrinks w by exactly one column', () => {
    expect(cssGridResizeTarget(origin, colPitch, 0, desktopMetrics, minW, minH, false)).toEqual({ w: 5, h: 6 })
    expect(cssGridResizeTarget(origin, -colPitch, 0, desktopMetrics, minW, minH, false)).toEqual({ w: 3, h: 6 })
  })

  it('exactly one row pitch grows/shrinks h by exactly one row', () => {
    expect(cssGridResizeTarget(origin, 0, rowPitch, desktopMetrics, minW, minH, false)).toEqual({ w: 4, h: 7 })
    expect(cssGridResizeTarget(origin, 0, -rowPitch, desktopMetrics, minW, minH, false)).toEqual({ w: 4, h: 5 })
  })

  it('rounds a fractional delta to the nearest whole cell', () => {
    expect(cssGridResizeTarget(origin, colPitch / 2 - 1, 0, desktopMetrics, minW, minH, false)).toEqual({ w: 4, h: 6 })
    expect(cssGridResizeTarget(origin, colPitch / 2 + 1, 0, desktopMetrics, minW, minH, false)).toEqual({ w: 5, h: 6 })
  })

  it('clamps at the minimum size when shrinking past it', () => {
    expect(cssGridResizeTarget(origin, -colPitch * 10, -rowPitch * 10, desktopMetrics, minW, minH, false)).toEqual({
      w: minW,
      h: minH,
    })
  })

  it('clamps w at the right grid edge (x + w <= cols)', () => {
    // origin.x=4, cols=12 -> maxW=8
    expect(cssGridResizeTarget(origin, colPitch * 10, 0, desktopMetrics, minW, minH, false)).toEqual({ w: 8, h: 6 })
  })

  it('has no upper clamp on h — a large downward delta is honoured as-is', () => {
    expect(cssGridResizeTarget(origin, 0, rowPitch * 50, desktopMetrics, minW, minH, false)).toEqual({ w: 4, h: 56 })
  })

  describe('B59 — mobile: horizontal delta is entirely ignored', () => {
    const mobileOrigin: CssGridResizeOrigin = { x: 0, y: 3, w: 1, h: 6 }
    const mobileRowPitch = mobileMetrics.rowHeight + mobileMetrics.marginY // 36

    it('a large horizontal jitter never changes w, even alongside a vertical move', () => {
      expect(cssGridResizeTarget(mobileOrigin, 999, mobileRowPitch, mobileMetrics, 1, 3, true)).toEqual({
        w: 1,
        h: 7,
      })
      expect(cssGridResizeTarget(mobileOrigin, -999, mobileRowPitch, mobileMetrics, 1, 3, true)).toEqual({
        w: 1,
        h: 7,
      })
    })

    it('vertical resize still works normally on mobile', () => {
      expect(cssGridResizeTarget(mobileOrigin, 0, mobileRowPitch * 2, mobileMetrics, 1, 3, true)).toEqual({
        w: 1,
        h: 8,
      })
    })

    it('the SAME non-zero horizontal delta DOES move w when mobile is false (proves the guard is the `mobile` flag, not the metrics)', () => {
      const wideMobileShapedOrigin: CssGridResizeOrigin = { x: 0, y: 3, w: 4, h: 6 }
      const wideMetrics: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: 1224 }
      const step = colWidthPx(wideMetrics) + wideMetrics.marginX
      expect(cssGridResizeTarget(wideMobileShapedOrigin, step, 0, wideMetrics, 2, 3, false)).toEqual({ w: 5, h: 6 })
    })
  })

  describe('degenerate metrics guard (container not measured yet)', () => {
    it('falls back to a zero column-delta rather than NaN/Infinity when containerWidthPx <= 0', () => {
      const unmeasured: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: 0 }
      const result = cssGridResizeTarget(origin, 500, 500, unmeasured, minW, minH, false)
      expect(Number.isFinite(result.w)).toBe(true)
      expect(Number.isFinite(result.h)).toBe(true)
      // Row math doesn't depend on containerWidthPx, so h still moves; only
      // the column axis (which DOES depend on it) is guarded to a no-op.
      expect(result.w).toBe(origin.w)
    })

    it('falls back to a zero column-delta on a negative containerWidthPx', () => {
      const negative: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: -100 }
      const result = cssGridResizeTarget(origin, 500, 0, negative, minW, minH, false)
      expect(result.w).toBe(origin.w)
    })
  })
})
