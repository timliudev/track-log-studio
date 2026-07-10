import { describe, expect, it } from 'vitest'
import {
  detectGutters,
  gutterKey,
  clampGutterDeltaUnits,
  applyGutterDrag,
  colWidthPx,
  xPx,
  wPx,
  yPx,
  hPx,
  gutterRect,
  pxDeltaToColUnits,
  pxDeltaToRowUnits,
  type GridGutter,
  type GridMetrics,
} from '@/domain/layout/gridGutter'
import { STATIC_CARD_IDS, chartItemId, type DashboardLayoutItem } from '@/domain/layout/dashboardLayout'

describe('detectGutters', () => {
  it('finds a vertical gutter between two side-by-side cards of equal height', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 4, y: 0, w: 4, h: 6 },
    ]
    const gutters = detectGutters(items)
    expect(gutters).toHaveLength(1)
    expect(gutters[0]).toEqual({ orientation: 'vertical', aId: 'a', bId: 'b', edge: 4, start: 0, end: 6 })
  })

  it('finds a horizontal gutter between two stacked cards of equal width', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 6 },
      { i: 'b', x: 0, y: 6, w: 4, h: 5 },
    ]
    const gutters = detectGutters(items)
    expect(gutters).toHaveLength(1)
    expect(gutters[0]).toEqual({ orientation: 'horizontal', aId: 'a', bId: 'b', edge: 6, start: 0, end: 4 })
  })

  it('clips the shared segment to the OVERLAPPING span, not either card\'s full edge', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 10 }, // tall left column
      { i: 'b', x: 4, y: 3, w: 4, h: 4 }, // shorter right card, offset down
    ]
    const gutters = detectGutters(items)
    expect(gutters).toHaveLength(1)
    expect(gutters[0]).toMatchObject({ start: 3, end: 7 })
  })

  it('does not report a gutter for cards that only touch at a single corner', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 4, y: 4, w: 4, h: 4 }, // diagonal neighbour only
    ]
    expect(detectGutters(items)).toHaveLength(0)
  })

  it('does not report a gutter for cards that are not actually adjacent (a gap between them)', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 4 },
      { i: 'b', x: 5, y: 0, w: 4, h: 4 }, // one column of daylight between them
    ]
    expect(detectGutters(items)).toHaveLength(0)
  })

  it('reports one gutter per pair when three cards meet along one straight edge', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'left', x: 0, y: 0, w: 4, h: 10 },
      { i: 'top-right', x: 4, y: 0, w: 4, h: 4 },
      { i: 'bottom-right', x: 4, y: 4, w: 4, h: 6 },
    ]
    const gutters = detectGutters(items)
    // left|top-right, left|bottom-right (both vertical), top-right/bottom-right (horizontal)
    expect(gutters).toHaveLength(3)
    expect(gutters.filter((g) => g.orientation === 'vertical')).toHaveLength(2)
    expect(gutters.filter((g) => g.orientation === 'horizontal')).toHaveLength(1)
  })

  it('is empty for a single card or an empty layout', () => {
    expect(detectGutters([])).toHaveLength(0)
    expect(detectGutters([{ i: 'solo', x: 0, y: 0, w: 4, h: 4 }])).toHaveLength(0)
  })
})

describe('gutterKey', () => {
  it('is stable for the same orientation/pair and distinct across orientation or pair', () => {
    const v: GridGutter = { orientation: 'vertical', aId: 'a', bId: 'b', edge: 4, start: 0, end: 6 }
    const h: GridGutter = { orientation: 'horizontal', aId: 'a', bId: 'b', edge: 4, start: 0, end: 6 }
    expect(gutterKey(v)).toBe(gutterKey({ ...v }))
    expect(gutterKey(v)).not.toBe(gutterKey(h))
    expect(gutterKey(v)).not.toBe(gutterKey({ ...v, bId: 'c' }))
  })
})

