import { computed, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  detectGutters,
  gutterKey,
  gutterRect,
  applyGutterDrag,
  pxDeltaToColUnits,
  pxDeltaToRowUnits,
  type GridGutter,
  type GridMetrics,
  type GutterRect,
} from '@/domain/layout/gridGutter'
import type { DashboardLayoutItem } from '@/domain/layout/dashboardLayout'

/** A gutter decorated with everything the Vue layer needs to render + hit-test
 *  it: a stable `:key` and its on-screen pixel rect (see gridGutter.ts's
 *  `gutterRect`). */
export interface GutterHandle extends GridGutter {
  key: string
  rect: GutterRect
}

export interface UseGridGuttersOptions {
  /** Cards to detect shared edges between. The CALLER is responsible for
   *  filtering this down to whatever's actually draggable-via-gutter in its
   *  context — same contract gridGutter.ts's `detectGutters` documents.
   *  AnalyzerView passes the visible desktop layout with the currently-
   *  pinned card's placeholder excluded (its slot is an inert Teleport
   *  target, not a real card — see dashboardLayout.ts's `isItemDraggable`
   *  for the equivalent rule on the library's own corner-resize handle). */
  items: Ref<DashboardLayoutItem[]> | ComputedRef<DashboardLayoutItem[]>
  /** Whether gutter dragging is allowed at all right now — false while the
   *  dashboard is locked (useLayoutLock) or on the mobile single-column
   *  breakpoint (isMobile): with only one column there is no side-by-side
   *  pair to have a vertical gutter between, and stacked mobile cards are
   *  already reordered by drag, so a horizontal "shrink the one above to
   *  grow the one below" gesture there would fight that mechanism. When
   *  false, {@link gutters} is always empty and
   *  {@link UseGridGuttersReturn.onGutterPointerDown} is a no-op. */
  enabled: Ref<boolean> | ComputedRef<boolean>
  /** Same three numbers AnalyzerView passes to `<GridLayout>` — see
   *  dashboardLayout.ts's `GRID_COLS`/`GRID_ROW_HEIGHT`/`GRID_MARGIN`, kept
   *  as one shared source so this composable's pixel math can never drift
   *  from the library's own layout. */
  cols: number
  rowHeight: number
  marginX: number
  marginY: number
  /** Called with the FULL new items array (same shape `applyGutterDrag`
   *  returns) whenever a drag moves a shared edge by at least one grid unit.
   *  The caller writes this back through whatever persistence path the
   *  library's own `layout-updated` already uses (mergeLayoutPositions /
   *  activeLayout's setter — see AnalyzerView's `onLayoutUpdated`) so gutter
   *  drags and corner-resize drags persist through the exact same code path
   *  (#1's fix applies here too — this composable itself never touches
   *  localStorage). */
  onChange: (next: DashboardLayoutItem[]) => void
}

export interface UseGridGuttersReturn {
  /** Bind to the element that wraps `<GridLayout>` (must be a positioning
   *  context — `position: relative` — for the gutter overlay's absolutely-
   *  positioned hit-boxes to line up). Its measured width feeds the same
   *  `colWidthPx` formula grid-layout-plus itself uses. */
  containerRef: Ref<HTMLElement | null>
  /** Every currently-draggable gutter, with its hit-box rect in px relative
   *  to `containerRef`. Empty whenever `enabled` is false or the container
   *  hasn't been measured yet. */
  gutters: ComputedRef<GutterHandle[]>
  /** `gutterKey` of the gutter currently mid-drag, or null — lets the
   *  overlay give the active gutter a distinct hover/active style. */
  draggingKey: Ref<string | null>
  /** Wire to a gutter div's `@pointerdown`. */
  onGutterPointerDown: (gutter: GridGutter, event: PointerEvent) => void
}

