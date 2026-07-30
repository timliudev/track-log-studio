import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import { isItemResizable, minSizeFor, type DashboardLayoutItem } from '@/domain/layout/dashboardLayout'
import { cssGridResizeTarget } from '@/domain/layout/cssGridResize'
import type { GridMetrics } from '@/domain/layout/gridGutter'

export interface UseCssGridDashboardResizeOptions {
  /** The layout array CURRENTLY fed to `<CssGridGrid>` (already breakpoint-
   *  resolved + collapse-reflowed + drag-preview-applied — see AnalyzerView's
   *  `cssGridDrag.previewLayout`). This composable never mutates it; it only
   *  reads the resized item's origin size out of it and builds a candidate on
   *  top. */
  layout: Ref<DashboardLayoutItem[]> | ComputedRef<DashboardLayoutItem[]>
  /** Currently-pinned ids — folded into per-item eligibility exactly like
   *  `isItemResizable` already does for the legacy renderer (a pinned card's
   *  grid slot is fixed at its natural footprint under this renderer; it has
   *  no resize mechanism at all, see AnalyzerView's `disable-pin-resize`
   *  wiring). */
  pinnedIds: Ref<string[]> | ComputedRef<string[]>
  /** Currently-collapsed ids — a collapsed card is header-only, same
   *  "not resizable" rule `decorateForGrid` already applies for the legacy
   *  renderer (see dashboardLayout.ts's `isItemResizable(...) && !collapsed`). */
  collapsedIds: Ref<ReadonlySet<string>> | ComputedRef<ReadonlySet<string>>
  /** Column count at the CURRENT breakpoint — reactive so a live breakpoint
   *  flip mid-resize is picked up the next frame. */
  cols: Ref<number> | ComputedRef<number>
  rowHeight: number
  /** Horizontal gutter/inset in px (0 on mobile) — reactive for the same
   *  breakpoint-flip reason as `cols`. */
  marginX: Ref<number> | ComputedRef<number>
  marginY: number
  /** The grid-wide resize toggle (`isResizable` from useDashboardLayout —
   *  already folds in 鎖定布局 + breakpoint). Per-item eligibility ALSO
   *  excludes a pinned or collapsed card, applied internally by
   *  {@link UseCssGridDashboardResizeReturn.isItemResizableNow}. */
  resizable: Ref<boolean> | ComputedRef<boolean>
  /** B59 — true on the mobile single-column breakpoint: resize is locked to
   *  vertical-only there (see cssGridResize.ts's own `mobile` param doc). */
  isMobile: Ref<boolean> | ComputedRef<boolean>
  /** Called once, with the SETTLED full layout array (every item unchanged
   *  except the resized one's new `w`/`h`), when a resize ends via a genuine
   *  pointerup. The caller is expected to route this through the EXACT same
   *  write-back path the drag composable's `onCommit` uses (AnalyzerView's
   *  shared `writeBackLayout`) — that function already runs
   *  resolveOverlaps/compaction and restores canonical collapsed heights, so
   *  this composable itself never needs to reflow siblings live (unlike the
   *  drag preview, a growing/shrinking card is left to visually overlap its
   *  neighbours during the gesture, exactly like grid-layout-plus's own
   *  corner-resize handle does today — compaction only settles things once
   *  the gesture ends). Never called when a resize is aborted. */
  onCommit: (next: DashboardLayoutItem[]) => void
}

export interface UseCssGridDashboardResizeReturn {
  /** Bind to the CssGridGrid instance's root element (a component ref's
   *  `.$el`) so this composable can measure the SAME container width the
   *  drag composable does — mirrors useCssGridDashboardDrag.ts's own
   *  `containerRef` exactly, just a SEPARATE ResizeObserver instance pointed
   *  at the same DOM node (see this module's own doc for why a second
   *  observer on one element is an acceptable, low-risk trade here). */
  containerRef: Ref<HTMLElement | null>
  /** The layout to actually feed `<CssGridGrid :layout="...">`: `layout`
   *  itself while nothing is being resized, or the SAME array with only the
   *  resizing item's `w`/`h` swapped to its live (grid-snapped) target. */
  previewLayout: ComputedRef<DashboardLayoutItem[]>
  /** The id currently being resized, or null. */
  resizingId: ComputedRef<string | null>
  /** Whether `id` is currently allowed to start a resize — folds the
   *  grid-wide toggle together with the pinned/collapsed exceptions. */
  isItemResizableNow: (id: string) => boolean
  /** Wire to DashboardCard's `@css-grid-resize-start`. No-op if `id` isn't
   *  currently resizable or isn't found in `layout`. */
  onCardResizeStart: (id: string, clientX: number, clientY: number) => void
  /** Wire to DashboardCard's `@css-grid-resize-move`. Coalesced to at most
   *  once per animation frame, mirroring useCssGridDashboardDrag.ts's own
   *  rAF-coalescing doc. No-op if no resize is in progress. */
  onCardResizeMove: (clientX: number, clientY: number) => void
  /** Wire to DashboardCard's `@css-grid-resize-end`. `committed` mirrors that
   *  event's payload: true for a genuine pointerup (calls `onCommit` with the
   *  settled preview), false for an abort. */
  onCardResizeEnd: (committed: boolean) => void
}

