import { type ComputedRef, computed, ref, watch, type Ref } from 'vue'
import { STATIC_CARD_IDS, chartItemId } from '@/domain/layout/dashboardLayout'
import {
  loadPanelState,
  reconcilePanelState,
  savePanelState,
  setMobileOrder as setMobileOrderPure,
  togglePinned as togglePinnedPure,
  toggleCollapsed as toggleCollapsedPure,
  isPinned as isPinnedPure,
  type PanelState,
} from '@/domain/layout/panelState'

/**
 * #9 — owns the analyzer dashboard's per-card collapse/pin state: a sibling
 * composable to useDashboardLayout (position/size) with its own storage key
 * (see panelState.ts's module doc for why it's a separate module). Collapse
 * applies at every breakpoint; pin is a mobile-only affordance but its state
 * is persisted regardless of the current breakpoint, so it "carries across"
 * as the task requires (pin it on mobile, it's still remembered if you later
 * resize/rotate to a wider layout, even though the pin only visually applies
 * at the mobile breakpoint — see AnalyzerView's use of `isPinned`).
 *
 * B111 — `pinnedIds` (below) exposes the full pin-ordered list so
 * AnalyzerView can render the pinned STACK in the right order (first pinned
 * = topmost); `isPinned` became a membership test instead of an equality
 * check against a single id.
 */
export function usePanelState(chartIds: Ref<number[]> | ComputedRef<number[]>): {
  state: Ref<PanelState>
  isCollapsed: (id: string) => boolean
  isPinned: (id: string) => boolean
  pinnedIds: ComputedRef<string[]>
  toggleCollapsed: (id: string) => void
  togglePinned: (id: string) => void
  mobileOrder: ComputedRef<string[]>
  setMobileOrder: (order: string[]) => void
} {
  const state = ref<PanelState>(loadPanelState())

  // Reconcile against the current set of card ids whenever charts are
  // added/removed, same trigger useDashboardLayout uses for its own layout
  // array — keeps a removed chart's collapse/pin entry from lingering in
  // localStorage forever.
  watch(
    chartIds,
    (ids) => {
      const validIds = [...Object.values(STATIC_CARD_IDS), ...ids.map(chartItemId)]
      state.value = reconcilePanelState(state.value, validIds)
    },
    { deep: true, immediate: true },
  )

  watch(
    state,
    (next) => {
      savePanelState(next)
    },
    { deep: true },
  )

  function isCollapsed(id: string): boolean {
    return state.value.collapsed.includes(id)
  }
  function isPinned(id: string): boolean {
    return isPinnedPure(state.value, id)
  }
  function toggleCollapsed(id: string): void {
    state.value = toggleCollapsedPure(state.value, id)
  }
  function togglePinned(id: string): void {
    state.value = togglePinnedPure(state.value, id)
  }

  // B111 — pin-ordered list (index 0 = pinned first = topmost in the stack).
  const pinnedIds = computed(() => state.value.pinnedIds)

  // The reconciled mobile order (see reconcilePanelState — seeded to the full
  // static+chart id order on first load, then kept in sync with add/remove).
  const mobileOrder = computed(() => state.value.mobileOrder)
  function setMobileOrder(order: string[]): void {
    state.value = setMobileOrderPure(state.value, order)
  }

  return {
    state,
    isCollapsed,
    isPinned,
    pinnedIds,
    toggleCollapsed,
    togglePinned,
    mobileOrder,
    setMobileOrder,
  }
}