/**
 * Vue-layer wiring for gridGutter.ts's pure functions (see that module's doc
 * for the "why" — this composable is deliberately thin: it owns DOM
 * measurement (container width via ResizeObserver) and pointer-event
 * plumbing, and delegates every actual decision (which pairs share an edge,
 * how far a drag is allowed to go, how a pixel delta becomes a grid-unit
 * delta) to the pure functions it imports.
 *
 * Drag model: on pointerdown, the items array AT THAT MOMENT is captured
 * (`itemsAtStart`) and the total pixel offset from the down-point is
 * recomputed on every `pointermove` — i.e. each move re-derives the new
 * layout from the ORIGINAL positions plus the TOTAL delta so far, the same
 * "absolute, not incremental" approach grid-layout-plus's own resize uses,
 * rather than accumulating small per-move deltas (which would compound any
 * rounding from `pxDeltaToColUnits`' `Math.round`).
 */
export function useGridGutters(options: UseGridGuttersOptions): UseGridGuttersReturn {
  const { items, enabled, cols, rowHeight, marginX, marginY, onChange } = options

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
    cols,
    rowHeight,
    marginX,
    marginY,
    containerWidthPx: containerWidthPx.value,
  }))

  const gutters = computed<GutterHandle[]>(() => {
    if (!enabled.value || containerWidthPx.value <= 0) return []
    return detectGutters(items.value).map((g) => ({
      ...g,
      key: gutterKey(g),
      rect: gutterRect(g, metrics.value),
    }))
  })

  const draggingKey = ref<string | null>(null)
  // #1 fix — set only while a drag is in progress; onBeforeUnmount below uses
  // this to force-end an in-flight drag (and its window-level listeners, see
  // endDrag's doc) if the component unmounts mid-drag, so a leftover
  // highlight can never survive past the composable's own lifetime either.
  let endActiveDrag: (() => void) | null = null

  function onGutterPointerDown(gutter: GridGutter, event: PointerEvent): void {
    if (!enabled.value) return
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture?.(event.pointerId)
    draggingKey.value = gutterKey(gutter)

    const startX = event.clientX
    const startY = event.clientY
    const itemsAtStart = items.value
    const m = metrics.value
    const pointerId = event.pointerId

    function onMove(e: PointerEvent): void {
      const deltaPx = gutter.orientation === 'vertical' ? e.clientX - startX : e.clientY - startY
      const deltaUnits =
        gutter.orientation === 'vertical' ? pxDeltaToColUnits(deltaPx, m) : pxDeltaToRowUnits(deltaPx, m)
      if (deltaUnits === 0) return
      const next = applyGutterDrag(itemsAtStart, gutter, deltaUnits, m.cols)
      if (next !== itemsAtStart) onChange(next)
    }
    // #1 fix — end the drag's visual state (draggingKey -> null, which drives
    // the `.dragging` class / pink highlight off) UNCONDITIONALLY, exactly
    // once, however the drag ends: a normal pointerup/pointercancel on the
    // ORIGINAL element, OR the leftover-highlight bug's actual trigger — the
    // gutter's own DOM node getting swapped out from under an in-progress
    // drag. `gutters`' v-for is keyed by `orientation:aId:bId`
    // (gutterKey) — every `onChange` call re-derives the layout, which
    // re-derives `gutters`, and if that changes which cards are adjacent
    // (e.g. one side hit its min-size floor and a DIFFERENT neighbour is now
    // edge-to-edge, or the compaction pass this triggers upstream shuffles
    // something), the key this drag started on can stop matching any
    // CURRENT gutter. Vue then unmounts that specific DOM node — events
    // (and pointer capture) aimed at it never arrive again, so a
    // target-only pointerup/pointercancel listener would leave `draggingKey`
    // — and the highlight — stuck at its last value forever. A WINDOW-level
    // listener doesn't depend on any particular element still being in the
    // DOM, so it always fires and this always resolves.
    function endDrag(e: PointerEvent): void {
      if (e.pointerId !== pointerId) return
      target.releasePointerCapture?.(pointerId)
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', endDrag)
      target.removeEventListener('pointercancel', endDrag)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      draggingKey.value = null
      endActiveDrag = null
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', endDrag)
    target.addEventListener('pointercancel', endDrag)
    // Safety-net registrations — see endDrag's doc above.
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
    endActiveDrag = () => endDrag({ pointerId } as PointerEvent)
  }

  onBeforeUnmount(() => endActiveDrag?.())

  return { containerRef, gutters, draggingKey, onGutterPointerDown }
}
