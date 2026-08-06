<script setup lang="ts">
import { computed, type CSSProperties } from 'vue'
import type { DashboardLayoutItem } from '@/domain/layout/dashboardLayout'
import { itemGridPlacement, gridContainerStyle } from '@/domain/layout/cssGridPlacement'

/**
 * F6 stage 1 — a CSS-Grid-based dashboard renderer, feature-flag-gated
 * (`cssGridDashboard`, see src/config/featureFlags.ts) alternative to
 * grid-layout-plus's `<GridLayout>`. Stage 1 was RENDER ONLY; stage 2 (see
 * `dragOffsetPx`'s doc below, and useCssGridDashboardDrag.ts) added drag-to-
 * reorder; stage 3 adds corner resize + gutter-drag (both live one level up,
 * in useCssGridDashboardResize.ts / AnalyzerView's reuse of useGridGutters.ts
 * — this component itself is unaware of either gesture) and the multi-pin
 * stacking treatment documented at `pinStackStyle` below (see docs/ISSUES.md's
 * F6 entry for what's left for stage 4). This component still just draws
 * WHATEVER `layout` array it's handed (drag/resize preview or settled) at the
 * exact same pixel geometry (see cssGridPlacement.ts's module doc for the
 * algebraic proof), via native `grid-column`/`grid-row` placement instead of
 * grid-layout-plus's `position: absolute` + `transform: translate3d` — the
 * actual gesture MECHANICS (pointer tracking, collision/compaction, commit)
 * all live one level up; this component only renders the resulting layout
 * array plus one extra pixel `translate()` for whichever single item is
 * currently being dragged.
 *
 * THE POINT of this migration: `position: sticky` never applies to an
 * absolutely-positioned element, which is exactly why the old "pin a card so
 * it stays visible while scrolling" feature had to fake it by `<Teleport>`ing
 * the pinned card out of the grid into a separate sticky container — the
 * user explicitly rejected that ("不該拉出獨立空間，這無論都無法接受").
 * Because every card here is an ordinary IN-FLOW CSS Grid item (explicit
 * `grid-column`/`grid-row`, not absolute positioning), a pinned card can
 * simply get `position: sticky` and stick EXACTLY where it already sits — no
 * Teleport, no placeholder, no separate anchor. Multiple pinned cards each
 * get their own sticky wrapper; stage 3(c) gives them a small staggered
 * `top` offset + pin-order-driven z-index (see `pinStackStyle` below) rather
 * than leaving every one at an identical `top: 0`.
 *
 * AnalyzerView.vue owns the actual data (persisted `layout`, `panelState`'s
 * `pinnedIds`, collapse, visibility) — this component only lays out
 * WHATEVER layout array it's handed, unfiltered; the CALLER decides what's
 * visible/pinned (mirrors how `<GridLayout>` itself never knows about
 * collapse/pin either, see AnalyzerView's `decorateForGrid`/`isVisibleId`).
 * The `#item` slot receives each item exactly like grid-layout-plus's own
 * `#item` slot does, so a caller migrating between the two only needs to
 * swap which grid component wraps the SAME card markup (DashboardCard +
 * AnalyzerCardBody) — see AnalyzerView's `v-if="!cssGridEnabled"` branch.
 */
