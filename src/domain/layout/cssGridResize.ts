/**
 * F6 stage 3(a) — pixel-delta -> grid-cell conversion for resizing a card's
 * `w`/`h` (bottom-right corner drag) under the new CSS Grid dashboard renderer
 * (CssGridGrid.vue). Mirrors cssGridDrag.ts's own shape exactly (same "origin
 * cell + total pixel delta since gesture start -> clamped candidate" model,
 * same reuse of gridGutter.ts's `pxDeltaToColUnits`/`pxDeltaToRowUnits`/
 * `colWidthPx` — stage 2's own module doc already established these formulas
 * are numerically valid for CSS Grid, not just grid-layout-plus), just
 * changing `w`/`h` instead of `x`/`y`.
 *
 * Deliberately still pure (no DOM/Vue) — the composable that drives real
 * pointer events (useCssGridDashboardResize.ts) measures the live container
 * width via ResizeObserver and feeds it in as `GridMetrics.containerWidthPx`,
 * mirroring cssGridDrag.ts's own "pure math / thin Vue wrapper" split.
 *
 * B59 — on the mobile single-column breakpoint, resize must be VERTICAL-ONLY:
 * a single-column card's width is meaningless (the legacy renderer's own fix,
 * `dashboardLayout.ts`'s `VERTICAL_ONLY_RESIZE_OPTION`, zeroes the horizontal
 * edge entirely rather than letting a transient drag width overshoot and snap
 * back on release). `mobile` is an explicit parameter of
 * {@link cssGridResizeTarget} (not something the caller has to remember to
 * pre-zero `dxPx` for) so this exact rule is directly unit-testable here,
 * mirroring how `cssGridDragTarget` takes its full `GridMetrics` explicitly
 * rather than trusting a caller to have already adjusted the delta.
 */
import { colWidthPx, pxDeltaToColUnits, pxDeltaToRowUnits, type GridMetrics } from './gridGutter'

export type { GridMetrics }

/** The resized card's shape at the moment the gesture started — `x`/`y` never
 *  change during a resize (only `w`/`h` do), but `x` is still needed to clamp
 *  `w` at the grid's right edge (`x + w <= cols`). */
export interface CssGridResizeOrigin {
  x: number
  y: number
  w: number
  h: number
}

/** A clamped `w`/`h` target. */
export interface CssGridResizeTarget {
  w: number
  h: number
}

/**
 * Clamp a candidate `w`/`h` to a card's minimum size (`minW`/`minH` — see
 * dashboardLayout.ts's `minSizeFor`) and to the grid's right edge (`w` can
 * never push `x + w` past `cols`). `h` has no upper bound — same as
 * gridGutter.ts's `clampGutterDeltaUnits` doc explains for row growth: rows
 * simply add height to the page, mirroring the corner-resize handle's
 * existing behaviour in the legacy renderer. Exported separately from
 * {@link cssGridResizeTarget} so a caller with an already-computed raw target
 * (e.g. a test, or a future keyboard-resize affordance) can clamp it without
 * going through pixel math at all.
 */
export function clampResizeTarget(
  w: number,
  h: number,
  originX: number,
  cols: number,
  minW: number,
  minH: number,
): CssGridResizeTarget {
  const maxW = Math.max(minW, cols - originX)
  return {
    w: Math.min(Math.max(w, minW), maxW),
    h: Math.max(h, minH),
  }
}

/**
 * The resized card's new (clamped) `w`/`h`, given its ORIGIN size and the
 * pointer's total pixel delta since the gesture started (an "absolute, not
 * incremental" delta, same convention `cssGridDragTarget` uses, so repeated
 * rounding across many small moves can never drift).
 *
 * `mobile` (B59) zeroes the horizontal column delta entirely — a coarse
 * finger jitter sideways while growing a mobile card's height must never
 * touch `w`, not even transiently. Falls back to a zero cell-delta (rather
 * than `NaN`/`Infinity`) when the grid's own column pitch isn't positive yet
 * — the container hasn't been measured (`containerWidthPx <= 0`) or a
 * corrupt/degenerate metrics object was passed in — mirroring
 * `cssGridDragTarget`'s own guard.
 */
export function cssGridResizeTarget(
  origin: CssGridResizeOrigin,
  dxPx: number,
  dyPx: number,
  m: GridMetrics,
  minW: number,
  minH: number,
  mobile: boolean,
): CssGridResizeTarget {
  const colPitch = colWidthPx(m) + m.marginX
  const rowPitch = m.rowHeight + m.marginY
  const dCol = !mobile && colPitch > 0 ? pxDeltaToColUnits(dxPx, m) : 0
  const dRow = rowPitch > 0 ? pxDeltaToRowUnits(dyPx, m) : 0
  return clampResizeTarget(origin.w + dCol, origin.h + dRow, origin.x, m.cols, minW, minH)
}
