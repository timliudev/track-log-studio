import { computed, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Breakpoints } from 'grid-layout-plus'
import {
  GRID_COLS,
  defaultLayout,
  loadLayout,
  reconcileLayout,
  saveLayout,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'

/** Below this window width the dashboard collapses to a single, non-draggable
 *  column — same breakpoint used elsewhere in the app for the mobile layout
 *  (App.vue's top-nav↔bottom-nav switch, BottomNav.vue). Mobile deep-work
 *  (#9) is a separate upcoming task; this composable only needs to not
 *  regress the existing single-column mobile flow. */
const MOBILE_BREAKPOINT_PX = 768

/** grid-layout-plus breakpoint thresholds: only `sm` (our MOBILE_BREAKPOINT_PX
 *  cutover) and the one below it (`xs`) actually matter here — `lg`/`md` are
 *  set to the same threshold as `sm` so every desktop width (>= sm) resolves
 *  to the SAME `sm` breakpoint/column count (no separate "medium screen"
 *  reflow the task didn't ask for), while `xs`/`xxs` (< sm) both collapse to
 *  1 column. See `getBreakpointFromWidth`: it picks the highest threshold
 *  strictly below the current width, so width >= 768 -> 'sm', width < 768 ->
 *  'xs' (or 'xxs' at width 0, same 1-column result). */
const BREAKPOINTS: Breakpoints = {
  lg: MOBILE_BREAKPOINT_PX,
  md: MOBILE_BREAKPOINT_PX,
  sm: MOBILE_BREAKPOINT_PX,
  xs: 0,
  xxs: 0,
}
const COLS: Breakpoints = { lg: GRID_COLS, md: GRID_COLS, sm: GRID_COLS, xs: 1, xxs: 1 }

/**
 * #8 — analyzer dashboard grid layout: owns the persisted layout array (see
 * dashboardLayout.ts for the storage shape/reconciliation rules), the
 * responsive desktop↔mobile switch, and the reset-to-default action. Kept as
 * a composable (rather than inline in AnalyzerView) so the view's script
 * stays focused on the analysis wiring — same "one seam per concern" pattern
 * as useTrackHeatmap/useTrackExtrema.
 *
 * Only the wide/desktop 2-D arrangement lives in THIS ref (persisted to
 * dashboardLayout.v1). The mobile single-column ORDER is a separate concern
 * owned by usePanelState (panelState.v1's `mobileOrder`) and assembled into a
 * cols=1 layout by AnalyzerView — the two never cross-contaminate, so
 * reordering on a phone can't corrupt the desktop layout and vice-versa. The
 * `layout` persistence watcher below still hard-guards against writing while
 * on the mobile breakpoint as belt-and-braces (the mobile path never assigns
 * into `layout` anyway).
 *
 * `isLocked` (鎖定布局, useLayoutLock) is an optional grid-wide override: when
 * true, BOTH isDraggable and isResizable go false regardless of breakpoint —
 * folded in here (rather than left to the caller) so every consumer of this
 * composable's isDraggable/isResizable automatically respects the lock.
 */
export function useDashboardLayout(
  chartIds: Ref<number[]> | ComputedRef<number[]>,
  isLocked?: Ref<boolean> | ComputedRef<boolean>,
): {
  layout: Ref<DashboardLayoutItem[]>
  cols: Breakpoints
  breakpoints: Breakpoints
  colNum: ComputedRef<number>
  isMobile: ComputedRef<boolean>
  isDraggable: ComputedRef<boolean>
  isResizable: ComputedRef<boolean>
  resetLayout: () => void
} {
  const layout = ref<DashboardLayoutItem[]>(reconcileLayout(loadLayout(), chartIds.value))

  const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : GRID_COLS * 100)
  function onResize(): void {
    windowWidth.value = window.innerWidth
  }
  onMounted(() => window.addEventListener('resize', onResize))
  onBeforeUnmount(() => window.removeEventListener('resize', onResize))

  // #9 fix — inclusive comparison (`<=`) so this JS breakpoint agrees with
  // every `@media (max-width: 768px)` rule in the app (App.vue's top-nav↔
  // bottom-nav switch, BottomNav.vue, AnalyzerView.vue's pinned-card width
  // and resize-handle sizing): a CSS `max-width: 768px` query MATCHES at
  // exactly 768px, so a strict `<` here disagreed with it at that one exact
  // width — the JS side kept treating a 768px-wide viewport as desktop (12
  // columns, free 2-D drag) while the CSS side had already switched to
  // mobile chrome (BottomNav visible), producing an inconsistent hybrid
  // layout right at that boundary (see #9 in the triage report).
  const isMobile = computed(() => windowWidth.value <= MOBILE_BREAKPOINT_PX)
  // Dragging is available at BOTH breakpoints (#9 revised): desktop = free
  // 2-D drag+resize; mobile = single-column vertical drag-to-REORDER. The
  // card-header handle (`dragAllowFrom=".drag-handle"`) is the same on both,
  // so content interactions never start a drag.
  //
  // Resize is now ALSO available on mobile (task: "手機模式下目前不能調整
  // grid 大小") — a full-width single-column card can't usefully change ITS
  // width (there's only 1 column, so grid-item.vue's own x/w clamping caps
  // any horizontal drag back to w=1), but its HEIGHT is exactly as
  // meaningful to resize as a desktop card's, and interactjs (the drag/resize
  // engine grid-layout-plus uses) already handles touch pointers natively —
  // the only reason mobile resize was off before was this explicit flag, not
  // a technical limitation. AnalyzerView enlarges the resize-handle hit area
  // on narrow viewports so it stays comfortably tappable.
  //
  // `isLocked` (鎖定布局) wins over both when set: locking disables drag AND
  // resize grid-wide regardless of breakpoint, until unlocked again.
  const isDraggable = computed(() => !(isLocked?.value ?? false))
  const isResizable = computed(() => !(isLocked?.value ?? false))

  // Column count driven explicitly by breakpoint (we no longer use the
  // library's `responsive` reflow — the mobile 1-column layout is built by us
  // from the persisted mobileOrder, see AnalyzerView, so the desktop layout
  // ref is never touched by a mobile reflow). 1 column on mobile, GRID_COLS on
  // desktop.
  const colNum = computed(() => (isMobile.value ? 1 : GRID_COLS))

  // Reconcile whenever the SET of chart ids changes (add/remove chart) so a
  // newly added chart gets a default position and a removed chart's stale
  // entry doesn't linger in localStorage forever.
  watch(
    chartIds,
    (ids) => {
      layout.value = reconcileLayout(layout.value, ids)
    },
    { deep: true },
  )

  // Persist on every layout change, but ONLY while on the desktop breakpoint
  // — see the module doc for why the mobile single-column reflow must never
  // be saved as if it were the user's chosen arrangement.
  watch(
    layout,
    (next) => {
      if (!isMobile.value) saveLayout(next)
    },
    { deep: true },
  )

  function resetLayout(): void {
    layout.value = reconcileLayout(defaultLayout(), chartIds.value)
  }

  return {
    layout,
    cols: COLS,
    breakpoints: BREAKPOINTS,
    colNum,
    isMobile,
    isDraggable,
    isResizable,
    resetLayout,
  }
}
