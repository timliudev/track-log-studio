/**
 * IDE-style "drag the gap between two cards" resizing (使用者回饋 #5).
 *
 * grid-layout-plus (see dashboardLayout.ts / useDashboardLayout.ts) already
 * gives every card its OWN bottom-right resize handle, which only ever
 * changes THAT card's own w/h. This module adds the other half: dragging the
 * GAP itself resizes the card whose edge that gap actually is (`a` — the
 * left/top side) — exactly like grabbing that card's own edge and pulling it,
 * NOT a fixed two-card zero-sum trade with whatever happens to be its
 * immediate neighbour (`b`) at that moment.
 *
 * #5 fix (revised from the original zero-sum design): earlier, `applyGutterDrag`
 * grew `a` by exactly what it shrank `b` by, sliding `b`'s x/y to keep them
 * touching — feedback was that this is the wrong mental model. Dragging a
 * horizontal gutter down should grow the card ABOVE it and push everything
 * BELOW further down (or, for a vertical gutter, to the side) — a reflow, not
 * a private negotiation between two specific cards. `b`'s own position is now
 * left untouched by this module entirely; `useGridGutters.ts` feeds the
 * result back through AnalyzerView's normal `layout` prop / `onLayoutUpdated`
 * pipeline, and grid-layout-plus's OWN vertical-compaction (`compact()`,
 * confirmed by reading its source — it pulls every item up as far as it can
 * without colliding, then pushes down whatever still collides, and runs on
 * EVERY change to its `layout` prop, not just its own native drag gestures)
 * does the actual reflow. This only works safely because AnalyzerView's
 * write-back (`mergeLayoutPositions`) is idempotent on a converged layout
 * (#4's crash fix) — otherwise a self-triggered `layout-updated` echo after
 * compaction could loop.
 *
 * Kept as pure functions (no Vue/DOM) so the tricky part — which two cards
 * actually share a draggable edge, and how a pixel delta maps to a grid-unit
 * delta — is unit-testable without mounting anything; the composable that
 * drives real pointer events (useGridGutters.ts) is a thin wrapper that only
 * does event wiring and calls into here.
 *
 * SCOPE / known limitation: gutters are detected PAIRWISE. If three cards
 * meet along one straight edge (e.g. two short cards stacked against one tall
 * neighbour), each adjacent pair gets its own independently-draggable gutter
 * segment rather than one shared "column border" — dragging one segment only
 * ever resizes the ONE card that segment belongs to, same as the task's
 * "drag the boundary" framing. A full "resize this whole column/row" mode is
 * bigger scope (would need to grow a SET of cards together) and isn't what
 * was asked for here.
 */

import { minSizeFor, type DashboardLayoutItem } from './dashboardLayout'

export type GutterOrientation = 'vertical' | 'horizontal'

/**
 * One draggable segment between two ADJACENT cards: `aId`'s right edge (for
 * a vertical gutter, i.e. a left/right split) or bottom edge (horizontal,
 * top/bottom split) touches `bId`'s facing edge. `edge` is the shared-edge
 * coordinate on the gutter's OWN axis (x for vertical, y for horizontal);
 * `start`/`end` is the OVERLAPPING span on the orthogonal axis (grid units)
 * — i.e. how far up/down (vertical) or left/right (horizontal) the shared
 * border actually runs, which can be shorter than either card's full edge
 * when they're only partially aligned.
 */
export interface GridGutter {
  orientation: GutterOrientation
  /** Card on the left (vertical) / top (horizontal) side of the shared edge. */
  aId: string
  /** Card on the right (vertical) / bottom (horizontal) side. */
  bId: string
  edge: number
  start: number
  end: number
}

/** Stable identity for a gutter — used as a Vue `:key` and to correlate an
 *  in-progress drag gesture back to the gutter that started it (a fresh
 *  `detectGutters` call on every layout change would otherwise hand back a
 *  new-but-equal-looking object each render). */
export function gutterKey(g: Pick<GridGutter, 'orientation' | 'aId' | 'bId'>): string {
  return `${g.orientation}:${g.aId}:${g.bId}`
}

/**
 * Find every pair of cards in `items` that share a straight edge — i.e. one
 * card's right (or bottom) edge coincides exactly with another's left (or
 * top) edge, AND their spans on the orthogonal axis actually overlap (not
 * just touch at a single corner point). `items` should already be filtered
 * down to whatever's actually draggable/visible in the CALLER's context (the
 * Vue layer excludes hidden align-cards and the currently-pinned card's
 * placeholder — see useGridGutters.ts) since this function has no notion of
 * visibility itself; it just looks at the x/y/w/h it's given.
 *
 * O(n²) over `items`, which is fine at dashboard-card counts (a dozen-ish).
 */