interface ActiveResize {
  id: string
  originX: number
  originW: number
  originH: number
  startX: number
  startY: number
  targetW: number
  targetH: number
}

/**
 * Vue-layer wiring for the F6 stage-3 CSS Grid corner-resize feature —
 * deliberately mirrors useCssGridDashboardDrag.ts's own shape (own container
 * measurement, rAF-coalesced pointer tracking, a pure candidate-then-clamp
 * function it delegates to). The one structural difference: this
 * composable's live `previewLayout` does NOT run resolveOverlaps/compaction
 * on every frame — a resized card is simply allowed to visually overlap its
 * neighbours while the gesture is in flight (identical to grid-layout-plus's
 * own corner-resize handle today), with the real collision/compaction pass
 * only running once at commit time, inside the shared `writeBackLayout` the
 * caller supplies as `onCommit`. This keeps the live-resize feel simple (no
 * siblings jumping around mid-gesture) and avoids a second, parallel
 * reflow implementation to keep in sync with the drag composable's own.
 */
export function useCssGridDashboardResize(
  options: UseCssGridDashboardResizeOptions,
): UseCssGridDashboardResizeReturn {
  const { layout, pinnedIds, collapsedIds, cols, rowHeight, marginX, marginY, resizable, isMobile, onCommit } =
    options

  // --- Container width measurement — mirrors useCssGridDashboardDrag.ts's own
  // ResizeObserver wiring exactly (own observer on the SAME `CssGridGrid` root
  // element the drag composable also measures; a second observer on one
  // element is cheap and keeps the two composables independently testable,
  // same trade-off stage 2 already accepted for gutters vs. drag). ---
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

  function isItemResizableNow(id: string): boolean {
    return isItemResizable(resizable.value, pinnedSet.value.has(id)) && !collapsedIds.value.has(id)
  }

  const active = ref<ActiveResize | null>(null)

  const resizingId = computed(() => active.value?.id ?? null)

  const previewLayout = computed<DashboardLayoutItem[]>(() => {
    const a = active.value
    if (!a) return layout.value
    return layout.value.map((it) => (it.i === a.id ? { ...it, w: a.targetW, h: a.targetH } : it))
  })

  // --- rAF coalescing — identical shape to useCssGridDashboardDrag.ts's own
  // (see that module's doc for why: recomputing the clamp on every raw
  // pointermove would do more work than the screen can even paint). ---
  let pendingPointer: { x: number; y: number } | null = null
  let rafId: number | null = null

  function flushPendingMove(): void {
    rafId = null
    const a = active.value
    const pending = pendingPointer
    if (!a || !pending) return
    const min = minSizeFor(a.id)
    const target = cssGridResizeTarget(
      { x: a.originX, y: 0, w: a.originW, h: a.originH },
      pending.x - a.startX,
      pending.y - a.startY,
      metrics.value,
      min.minW,
      min.minH,
      isMobile.value,
    )
    active.value = { ...a, targetW: target.w, targetH: target.h }
  }

  function cancelPendingFrame(): void {
    if (rafId != null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function onCardResizeStart(id: string, clientX: number, clientY: number): void {
    if (!isItemResizableNow(id)) return
    if (active.value) return // belt-and-braces — a stray second start should never stomp an in-flight resize
    const item = layout.value.find((it) => it.i === id)
    if (!item) return
    active.value = {
      id,
      originX: item.x,
      originW: item.w,
      originH: item.h,
      startX: clientX,
      startY: clientY,
      targetW: item.w,
      targetH: item.h,
    }
  }

  function onCardResizeMove(clientX: number, clientY: number): void {
    if (!active.value) return
    pendingPointer = { x: clientX, y: clientY }
    if (rafId == null) rafId = window.requestAnimationFrame(flushPendingMove)
  }

  function onCardResizeEnd(committed: boolean): void {
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
    resizingId,
    isItemResizableNow,
    onCardResizeStart,
    onCardResizeMove,
    onCardResizeEnd,
  }
}
