import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  resolveOverlaps,
  compactLayoutTopLeft,
  packExcluding,
  isItemDraggable,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'
import { cssGridDragTarget } from '@/domain/layout/cssGridDrag'
import type { GridMetrics } from '@/domain/layout/gridGutter'

export interface UseCssGridDashboardDragOptions {
  /** The layout array CURRENTLY fed to `<CssGridGrid>` (already breakpoint-
   *  resolved + collapse-reflowed — see AnalyzerView's `cssGridActiveLayout`).
   *  This composable never mutates it; it only reads the dragged item's
   *  origin cell out of it and builds a candidate on top. */
  layout: Ref<DashboardLayoutItem[]> | ComputedRef<DashboardLayoutItem[]>
  /** Currently-pinned ids (panelState's `pinnedIds`) — kept OUT of the live
   *  geometry pass via `packExcluding`, same B112 reasoning the legacy
   *  write-back path already relies on (a pinned card's stale rect must never
   *  phantom-collide with a card dragged into the space it visually
   *  occupies). */
  pinnedIds: Ref<string[]> | ComputedRef<string[]>
  /** Column count at the CURRENT breakpoint (`colNum` — 12 desktop, 1
   *  mobile). Reactive so a live breakpoint flip mid-drag (a rotated tablet,
   *  a resized window) is picked up the next frame rather than needing a
   *  fresh drag gesture. */
  cols: Ref<number> | ComputedRef<number>
  rowHeight: number
  /** Horizontal gutter/inset in px — `gridMargin[0]` (0 on mobile). Reactive
   *  for the same breakpoint-flip reason as `cols`. */
  marginX: Ref<number> | ComputedRef<number>
  marginY: number
  /** The grid-wide drag toggle (`isDraggable` from useDashboardLayout —
   *  already folds in 鎖定布局 + breakpoint). Per-item eligibility ALSO
   *  excludes a pinned card (`isItemDraggable`, dashboardLayout.ts), applied
   *  internally by {@link UseCssGridDashboardDragReturn.isItemDraggableNow}. */
  draggable: Ref<boolean> | ComputedRef<boolean>
  /** Called once, with the SETTLED full layout array (display shape — same
   *  items `layout` holds, with the dragged item's cell updated and every
   *  other affected card already reflowed), when a drag ends via a genuine
   *  pointerup. The caller is expected to route this through the EXACT same
   *  write-back path the legacy grid-layout-plus renderer's
   *  `update:layout`/`layout-updated` already uses (AnalyzerView's shared
   *  `writeBackLayout`) so persistence, the B52 display/canonical height
   *  split, and mobile-order derivation all stay identical between the two
   *  renderers. Never called when a drag is aborted (lock toggled mid-drag,
   *  a second pointer landing, or a stray pointercancel). */
  onCommit: (next: DashboardLayoutItem[]) => void
}

