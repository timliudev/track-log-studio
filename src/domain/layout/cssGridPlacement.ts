/**
 * F6 stage 1 — pure geometry mapping from a {@link DashboardLayoutItem}'s
 * grid-UNIT `x`/`y`/`w`/`h` into native CSS Grid placement (`grid-column`/
 * `grid-row`), used by `CssGridGrid.vue` instead of grid-layout-plus's
 * `position: absolute` + `transform: translate3d` math.
 *
 * Why this migration: `position: sticky` never applies to an absolutely
 * positioned element (grid-layout-plus's own layout model), which is exactly
 * why the dashboard's "pin a card so it stays visible while scrolling"
 * feature had to fake it with a `<Teleport>` into a separate sticky
 * container — visibly yanking the card out of its slot, which the user
 * rejected outright. CSS Grid's explicit `grid-column`/`grid-row` placement
 * keeps every card an ordinary IN-FLOW grid item, so `position: sticky` works
 * natively and a pinned card can stick exactly where it already sits.
 *
 * Pixel-parity with grid-layout-plus (see gridGutter.ts's `xPx`/`yPx`/`wPx`/
 * `hPx`, which encode that library's own `calcColWidth`/`calcPosition` math):
 * grid-layout-plus computes, for a container of width `containerWidthPx`,
 * `cols` columns and `[marginX, marginY]` margins —
 *
 *   colWidth = (containerWidthPx - marginX*(cols+1)) / cols
 *   left(x)  = colWidth*x + (x+1)*marginX
 *   width(w) = colWidth*w + (w-1)*marginX
 *
 * i.e. `marginX`/`marginY` are baked in as BOTH the inter-card gutter AND the
 * grid's own outer inset (see dashboardLayout.ts's `GRID_MARGIN` doc). A
 * plain CSS Grid reproduces this pixel-for-pixel by giving the CONTAINER
 * `padding: marginY marginX` and `gap: marginY marginX`, with
 * `grid-template-columns: repeat(cols, 1fr)` and `grid-auto-rows:
 * rowHeightpx` — the algebra:
 *
 *   available   = containerWidthPx - 2*marginX                (padding both sides)
 *   trackWidth  = (available - (cols-1)*marginX) / cols        (cols-1 internal gaps)
 *               = (containerWidthPx - marginX*(cols+1)) / cols = colWidth  ✓
 *   item(w)     = trackWidth*w + (w-1)*marginX = width(w)      ✓ (w tracks + w-1 gaps)
 *   item(y).top = marginY (padding) + y*rowHeight + y*marginY
 *               = rowHeight*y + (y+1)*marginY = yPx(y, m)      ✓
 *
 * So `gridContainerStyle` below (padding+gap+auto-rows) plus
 * `itemGridPlacement`'s 1-based `grid-column`/`grid-row` spans lands every
 * card at the EXACT same pixel box grid-layout-plus would have, without
 * needing any of its absolute-positioning transform math — this is what
 * lets the two renderers "agree" per the migration's stage-1 requirement.
 *
 * Mobile (`colNum === 1`) needs no special case here: the CALLER already
 * hands this module the mobile-shaped layout (`mobileLayout()`'s `x:0,w:1`
 * items, see dashboardLayout.ts), so the same formulas just degenerate to a
 * single full-width column.
 */
import type { DashboardLayoutItem } from './dashboardLayout'

export interface CssGridPlacement {
  gridColumn: string
  gridRow: string
}

/**
 * 1-based CSS grid line/span string for a 0-based grid-unit start/size pair,
 * e.g. `gridLineSpan(4, 4)` → `"5 / span 4"` (CSS grid lines are 1-indexed;
 * `size` is floored at 1 so a corrupt/zero size never produces an invalid
 * `span 0`).
 */
export function gridLineSpan(start: number, size: number): string {
  return `${start + 1} / span ${Math.max(1, size)}`
}

/** Maps one layout item's `x/y/w/h` (grid units) to its CSS Grid placement. */
export function itemGridPlacement(
  item: Pick<DashboardLayoutItem, 'x' | 'y' | 'w' | 'h'>,
): CssGridPlacement {
  return {
    gridColumn: gridLineSpan(item.x, item.w),
    gridRow: gridLineSpan(item.y, item.h),
  }
}

/** Metrics needed to build the CSS Grid CONTAINER's own style — mirrors
 *  gridGutter.ts's `GridMetrics` shape (minus `containerWidthPx`, which pure
 *  CSS Grid never needs to measure: the browser's own track-sizing algorithm
 *  does that job natively, unlike grid-layout-plus's manual pixel math). */
export interface CssGridContainerMetrics {
  cols: number
  rowHeight: number
  marginX: number
  marginY: number
}

/** Container-level CSS (as a Vue `:style` object) reproducing
 *  grid-layout-plus's pixel geometry — see this module's doc for the
 *  algebraic derivation. `cols` is floored at 1 so mobile's single-column
 *  breakpoint (and any other degenerate input) never produces an invalid
 *  `repeat(0, 1fr)`. */
export function gridContainerStyle(m: CssGridContainerMetrics): Record<string, string> {
  const cols = Math.max(1, m.cols)
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridAutoRows: `${m.rowHeight}px`,
    gap: `${m.marginY}px ${m.marginX}px`,
    padding: `${m.marginY}px ${m.marginX}px`,
  }
}
