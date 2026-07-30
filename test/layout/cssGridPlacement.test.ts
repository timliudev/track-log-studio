import { describe, expect, it } from 'vitest'
import {
  gridLineSpan,
  itemGridPlacement,
  gridContainerStyle,
  type CssGridContainerMetrics,
} from '@/domain/layout/cssGridPlacement'
import { colWidthPx, wPx, xPx, yPx, hPx, type GridMetrics } from '@/domain/layout/gridGutter'
import type { DashboardLayoutItem } from '@/domain/layout/dashboardLayout'

describe('gridLineSpan', () => {
  it('converts a 0-based start/size pair to a 1-based CSS grid line/span string', () => {
    expect(gridLineSpan(0, 1)).toBe('1 / span 1')
    expect(gridLineSpan(4, 4)).toBe('5 / span 4')
    expect(gridLineSpan(8, 4)).toBe('9 / span 4')
  })

  it('floors span at 1 for a zero/negative size (defensive — should not occur for a real layout item)', () => {
    expect(gridLineSpan(2, 0)).toBe('3 / span 1')
    expect(gridLineSpan(2, -3)).toBe('3 / span 1')
  })
})

describe('itemGridPlacement', () => {
  it('maps x/y/w/h to gridColumn/gridRow', () => {
    const item: DashboardLayoutItem = { i: 'map', x: 0, y: 0, w: 4, h: 12 }
    expect(itemGridPlacement(item)).toEqual({ gridColumn: '1 / span 4', gridRow: '1 / span 12' })
  })

  it('maps a non-origin item correctly', () => {
    const item: DashboardLayoutItem = { i: 'chart-1', x: 8, y: 10, w: 4, h: 14 }
    expect(itemGridPlacement(item)).toEqual({ gridColumn: '9 / span 4', gridRow: '11 / span 14' })
  })

  it('handles the mobile single-column case (x:0, w:1) exactly like any other placement', () => {
    const item: DashboardLayoutItem = { i: 'sectors', x: 0, y: 33, w: 1, h: 20 }
    expect(itemGridPlacement(item)).toEqual({ gridColumn: '1 / span 1', gridRow: '34 / span 20' })
  })

  it('ignores extra fields on a richer item shape (structural typing)', () => {
    const decorated = { i: 'x', x: 1, y: 2, w: 3, h: 4, isDraggable: true }
    expect(itemGridPlacement(decorated)).toEqual({ gridColumn: '2 / span 3', gridRow: '3 / span 4' })
  })
})

describe('gridContainerStyle', () => {
  it('builds the grid-template-columns/auto-rows/gap/padding style object', () => {
    const m: CssGridContainerMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12 }
    expect(gridContainerStyle(m)).toEqual({
      display: 'grid',
      gridTemplateColumns: 'repeat(12, 1fr)',
      gridAutoRows: '24px',
      gap: '12px 12px',
      padding: '12px 12px',
    })
  })

  it('floors cols at 1 (mobile / degenerate input) rather than emitting repeat(0, 1fr)', () => {
    const m: CssGridContainerMetrics = { cols: 1, rowHeight: 24, marginX: 0, marginY: 12 }
    expect(gridContainerStyle(m).gridTemplateColumns).toBe('repeat(1, 1fr)')
    const zeroCols: CssGridContainerMetrics = { cols: 0, rowHeight: 24, marginX: 0, marginY: 12 }
    expect(gridContainerStyle(zeroCols).gridTemplateColumns).toBe('repeat(1, 1fr)')
  })

  it('independently varies marginX vs marginY in gap/padding (they need not match)', () => {
    const m: CssGridContainerMetrics = { cols: 4, rowHeight: 30, marginX: 5, marginY: 20 }
    expect(gridContainerStyle(m)).toEqual({
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gridAutoRows: '30px',
      gap: '20px 5px',
      padding: '20px 5px',
    })
  })
})

/**
 * Pixel-parity check — see cssGridPlacement.ts's module doc for the algebraic
 * derivation of why a CSS Grid container with `padding: marginY marginX` +
 * `gap: marginY marginX` reproduces grid-layout-plus's own pixel math
 * (gridGutter.ts's `xPx`/`yPx`/`wPx`/`hPx`) exactly. This test verifies that
 * derivation numerically for several (containerWidth, cols, margin, item)
 * combinations by re-deriving the CSS-Grid box model in plain arithmetic
 * (no DOM/layout engine involved — jsdom/happy-dom can't compute real grid
 * track sizes) and comparing it against gridGutter.ts's existing formulas,
 * which are ALREADY trusted (used in production for the gutter-drag overlay).
 */
describe('CSS Grid pixel-parity with grid-layout-plus (gridGutter.ts)', () => {
  function cssGridBox(
    containerWidthPx: number,
    m: CssGridContainerMetrics,
    item: Pick<DashboardLayoutItem, 'x' | 'y' | 'w' | 'h'>,
  ): { left: number; top: number; width: number; height: number } {
    const available = containerWidthPx - 2 * m.marginX
    const trackWidth = (available - (m.cols - 1) * m.marginX) / m.cols
    const left = m.marginX + item.x * (trackWidth + m.marginX)
    const width = item.w * trackWidth + (item.w - 1) * m.marginX
    const top = m.marginY + item.y * (m.rowHeight + m.marginY)
    const height = item.h * m.rowHeight + (item.h - 1) * m.marginY
    return { left, top, width, height }
  }

  const cases: { containerWidthPx: number; cols: number; marginX: number; marginY: number; rowHeight: number }[] = [
    { containerWidthPx: 1280, cols: 12, marginX: 12, marginY: 12, rowHeight: 24 },
    { containerWidthPx: 1920, cols: 12, marginX: 12, marginY: 12, rowHeight: 24 },
    { containerWidthPx: 375, cols: 1, marginX: 0, marginY: 12, rowHeight: 24 },
  ]

  const items: DashboardLayoutItem[] = [
    { i: 'a', x: 0, y: 0, w: 4, h: 12 },
    { i: 'b', x: 4, y: 7, w: 4, h: 15 },
    { i: 'c', x: 8, y: 10, w: 4, h: 14 },
  ]

  for (const c of cases) {
    for (const item of items) {
      // Mobile items (cols:1) only make sense at x:0,w:1 — skip the wider
      // desktop-shaped items for the mobile case (mirrors mobileLayout()'s
      // own output shape, see dashboardLayout.ts).
      if (c.cols === 1 && item.w !== 1) continue
      it(`matches gridGutter.ts's xPx/yPx/wPx/hPx for container=${c.containerWidthPx}px cols=${c.cols} item=${item.i}`, () => {
        const gm: GridMetrics = {
          cols: c.cols,
          rowHeight: c.rowHeight,
          marginX: c.marginX,
          marginY: c.marginY,
          containerWidthPx: c.containerWidthPx,
        }
        const box = cssGridBox(c.containerWidthPx, c, item)
        expect(box.left).toBeCloseTo(xPx(item.x, gm), 10)
        expect(box.width).toBeCloseTo(wPx(item.w, gm), 10)
        expect(box.top).toBeCloseTo(yPx(item.y, gm), 10)
        expect(box.height).toBeCloseTo(hPx(item.h, gm), 10)
        // Sanity: colWidthPx itself matches the CSS Grid track width.
        const available = c.containerWidthPx - 2 * c.marginX
        const trackWidth = (available - (c.cols - 1) * c.marginX) / c.cols
        expect(trackWidth).toBeCloseTo(colWidthPx(gm), 10)
      })
    }
  }
})