export interface UseCssGridDashboardDragReturn {
  /** Bind to the CssGridGrid instance's root element (a component ref's
   *  `.$el`) so this composable can measure the SAME container width
   *  `gridContainerStyle`'s track-sizing math implies — mirrors
   *  useGridGutters.ts's own `containerRef`/ResizeObserver wiring exactly,
   *  just pointed at the new renderer's own DOM root instead of the old
   *  grid-wrap div (which doesn't exist at all while this renderer is
   *  active). */
  containerRef: Ref<HTMLElement | null>
  /** The layout to actually feed `<CssGridGrid :layout="...">`: `layout`
   *  itself while nothing is being dragged, or a live reflow PREVIEW (the
   *  dragged item's candidate cell run through resolveOverlaps +
   *  compactLayoutTopLeft, pinned ids excluded) while a drag is in progress.
   *  Discarded (never persisted) on its own — {@link UseCssGridDashboardDragOptions.onCommit}
   *  is what actually writes a drag's result back. */
  previewLayout: ComputedRef<DashboardLayoutItem[]>
  /** The id currently being dragged, or null. Lets a caller add a "this card
   *  is mid-drag" visual (e.g. a raised z-index) without re-deriving it. */
  draggingId: ComputedRef<string | null>
  /** The dragged card's RAW pixel offset from its rest position since the
   *  drag started (not grid-cell-snapped) — "the card follows the pointer"
   *  while its logical slot (and every other card's preview position) only
   *  advances in whole grid-cell steps. Null while nothing is dragging. */
  dragOffsetPx: ComputedRef<{ id: string; dxPx: number; dyPx: number } | null>
  /** Whether `id` is currently allowed to start a drag — folds the grid-wide
   *  toggle together with the pinned-card exception (isItemDraggable). */
  isItemDraggableNow: (id: string) => boolean
  /** Wire to DashboardCard's `@css-grid-drag-start` (dragMode="cssGrid"). No-op
   *  if `id` isn't currently draggable or isn't found in `layout`. */
  onCardDragStart: (id: string, clientX: number, clientY: number) => void
  /** Wire to DashboardCard's `@css-grid-drag-move`. Coalesced to at most once
   *  per animation frame — see this module's own doc below. No-op if no drag
   *  is in progress. */
  onCardDragMove: (clientX: number, clientY: number) => void
  /** Wire to DashboardCard's `@css-grid-drag-end`. `committed` mirrors that
   *  event's own payload: true for a genuine pointerup (calls `onCommit` with
   *  the settled preview), false for an abort (lock toggled mid-drag, a
   *  pointercancel, or a second pointer landing — discards the preview with
   *  no persistence at all). */
  onCardDragEnd: (committed: boolean) => void
}

interface ActiveDrag {
  id: string
  originX: number
  originY: number
  w: number
  /** Pointer position at drag start (clientX/clientY). */
  startX: number
  startY: number
  /** Latest RAW pointer position (drives `dragOffsetPx`'s smooth follow). */
  lastPointerX: number
  lastPointerY: number
  /** Latest CLAMPED target cell (drives `previewLayout`'s discrete reflow). */
  targetX: number
  targetY: number
}

/**
 * Vue-layer wiring for the F6 stage-2 CSS Grid drag-to-reorder feature —
 * deliberately thin, same "own DOM measurement + pointer-event coalescing,
 * delegate every actual layout decision to pure functions" split
 * useGridGutters.ts already established for the sibling gutter-drag feature.
 * AnalyzerView.vue owns the actual persisted state (`layout`/`mobileOrder`/
 * `pinnedIds`/`collapsedIds`) and is the only thing that ever calls
 * `onCommit` through to storage — this composable only ever produces a
 * PREVIEW and a final candidate array, never touches localStorage itself.
 */