export function detectGutters(items: DashboardLayoutItem[]): GridGutter[] {
  const gutters: GridGutter[] = []
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue
      // Vertical gutter: b sits directly to the right of a.
      if (b.x === a.x + a.w) {
        const start = Math.max(a.y, b.y)
        const end = Math.min(a.y + a.h, b.y + b.h)
        if (end > start) {
          gutters.push({ orientation: 'vertical', aId: a.i, bId: b.i, edge: b.x, start, end })
        }
      }
      // Horizontal gutter: b sits directly below a.
      if (b.y === a.y + a.h) {
        const start = Math.max(a.x, b.x)
        const end = Math.min(a.x + a.w, b.x + b.w)
        if (end > start) {
          gutters.push({ orientation: 'horizontal', aId: a.i, bId: b.i, edge: b.y, start, end })
        }
      }
    }
  }
  return gutters
}

/**
 * Clamp a proposed grid-unit delta so dragging a gutter can never shrink the
 * DRAGGED side (`a` — the card whose trailing/bottom edge this gutter sits
 * on) past its own {@link minSizeFor} floor (same floor the card's own
 * corner-resize handle already respects — B6), nor — for a VERTICAL gutter,
 * when `cols` is given — grow it past the grid's own column count: this grid
 * only ever compacts VERTICALLY (see applyGutterDrag's doc), so there's no
 * "push sideways to make room" for a width that would overflow the grid.
 *
 * #5 fix — `b` (the neighbour on the other side of the edge) is no longer
 * involved in this clamp at all: it isn't resized by a gutter drag anymore,
 * only reflowed (by grid-layout-plus's own compaction) around whatever `a`
 * becomes. `a` is assumed to already meet its own minimum (true for anything
 * that ever reaches the grid — see dashboardLayout.ts's clampToMinSize), so
 * the returned range always straddles zero (a no-op drag is always valid).
 */
export function clampGutterDeltaUnits(
  orientation: GutterOrientation,
  a: DashboardLayoutItem,
  deltaUnits: number,
  cols?: number,
): number {
  const minA = minSizeFor(a.i)
  const aSize = orientation === 'vertical' ? a.w : a.h
  const minASize = orientation === 'vertical' ? minA.minW : minA.minH
  // a.size + delta >= minASize  =>  delta >= minASize - aSize
  const low = minASize - aSize
  // Vertical only: a.x + a.w + delta <= cols  =>  delta <= cols - a.x - aSize.
  // Horizontal (row) growth has no analogous ceiling — rows just add height
  // to the page, same as the corner-resize handle allows today.
  const high = orientation === 'vertical' && cols != null ? cols - a.x - aSize : Infinity
  return Math.min(Math.max(deltaUnits, low), high)
}

/**
 * Apply a gutter drag: resizes ONLY `a` (the card whose trailing/bottom edge
 * this gutter is) by the clamped delta — `b` is left completely untouched
 * here (see this module's doc for why: reflowing `b`, and anything past it,
 * is grid-layout-plus's OWN vertical-compaction's job once this result flows
 * back through the normal `layout` prop, not something this pure function
 * does directly). `b` still has to EXIST for the drag to mean anything (an
 * edge is only meaningful between two real cards), so this remains a no-op
 * when either id can't be found.
 *
 * `cols` is optional (needed only to cap a VERTICAL gutter's growth at the
 * grid's own column count — see {@link clampGutterDeltaUnits}); omit it for
 * a horizontal gutter or when the caller doesn't care about that ceiling.
 *
 * Pure: returns a NEW array (only `a` is replaced; every other item is
 * returned as-is) and is a no-op (returns `items` unchanged) if either card
 * can't be found or the clamped delta is zero.
 */
export function applyGutterDrag(
  items: DashboardLayoutItem[],
  gutter: Pick<GridGutter, 'orientation' | 'aId' | 'bId'>,
  deltaUnits: number,
  cols?: number,
): DashboardLayoutItem[] {
  const a = items.find((it) => it.i === gutter.aId)
  const b = items.find((it) => it.i === gutter.bId)
  if (!a || !b) return items
  const delta = clampGutterDeltaUnits(gutter.orientation, a, deltaUnits, cols)
  if (delta === 0) return items
  return items.map((it) =>
    it.i === a.i
      ? gutter.orientation === 'vertical'
        ? { ...it, w: it.w + delta }
        : { ...it, h: it.h + delta }
      : it,
  )
}

