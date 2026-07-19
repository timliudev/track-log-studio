import { describe, expect, it } from 'vitest'
import {
  detectGutters,
  filterCollapsedGutters,
  gutterKey,
  clampGutterDeltaUnits,
  clampVerticalSplitDeltaUnits,
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
import {
  applyCollapsedHeights,
  STATIC_CARD_IDS,
  chartItemId,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'

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

describe('filterCollapsedGutters (B52 — a collapsed card\'s DISPLAY-only bottom edge is not draggable)', () => {
  const vertical: GridGutter = { orientation: 'vertical', aId: 'a', bId: 'b', edge: 4, start: 0, end: 6 }
  const horizontalFromA: GridGutter = { orientation: 'horizontal', aId: 'a', bId: 'b', edge: 6, start: 0, end: 4 }
  const horizontalFromB: GridGutter = { orientation: 'horizontal', aId: 'b', bId: 'c', edge: 12, start: 0, end: 4 }

  it('is a no-op when no ids are collapsed', () => {
    const gutters = [vertical, horizontalFromA, horizontalFromB]
    expect(filterCollapsedGutters(gutters, new Set())).toBe(gutters)
  })

  it('drops a HORIZONTAL gutter whose dragged side (aId) is collapsed', () => {
    const gutters = [vertical, horizontalFromA, horizontalFromB]
    const out = filterCollapsedGutters(gutters, new Set(['a']))
    expect(out).toEqual([vertical, horizontalFromB])
  })

  it('keeps a VERTICAL gutter on a collapsed card\'s edge — collapse only overlays height, not width', () => {
    const gutters = [vertical]
    expect(filterCollapsedGutters(gutters, new Set(['a']))).toEqual([vertical])
  })

  it('keeps a horizontal gutter whose dragged side is NOT the collapsed one (only bId is collapsed)', () => {
    const gutters = [horizontalFromA]
    // 'b' is collapsed here, but the gutter's aId is 'a' — dragging still
    // resizes 'a', which isn't collapsed, so it stays draggable.
    expect(filterCollapsedGutters(gutters, new Set(['b']))).toEqual([horizontalFromA])
  })
})

describe('clampGutterDeltaUnits (horizontal reflow)', () => {
  it('handles the horizontal (row/height) axis the same way, with no upper bound', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.sectors, x: 0, y: 0, w: 4, h: 6 } // minH 3
    expect(clampGutterDeltaUnits('horizontal', a, 100)).toBe(100) // rows: no ceiling
    expect(clampGutterDeltaUnits('horizontal', a, -10)).toBe(-3) // a: 6 + delta >= 3 => delta >= -3
  })

  it('a zero delta is always a no-op', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.sectors, x: 0, y: 0, w: 3, h: 5 }
    expect(clampGutterDeltaUnits('horizontal', a, 0)).toBe(0)
  })
})

describe('clampVerticalSplitDeltaUnits', () => {
  it('clamps both sides at their independent minimum widths', () => {
    const a: DashboardLayoutItem = { i: STATIC_CARD_IDS.map, x: 0, y: 0, w: 4, h: 6 } // minW 3
    const b: DashboardLayoutItem = { i: STATIC_CARD_IDS.gear, x: 4, y: 0, w: 4, h: 6 } // minW 3
    const items = [a, b]
    expect(clampVerticalSplitDeltaUnits(items, a, b, 100)).toBe(1)
    expect(clampVerticalSplitDeltaUnits(items, a, b, -100)).toBe(-1)
  })

  it('backs off toward zero when a partial-height split would collide with a third card', () => {
    const a: DashboardLayoutItem = { i: 'a', x: 0, y: 0, w: 4, h: 8 }
    const b: DashboardLayoutItem = { i: 'b', x: 4, y: 0, w: 4, h: 4 }
    // This card is below b but beside a's taller lower section: +2 would
    // collide, while +1 leaves the edge exactly touching.
    const third: DashboardLayoutItem = { i: 'third', x: 5, y: 4, w: 2, h: 4 }
    expect(clampVerticalSplitDeltaUnits([a, b, third], a, b, 2)).toBe(1)
  })
})