const props = defineProps<{
  /** The layout items to render, ALREADY filtered to whatever's visible at
   *  the current breakpoint (see AnalyzerView's `cssGridDesktopLayout`/
   *  `cssGridMobileLayout`) — unlike the old grid-layout-plus path, pinned
   *  items are NOT excluded here; they render in place and just get the
   *  sticky treatment below. */
  layout: DashboardLayoutItem[]
  /** Column count — `GRID_COLS` on desktop, `1` on mobile (same breakpoint
   *  useDashboardLayout.ts already derives). */
  cols: number
  /** Row height in px — `GRID_ROW_HEIGHT` (dashboardLayout.ts), shared with
   *  the old renderer so both agree on pixel geometry. */
  rowHeight: number
  /** Horizontal gutter/inset in px — `gridMargin[0]` (0 on mobile, see
   *  useDashboardLayout.ts's own doc). */
  marginX: number
  /** Vertical gutter/inset in px — `gridMargin[1]`. */
  marginY: number
  /** Ids currently pinned (`panelState.pinnedIds`), ALREADY in pin order
   *  (index 0 = pinned first — same convention AnalyzerView's `pinOrderFor`
   *  documents for the legacy renderer) — rendered with `position: sticky`
   *  instead of grid-layout-plus's Teleport-to-anchor trick. F6 stage 3(c) —
   *  this array's INDEX also drives the staggered `top` offset + z-index a
   *  pinned card gets when several are pinned at once, see `pinOrderFor`/
   *  `styleFor` below for the "why". */
  pinnedIds?: string[]
  /** F6 stage 2 — the card currently being dragged, plus its RAW pixel offset
   *  from its rest position since the drag started (useCssGridDashboardDrag's
   *  `dragOffsetPx`; NOT grid-cell-snapped — `layout` itself already reflects
   *  the discrete drop-target preview via the caller swapping in
   *  `previewLayout`, see AnalyzerView's wiring). Applied as an EXTRA
   *  `translate()` on top of the dragged item's own `grid-column`/`grid-row`
   *  placement so the card visually follows the pointer smoothly while every
   *  OTHER card only reflows in whole-cell steps — the same "smooth dragged
   *  item, discrete everything else" split most drag-reorder implementations
   *  use. `null`/omitted (every stage-1 caller, and stage 2 whenever nothing
   *  is being dragged) leaves every item's style exactly as stage 1 had it. */
  dragOffsetPx?: { id: string; dxPx: number; dyPx: number } | null
}>()

const pinnedSet = computed(() => new Set(props.pinnedIds ?? []))

function isPinnedId(id: string): boolean {
  return pinnedSet.value.has(id)
}

/** F6 stage 3(c) — this item's position within the pin STACK (0 = pinned
 *  first), or -1 if not pinned/not found — same meaning as AnalyzerView's own
 *  `pinOrderFor` for the legacy renderer, just derived locally here since
 *  `pinnedIds` is already handed to this component in pin order (see that
 *  prop's own doc). */
function pinOrderFor(id: string): number {
  return props.pinnedIds?.indexOf(id) ?? -1
}

/** F6 stage 3(c) — multi-pin stacking. Unlike the legacy renderer (where
 *  EVERY pinned card left the grid entirely and joined one shared flex-column
 *  anchor, so `pinOrder` could drive a plain CSS `order`), a pinned card here
 *  stays in its OWN grid cell — "stacking order" has no flex-column
 *  equivalent to reuse. Two things can go wrong with several simultaneously-
 *  sticky cards left at an identical `top: 0`:
 *
 *   1. Cross-browser handling of a grid item's sticky "containing block" has
 *      historically not been fully consistent (some engines confine a sticky
 *      grid item's stuck range to its own grid AREA, which would make two
 *      cards stacked in the same column hand off cleanly with no special
 *      case needed at all; others have been observed treating the whole grid
 *      container as the containing block instead, which would let two
 *      same-column pinned cards' stuck ranges genuinely overlap).
 *   2. Even where handoff is clean, an instant identical `top` for several
 *      pinned cards gives zero visual cue that more than one thing is
 *      pinned at all until you actually scroll into the overlap.
 *
 *  This can't be verified pixel-for-pixel in this headless environment (no
 *  real paint/scroll — see this migration's own honest-limitation note), so
 *  the fix here is deliberately simple and safe rather than trying to
 *  precisely compute real card heights: a small per-slot `top` CASCADE (a
 *  later-pinned card's sticky position sits a little further down than an
 *  earlier one's) so even a worst-case full overlap still shows a "stacked
 *  cards" edge peeking out underneath, plus a z-index that puts the
 *  EARLIEST-pinned card (index 0 — "pinned first", same ordering
 *  AnalyzerView's own pinOrderFor documents) on TOP of later ones, mirroring
 *  which card a user would expect to stay most visible. A single pinned card
 *  (by far the common case) gets `top: 0`/its existing z-index exactly as
 *  before — zero visual change from stage 1/2. */
const PIN_STACK_OFFSET_PX = 8
const PIN_BASE_Z_INDEX = 20

function pinStackStyle(order: number): { top: string; zIndex: number } {
  return {
    top: `${order * PIN_STACK_OFFSET_PX}px`,
    // Earlier pin order (0) renders ABOVE later ones; never dips below the
    // base 20 even if an implausibly large number of cards were ever pinned
    // at once, and always stays under the actively-dragged item's z-index 30
    // (see `styleFor`'s own dragging branch) since a pinned card is never
    // draggable in the first place (dashboardLayout.ts's `isItemDraggable`).
    zIndex: Math.max(PIN_BASE_Z_INDEX, PIN_BASE_Z_INDEX + 9 - order),
  }
}