/**
 * B52 fix — drop any gutter whose DRAGGED side (`aId`) is currently collapsed
 * from a HORIZONTAL detection list. A collapsed card's on-screen height
 * (`COLLAPSED_ROWS` — see dashboardLayout.ts's `applyCollapsedHeights`) is a
 * DISPLAY-only overlay, not its real canonical height; letting a user grab
 * that edge would drag against a floor/height that gets reverted the moment
 * the drag's result is written back (AnalyzerView restores the canonical
 * height for any collapsed card before persisting — see its `activeLayout`
 * setter and useGridGutters' `onChange`), producing a drag that visibly does
 * nothing. A VERTICAL gutter on a collapsed card's right edge is unaffected —
 * collapse only overlays `h`, never `w` — so it stays fully draggable.
 *
 * Pure filter; callers pass the caller's own `collapsedIds` (see
 * useGridGutters.ts's `collapsedIds` option).
 */
export function filterCollapsedGutters(
  gutters: GridGutter[],
  collapsedIds: ReadonlySet<string>,
): GridGutter[] {
  if (collapsedIds.size === 0) return gutters
  return gutters.filter((g) => !(g.orientation === 'horizontal' && collapsedIds.has(g.aId)))
}

/**
 * Pixel metrics needed to place a gutter's hit-box and to convert a mouse
 * drag's pixel delta into a grid-unit delta — mirrors grid-layout-plus's OWN
 * internal position math EXACTLY (see its `calcColWidth`/`calcPosition` in
 * grid-item.vue) so a gutter overlay drawn from these numbers lines up
 * pixel-for-pixel with the real cards, using only the same public props
 * AnalyzerView already passes to `<GridLayout>` (`col-num`, `row-height`,
 * `margin`) plus the container's measured width (grid-layout-plus measures
 * its own root element's width the same way — see useGridGutters.ts).
 */
export interface GridMetrics {
  cols: number
  rowHeight: number
  marginX: number
  marginY: number
  containerWidthPx: number
}

/** Column width in px — identical formula to grid-item.vue's `calcColWidth`. */
export function colWidthPx(m: GridMetrics): number {
  return (m.containerWidthPx - m.marginX * (m.cols + 1)) / m.cols
}

/** Left edge (px) of grid column `x`. */
export function xPx(x: number, m: GridMetrics): number {
  return colWidthPx(m) * x + (x + 1) * m.marginX
}

/** Width (px) spanning `w` columns. */
export function wPx(w: number, m: GridMetrics): number {
  return colWidthPx(m) * w + Math.max(0, w - 1) * m.marginX
}

/** Top edge (px) of grid row `y`. */
export function yPx(y: number, m: GridMetrics): number {
  return m.rowHeight * y + (y + 1) * m.marginY
}

/** Height (px) spanning `h` rows. */
export function hPx(h: number, m: GridMetrics): number {
  return m.rowHeight * h + Math.max(0, h - 1) * m.marginY
}

/** A gutter's on-screen hit-box, in px, relative to the grid container's
 *  top-left corner — exactly fills the margin gap between the two cards
 *  (see the module doc's formula derivation: the gap between two touching
 *  items is always exactly one `margin` wide/tall). */
export interface GutterRect {
  left: number
  top: number
  width: number
  height: number
}

export function gutterRect(g: Pick<GridGutter, 'orientation' | 'edge' | 'start' | 'end'>, m: GridMetrics): GutterRect {
  if (g.orientation === 'vertical') {
    const left = xPx(g.edge, m) - m.marginX
    const top = yPx(g.start, m)
    return { left, top, width: m.marginX, height: yPx(g.end, m) - m.marginY - top }
  }
  const top = yPx(g.edge, m) - m.marginY
  const left = xPx(g.start, m)
  return { left, top, width: xPx(g.end, m) - m.marginX - left, height: m.marginY }
}

/** Convert a horizontal mouse-drag pixel delta into a column-unit delta —
 *  the step size a drag needs to cross for the library to consider that a
 *  full column moved (colWidth + one margin), same as grid-item.vue's own
 *  `calcXY`. Rounds to the nearest whole column. */
export function pxDeltaToColUnits(deltaPx: number, m: GridMetrics): number {
  return Math.round(deltaPx / (colWidthPx(m) + m.marginX))
}

/** Convert a vertical mouse-drag pixel delta into a row-unit delta. */
export function pxDeltaToRowUnits(deltaPx: number, m: GridMetrics): number {
  return Math.round(deltaPx / (m.rowHeight + m.marginY))
}