export function useCssGridDashboardDrag(options: UseCssGridDashboardDragOptions): UseCssGridDashboardDragReturn {
  const { layout, pinnedIds, cols, rowHeight, marginX, marginY, draggable, onCommit } = options

  // --- Container width measurement (mirrors useGridGutters.ts's own
  // ResizeObserver wiring, pointed at CssGridGrid's own root element instead
  // of the legacy grid-wrap div). ---
  const containerRef = ref<HTMLElement | null>(null)
  const containerWidthPx = ref(0)
  let observer: ResizeObserver | null = null
  watch(
    containerRef,
    (el, _prev, onCleanup) => {
      observer?.disconnect()
      observer = null
      if (!el) return
      containerWidthPx.value = el.clientWidth
      observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width
        if (width != null) containerWidthPx.value = width
      })
      observer.observe(el)
      onCleanup(() => observer?.disconnect())
    },
    { immediate: true },
  )
  onBeforeUnmount(() => observer?.disconnect())

  const metrics = computed<GridMetrics>(() => ({
    cols: cols.value,
    rowHeight,
    marginX: marginX.value,
    marginY,
    containerWidthPx: containerWidthPx.value,
  }))

  const pinnedSet = computed(() => new Set(pinnedIds.value))

  function isItemDraggableNow(id: string): boolean {
    return isItemDraggable(draggable.value, pinnedSet.value.has(id))
  }

  const active = ref<ActiveDrag | null>(null)

  const draggingId = computed(() => active.value?.id ?? null)

  const dragOffsetPx = computed(() => {
    const a = active.value
    if (!a) return null
    return { id: a.id, dxPx: a.lastPointerX - a.startX, dyPx: a.lastPointerY - a.startY }
  })

  /** The live reflow preview — a pure re-run of the SAME collision/packing
   *  pipeline the legacy write-back path uses (resolveOverlaps then
   *  compactLayoutTopLeft, pinned ids excluded via packExcluding), applied to
   *  a candidate where ONLY the dragged item's cell has moved. Simplification
   *  vs. the authoritative write-back (see `onCommit`'s own doc): this
   *  preview always uses compactLayoutTopLeft regardless of whether some
   *  OTHER card is currently collapsed (the B52 vertical-only packer choice
   *  the legacy setter makes in that case) — a harmless approximation since
   *  the actual PERSISTED result on drop always goes through the fully
   *  correct, collapse-aware `writeBackLayout` the caller supplies as
   *  `onCommit`; only the in-flight visual preview could theoretically differ
   *  for one frame in that rare combination. */
  const previewLayout = computed<DashboardLayoutItem[]>(() => {
    const a = active.value
    if (!a) return layout.value
    const candidate = layout.value.map((it) => (it.i === a.id ? { ...it, x: a.targetX, y: a.targetY } : it))
    return packExcluding(candidate, pinnedSet.value, (items) => compactLayoutTopLeft(resolveOverlaps(items)))
  })

  // --- rAF coalescing: DashboardCard forwards every raw pointermove as a
  // `css-grid-drag-move` emit (same "just record the latest coordinate"
  // convention its own B102a edge-autoscroll loop already uses) — recomputing
  // the candidate layout (resolveOverlaps + compactLayoutTopLeft) on EVERY one
  // of those would mean doing that work far more often than the screen can
  // even paint. Buffer the latest pointer position and only re-derive the
  // target cell once per animation frame. ---
  let pendingPointer: { x: number; y: number } | null = null
  let rafId: number | null = null

  function flushPendingMove(): void {
    rafId = null
    const a = active.value
    const pending = pendingPointer
    if (!a || !pending) return
    const target = cssGridDragTarget({ x: a.originX, y: a.originY, w: a.w }, pending.x - a.startX, pending.y - a.startY, metrics.value)
    active.value = { ...a, lastPointerX: pending.x, lastPointerY: pending.y, targetX: target.x, targetY: target.y }
  }

  function cancelPendingFrame(): void {
    if (rafId != null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function onCardDragStart(id: string, clientX: number, clientY: number): void {
    if (!isItemDraggableNow(id)) return
    if (active.value) return // belt-and-braces — a stray second start should never stomp an in-flight drag
    const item = layout.value.find((it) => it.i === id)
    if (!item) return
    active.value = {
      id,
      originX: item.x,
      originY: item.y,
      w: item.w,
      startX: clientX,
      startY: clientY,
      lastPointerX: clientX,
      lastPointerY: clientY,
      targetX: item.x,
      targetY: item.y,
    }
  }

  function onCardDragMove(clientX: number, clientY: number): void {
    if (!active.value) return
    pendingPointer = { x: clientX, y: clientY }
    if (rafId == null) rafId = window.requestAnimationFrame(flushPendingMove)
  }

  function onCardDragEnd(committed: boolean): void {
    cancelPendingFrame()
    flushPendingMove()
    const a = active.value
    pendingPointer = null
    if (!a) return
    if (committed) {
      const settled = previewLayout.value
      active.value = null
      onCommit(settled)
    } else {
      active.value = null
    }
  }

  onBeforeUnmount(() => {
    cancelPendingFrame()
    active.value = null
  })

  return {
    containerRef,
    previewLayout,
    draggingId,
    dragOffsetPx,
    isItemDraggableNow,
    onCardDragStart,
    onCardDragMove,
    onCardDragEnd,
  }
}
