import { type ComputedRef, ref, watch, type Ref } from 'vue'
import { STATIC_CARD_IDS, chartItemId } from '@/domain/layout/dashboardLayout'
import {
  loadPanelState,
  reconcilePanelState,
  savePanelState,
  togglePinned as togglePinnedPure,
  toggleCollapsed as toggleCollapsedPure,
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
 */
export function usePanelState(chartIds: Ref<number[]> | ComputedRef<number[]>): {
  state: Ref<PanelState>
  isCollapsed: (id: string) => boolean
  isPinned: (id: string) => boolean
  toggleCollapsed: (id: string) => void
  togglePinned: (id: string) => void
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
    return state.value.pinnedId === id
  }
  function toggleCollapsed(id: string): void {
    state.value = toggleCollapsedPure(state.value, id)
  }
  function togglePinned(id: string): void {
    state.value = togglePinnedPure(state.value, id)
  }

  return {
    state,
    isCollapsed,
    isPinned,
    toggleCollapsed,
    togglePinned,
  }
}