describe('clampGutterDeltaUnits (#5 — only the DRAGGED side, `a`, is clamped)', () => {
  it('allows a delta that keeps a at/above its minimum', () => {
    // map minW=3 (see dashboardLayout.ts's STATIC_MIN_SIZE)
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 }
    expect(clampGutterDeltaUnits('vertical', a, 1)).toBe(1)
    expect(clampGutterDeltaUnits('vertical', a, -1)).toBe(-1)
  })

  it('clamps shrinkage so a never drops below its own minimum', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 5, h: 10 } // minW 3
    // a would drop to 5-4=1 < minW(3); max allowed negative delta is -(5-3)=-2
    expect(clampGutterDeltaUnits('vertical', a, -4)).toBe(-2)
  })

  it('handles the horizontal (row/height) axis the same way, with no upper bound', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.sectors, x: 0, y: 0, w: 4, h: 6 } // minH 3
    expect(clampGutterDeltaUnits('horizontal', a, 100)).toBe(100) // rows: no ceiling
    expect(clampGutterDeltaUnits('horizontal', a, -10)).toBe(-3) // a: 6 + delta >= 3 => delta >= -3
  })

  it('caps a VERTICAL gutter\'s growth at the grid column count when `cols` is given', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.map, x: 8, y: 0, w: 4, h: 10 } // right edge at col 12
    // a.x(8) + a.w(4) + delta <= cols(12) => delta <= 0
    expect(clampGutterDeltaUnits('vertical', a, 5, 12)).toBe(0)
    const roomy: DashboardLayoutItem = { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 10 }
    expect(clampGutterDeltaUnits('vertical', roomy, 5, 12)).toBe(5) // room for +5 (0+4+5=9<=12)
    expect(clampGutterDeltaUnits('vertical', roomy, 100, 12)).toBe(8) // clamps to fill exactly to col 12
  })

  it('is unbounded above when `cols` is omitted', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.map, x: 8, y: 0, w: 4, h: 10 }
    expect(clampGutterDeltaUnits('vertical', a, 100)).toBe(100)
  })

  it('a zero delta is always a no-op', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 3, h: 5 }
    expect(clampGutterDeltaUnits('vertical', a, 0)).toBe(0)
  })
})

describe('applyGutterDrag (#5 — resizes only the dragged side, `a`; `b` reflows via grid-layout-plus compaction, not here)', () => {
  const gutter = { orientation: 'vertical' as const, aId: 'a', bId: 'b' }

  it('grows a.w by the clamped delta and leaves b (and every other item) completely untouched', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 10 },
      { i: 'b', x: 4, y: 0, w: 4, h: 10 },
      { i: 'untouched', x: 0, y: 10, w: 8, h: 4 },
    ]
    const next = applyGutterDrag(items, gutter, 2)
    expect(next.find((it) => it.i === 'a')).toMatchObject({ x: 0, w: 6 })
    // b is byte-for-byte unchanged — no more x/w shift to "keep touching".
    expect(next.find((it) => it.i === 'b')).toEqual(items[1])
    expect(next.find((it) => it.i === 'untouched')).toEqual(items[2])
  })

  it('shrinking a leaves a gap after it (no compensating change to b) — reflow is the grid\'s job', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 10 },
      { i: 'b', x: 4, y: 0, w: 4, h: 10 },
    ]
    const next = applyGutterDrag(items, gutter, -2)
    expect(next.find((it) => it.i === 'a')).toMatchObject({ w: 2 })
    expect(next.find((it) => it.i === 'b')).toEqual(items[1])
  })

  it('is pure — returns a new array without mutating the input items', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 10 },
      { i: 'b', x: 4, y: 0, w: 4, h: 10 },
    ]
    const snapshot = JSON.parse(JSON.stringify(items))
    applyGutterDrag(items, gutter, 2)
    expect(items).toEqual(snapshot)
  })

  it('clamps the delta via clampGutterDeltaUnits before applying it (a\'s own min floor)', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 3, h: 10 }, // STATIC_CARD_IDS-less id -> DEFAULT_MIN_SIZE (minW 2)
      { i: 'b', x: 3, y: 0, w: 3, h: 10 },
    ]
    // Shrinking far past a's own floor (minW 2) clamps to exactly that floor.
    const next = applyGutterDrag(items, gutter, -100)
    expect(next.find((it) => it.i === 'a')).toMatchObject({ w: 2 })
    expect(next.find((it) => it.i === 'b')).toEqual(items[1])
  })

  it('clamps a VERTICAL gutter\'s growth at the grid column count when `cols` is passed', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 8, y: 0, w: 3, h: 10 },
      { i: 'b', x: 11, y: 0, w: 1, h: 10 },
    ]
    // a.x(8)+w(3)+delta <= 12 => delta <= 1
    const next = applyGutterDrag(items, gutter, 100, 12)
    expect(next.find((it) => it.i === 'a')).toMatchObject({ w: 4 })
  })

  it('returns the SAME array reference when the clamped delta is zero', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 2, h: 10 },
      { i: 'b', x: 2, y: 0, w: 2, h: 10 },
    ]
    // a is already at its (default) minimum width of 2 — a shrink delta clamps to 0.
    expect(applyGutterDrag(items, gutter, -1)).toBe(items)
  })

  it('is a no-op when either card id is missing from the layout', () => {
    const items: DashboardLayoutItem[] = [{ i: 'a', x: 0, y: 0, w: 4, h: 10 }]
    expect(applyGutterDrag(items, gutter, 2)).toBe(items)
  })

  it('applies the horizontal (top/bottom) case: grows/shrinks ONLY top (a), bottom (b) untouched', () => {
    const hGutter = { orientation: 'horizontal' as const, aId: 'top', bId: 'bottom' }
    const items: DashboardLayoutItem[] = [
      { i: 'top', x: 0, y: 0, w: 4, h: 6 },
      { i: 'bottom', x: 0, y: 6, w: 4, h: 6 },
    ]
    const next = applyGutterDrag(items, hGutter, -2)
    expect(next.find((it) => it.i === 'top')).toMatchObject({ y: 0, h: 4 })
    expect(next.find((it) => it.i === 'bottom')).toEqual(items[1])
  })
})