describe('applyGutterDrag (#5 — vertical gaps synchronise both sides)', () => {
  const gutter = { orientation: 'vertical' as const, aId: 'a', bId: 'b' }

  it('moves the vertical split without moving either card to another row', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 10 },
      { i: 'b', x: 4, y: 0, w: 4, h: 10 },
      { i: 'untouched', x: 0, y: 10, w: 8, h: 4 },
    ]
    const next = applyGutterDrag(items, gutter, 2)
    expect(next.find((it) => it.i === 'a')).toMatchObject({ x: 0, w: 6 })
    expect(next.find((it) => it.i === 'b')).toMatchObject({ x: 6, y: 0, w: 2, h: 10 })
    expect(next.find((it) => it.i === 'untouched')).toEqual(items[2])
  })

  it('preserves the combined width and right edge while shrinking a', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 4, h: 10 },
      { i: 'b', x: 4, y: 0, w: 4, h: 10 },
    ]
    const next = applyGutterDrag(items, gutter, -2)
    expect(next.find((it) => it.i === 'a')).toMatchObject({ w: 2 })
    const b = next.find((it) => it.i === 'b')!
    expect(b).toMatchObject({ x: 2, w: 6 })
    expect(b.x + b.w).toBe(items[1].x + items[1].w)
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

  it('clamps both split sides before applying the delta', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 0, y: 0, w: 3, h: 10 }, // STATIC_CARD_IDS-less id -> DEFAULT_MIN_SIZE (minW 2)
      { i: 'b', x: 3, y: 0, w: 3, h: 10 },
    ]
    // Shrinking far past a's floor clamps to exactly that floor; b receives
    // the released columns.
    const next = applyGutterDrag(items, gutter, -100)
    expect(next.find((it) => it.i === 'a')).toMatchObject({ w: 2 })
    expect(next.find((it) => it.i === 'b')).toMatchObject({ x: 2, w: 4 })
  })

  it('clamps growth at b\'s own minimum rather than pushing it out of the row', () => {
    const items: DashboardLayoutItem[] = [
      { i: 'a', x: 8, y: 0, w: 2, h: 10 },
      { i: 'b', x: 10, y: 0, w: 2, h: 10 },
    ]
    // b is already at its default two-column minimum, so it cannot give
    // width to a at all.
    const next = applyGutterDrag(items, gutter, 100, 12)
    expect(next).toBe(items)
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
  it('dragging the gutter between the map and a chart keeps the chart in the same row', () => {
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
    expect(chart).toMatchObject({ x: 5, y: 0, w: 3 })
  })
})

describe('B52 regression — detectGutters against applyCollapsedHeights\'s DISPLAY layout follows a collapsed card\'s reflow', () => {
  it('a gutter below a collapsed card moves up to the reflowed position, not the stale pre-collapse one', () => {
    // Single column: top (collapses), mid, bottom — stacked.
    const canonical: DashboardLayoutItem[] = [
      { i: 'top', x: 0, y: 0, w: 4, h: 8 },
      { i: 'mid', x: 0, y: 8, w: 4, h: 6 },
      { i: 'bottom', x: 0, y: 14, w: 4, h: 6 },
    ]
    // Pre-collapse: the top/mid gutter sits at y=8.
    const gutterBefore = detectGutters(canonical).find((g) => g.aId === 'top' && g.bId === 'mid')
    expect(gutterBefore?.edge).toBe(8)

    // Once 'top' collapses, AnalyzerView feeds the grid (and — this is the
    // fix — the gutter overlay) applyCollapsedHeights's DISPLAY layout, where
    // 'top' shrinks to COLLAPSED_ROWS and 'mid'/'bottom' pack up to fill the
    // reclaimed rows.
    const display = applyCollapsedHeights(canonical, new Set(['top']))
    const gutterAfter = detectGutters(display).find((g) => g.aId === 'top' && g.bId === 'mid')
    // top is now COLLAPSED_ROWS (2) tall, so the shared edge moved up to y=2 —
    // this is exactly what stayed stuck at the stale y=8 before the fix.
    expect(gutterAfter?.edge).toBe(2)

    // The mid/bottom gutter also follows mid's now-higher position.
    const midBottomAfter = detectGutters(display).find((g) => g.aId === 'mid' && g.bId === 'bottom')
    expect(midBottomAfter?.edge).toBe(8) // 2 (top) + 6 (mid) = 8, was 14 pre-collapse
  })

  it('the collapsed card\'s own bottom (DISPLAY-only) edge is excluded from the draggable set entirely', () => {
    const canonical: DashboardLayoutItem[] = [
      { i: 'top', x: 0, y: 0, w: 4, h: 8 },
      { i: 'mid', x: 0, y: 8, w: 4, h: 6 },
    ]
    const display = applyCollapsedHeights(canonical, new Set(['top']))
    const gutters = filterCollapsedGutters(detectGutters(display), new Set(['top']))
    expect(gutters.find((g) => g.aId === 'top' && g.bId === 'mid')).toBeUndefined()
  })
})