const containerStyle = computed(() =>
  gridContainerStyle({
    cols: props.cols,
    rowHeight: props.rowHeight,
    marginX: props.marginX,
    marginY: props.marginY,
  }),
)

/** Per-item wrapper style: grid placement always; `position: sticky` (plus a
 *  z-index so a stuck card renders above whatever scrolls underneath it) only
 *  for a pinned item. `top: 0` sticks it to the very top of the nearest
 *  scrolling ancestor — same effective anchor point the old
 *  `#dashboard-pinned-anchor` used (`position: sticky; top: 0`), just without
 *  a dedicated container: this wrapper itself IS the sticky element, still
 *  sitting in its ordinary grid cell. */
/** F6 stage 2 — the raw pixel `translate()` to layer on top of the dragged
 *  item's own grid placement (see the `dragOffsetPx` prop's own doc); `null`
 *  for every other item, or whenever nothing is being dragged. */
function dragTransformFor(item: DashboardLayoutItem): string | null {
  const offset = props.dragOffsetPx
  if (!offset || offset.id !== item.i) return null
  return `translate(${offset.dxPx}px, ${offset.dyPx}px)`
}

function styleFor(item: DashboardLayoutItem): CSSProperties {
  // Destructured into a fresh object literal at each `return` (rather than
  // spreading the `itemGridPlacement` result variable directly) so Vue's
  // `CSSProperties` structural check sees a genuine literal at the return
  // site instead of a pre-typed `CssGridPlacement` value — TS otherwise
  // demands `CssGridPlacement` itself declare CSSProperties' custom-property
  // (`--foo`) index signature, which would be an odd thing for a plain
  // domain type to carry just to satisfy this component's own template.
  const { gridColumn, gridRow } = itemGridPlacement(item)
  const transform = dragTransformFor(item)
  // F6 stage 2 — a card mid-drag gets a raised z-index (above even a sticky
  // pinned card's own 20 — see below — though the two never coincide in
  // practice: a pinned card is never draggable, see dashboardLayout.ts's
  // `isItemDraggable`) so it visually floats above whatever it's passing over
  // while following the pointer.
  if (transform) return { gridColumn, gridRow, transform, zIndex: 30, position: 'relative' }
  if (!isPinnedId(item.i)) return { gridColumn, gridRow }
  const { top, zIndex } = pinStackStyle(pinOrderFor(item.i))
  return { gridColumn, gridRow, position: 'sticky', top, zIndex }
}
</script>

<template>
  <div class="css-grid-dashboard" :style="containerStyle">
    <div
      v-for="item in layout"
      :key="item.i"
      class="css-grid-item"
      :class="{ pinned: isPinnedId(item.i), dragging: dragOffsetPx?.id === item.i }"
      :style="styleFor(item)"
    >
      <slot name="item" :item="item" />
    </div>
  </div>
</template>

<style scoped>
.css-grid-dashboard {
  width: 100%;
  box-sizing: border-box;
}
.css-grid-item {
  /* Grid items default to a content-derived min-size (`min-width: auto` /
     `min-height: auto`), which can force the TRACK wider/taller than its
     nominal size when a child (e.g. a wide table) doesn't shrink easily —
     zeroing it here is the standard CSS Grid fix so the item respects its
     `grid-column`/`grid-row` span instead of blowing it out. */
  min-width: 0;
  min-height: 0;
}
/* Pinned-card affordance — same shadow value DashboardCard.vue's own
   `.dashboard-card.pinned` mobile rule already uses (B64), reused here so a
   sticky-in-grid pinned card reads consistently with the rest of the app's
   "this card is floating above the page" visual language, at every
   breakpoint (not just mobile — stage 1 has no separate desktop treatment
   since there's no separate floating anchor to distinguish it from anymore). */
.css-grid-item.pinned {
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.16);
}
/* F6 stage 2 — the dragged card itself (see `dragOffsetPx`'s doc): a slightly
   stronger shadow than the pinned affordance so it visually lifts off the
   grid while following the pointer, and `cursor: grabbing` for mouse/pen
   (harmless no-op on touch). No `transition` here — the whole point of
   `dragOffsetPx` is a 1:1, un-smoothed follow of the live pointer position;
   animating it would introduce lag between the finger/cursor and the card. */
.css-grid-item.dragging {
  cursor: grabbing;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
}
</style>