describe('pixel metrics (mirrors grid-layout-plus\'s own calcColWidth/calcPosition)', () => {
  // 12 columns, 12px margin both axes, row-height 24 — same values AnalyzerView
  // passes to <GridLayout>. Container 1224px wide -> colWidth exactly 90px:
  // (1224 - 12*13) / 12 = (1224-156)/12 = 1068/12 = 89 -> pick a width that
  // divides exactly to keep the assertions simple to hand-verify.
  const metrics: GridMetrics = { cols: 12, rowHeight: 24, marginX: 12, marginY: 12, containerWidthPx: 1224 }

  it('colWidthPx matches grid-item.vue\'s calcColWidth formula', () => {
    expect(colWidthPx(metrics)).toBeCloseTo((1224 - 12 * 13) / 12)
  })

  it('xPx/yPx/wPx/hPx place item 0 flush against the top-left margin', () => {
    expect(xPx(0, metrics)).toBeCloseTo(metrics.marginX)
    expect(yPx(0, metrics)).toBeCloseTo(metrics.marginY)
  })

  it('two touching items are separated by exactly one margin in px', () => {
    const aRight = xPx(0, metrics) + wPx(4, metrics)
    const bLeft = xPx(4, metrics)
    expect(bLeft - aRight).toBeCloseTo(metrics.marginX)
  })

  it('gutterRect fills exactly the margin gap between two touching cards', () => {
    const g: GridGutter = { orientation: 'vertical', aId: 'a', bId: 'b', edge: 4, start: 0, end: 6 }
    const rect = gutterRect(g, metrics)
    expect(rect.width).toBeCloseTo(metrics.marginX)
    expect(rect.left).toBeCloseTo(xPx(0, metrics) + wPx(4, metrics))
    expect(rect.top).toBeCloseTo(yPx(0, metrics))
    expect(rect.height).toBeCloseTo(yPx(6, metrics) - metrics.marginY - yPx(0, metrics))
  })

  it('gutterRect (horizontal) fills exactly the margin gap between two stacked cards', () => {
    const g: GridGutter = { orientation: 'horizontal', aId: 'a', bId: 'b', edge: 6, start: 0, end: 4 }
    const rect = gutterRect(g, metrics)
    expect(rect.height).toBeCloseTo(metrics.marginY)
    expect(rect.top).toBeCloseTo(yPx(0, metrics) + hPx(6, metrics))
  })

  it('pxDeltaToColUnits/pxDeltaToRowUnits round to the nearest whole grid unit', () => {
    const colStep = colWidthPx(metrics) + metrics.marginX
    expect(pxDeltaToColUnits(colStep, metrics)).toBe(1)
    expect(pxDeltaToColUnits(colStep * 2.4, metrics)).toBe(2)
    expect(pxDeltaToColUnits(-colStep, metrics)).toBe(-1)
    expect(pxDeltaToColUnits(colStep / 2 - 1, metrics)).toBe(0)

    const rowStep = metrics.rowHeight + metrics.marginY
    expect(pxDeltaToRowUnits(rowStep, metrics)).toBe(1)
    expect(pxDeltaToRowUnits(-rowStep * 1.6, metrics)).toBe(-2)
  })
})

describe('detectGutters + applyGutterDrag round-trip against a realistic layout', () => {
  it('dragging the gutter between the map and a chart in defaultLayout-shaped columns grows the map and leaves the chart untouched (#5 — reflow is the grid\'s job, not this function\'s)', () => {
    const items: DashboardLayoutItem[] = [
      { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 10 },
      { i: chartItemId(1), x: 4, y: 0, w: 4, h: 10 },
    ]
    const gutters = detectGutters(items)
    expect(gutters).toHaveLength(1)
    const next = applyGutterDrag(items, gutters[0], 1, 12)
    const map = next.find((it) => it.i === STATIC_CARD_IDS.map)!
    const chart = next.find((it) => it.i === chartItemId(1))!
    expect(map.w).toBe(5)
    expect(chart).toEqual(items[1])
  })
})
