/**
 * F6 stage 2 — pixel-delta -> grid-cell conversion for dragging a card under
 * the new CSS Grid dashboard renderer (CssGridGrid.vue, stage 1). Stage 1's
 * own module doc (cssGridPlacement.ts) proves algebraically — and
 * cssGridPlacement.test.ts's "CSS Grid pixel-parity with grid-layout-plus"
 * suite confirms numerically — that a CSS Grid container built via
 * `gridContainerStyle` reproduces grid-layout-plus's OWN pixel geometry
 * exactly (same `colWidth`/`left`/`top` formulas). That means the conversion
 * this module needs — "how many grid columns/rows does a pointer's pixel
 * delta correspond to" — is the SAME arithmetic gridGutter.ts's
 * `pxDeltaToColUnits`/`pxDeltaToRowUnits` already implement and already unit-
 * test (those two exist for the gutter-drag feature, which converts a mouse
 * delta into a column/row-unit delta the exact same way). Reusing them here
 * (rather than re-deriving the same formula a second time) is the "do NOT
 * reinvent" the migration's stage-2 brief asks for; this module's own job is
 * everything gridGutter.ts DOESN'T already do for a whole-card drag:
 *
 *  - Turn an ORIGIN cell (the dragged card's x/y/w before the drag started)
 *    plus a pixel delta into a candidate NEW top-left cell.
 *  - Clamp that candidate so a card can never leave the grid horizontally
 *    (x >= 0, x + w <= cols) or scroll above row 0 (y >= 0) — grid-layout-
 *    plus's own interactjs did this clamping internally; a hand-rolled CSS
 *    Grid drag has to do it explicitly instead.
 *
 * Deliberately still pure (no DOM/Vue) — the composable that drives real
 * pointer events (see useCssGridDashboardDrag.ts) measures the live container
 * width via ResizeObserver and feeds it in as `GridMetrics.containerWidthPx`,
 * mirroring gridGutter.ts's own "pure math / thin Vue wrapper" split.
 */
import { colWidthPx, pxDeltaToColUnits, pxDeltaToRowUnits, type GridMetrics } from './gridGutter'

export type { GridMetrics }

/** The dragged card's shape at the moment the drag started — only `w` matters
 *  for clamping (a card's `h` never changes size during a REORDER drag, only
 *  its position). */
export interface CssGridDragOrigin {
  x: number
  y: number
  w: number
}

/** A clamped top-left cell. */
export interface CssGridDragTarget {
  x: number
  y: number
}

/**
 * Clamp a candidate top-left cell so a `w`-wide card never leaves the grid
 * horizontally (`x` in `[0, cols - w]`, floored at 0 so a card wider than the
 * grid — shouldn't happen, but defensive — never gets a negative ceiling) and
 * never rises above row 0 (`y >= 0`; there is deliberately no upper bound —
 * CSS Grid's `grid-auto-rows` simply grows the container, same as dragging a
 * card to the very bottom of the old grid-layout-plus grid already did).
 * Pure; exported separately from {@link cssGridDragTarget} so a caller that
 * already has a raw target cell (e.g. from a test, or a future keyboard-
 * reorder affordance) can clamp it without going through pixel math at all.
 */
export function clampDragTarget(x: number, y: number, w: number, cols: number): CssGridDragTarget {
  const maxX = Math.max(0, cols - w)
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.max(0, y),
  }
}

/**
 * The dragged card's new (clamped) top-left cell, given its ORIGIN cell and
 * the pointer's total pixel delta since the drag started (an "absolute, not
 * incremental" delta — same convention useGridGutters.ts's own `onMove`
 * uses — so repeated rounding across many small moves can never drift). Falls
 * back to a zero cell-delta (rather than `NaN`/`Infinity`) when the grid's
 * own column pitch isn't positive yet — the container hasn't been measured
 * (`containerWidthPx <= 0`, a brief bootstrap window right after mount,
 * mirroring gridGutter.ts's own `pinnedCardPixelSize` null-guard) or a
 * corrupt/degenerate metrics object was passed in.
 */
export function cssGridDragTarget(
  origin: CssGridDragOrigin,
  dxPx: number,
  dyPx: number,
  m: GridMetrics,
): CssGridDragTarget {
  const colPitch = colWidthPx(m) + m.marginX
  const rowPitch = m.rowHeight + m.marginY
  const dCol = colPitch > 0 ? pxDeltaToColUnits(dxPx, m) : 0
  const dRow = rowPitch > 0 ? pxDeltaToRowUnits(dyPx, m) : 0
  return clampDragTarget(origin.x + dCol, origin.y + dRow, origin.w, m.cols)
}
