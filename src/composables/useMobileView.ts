import { type ComputedRef, computed, ref, watch, type Ref } from 'vue'
import { STATIC_CARD_IDS, chartItemId } from '@/domain/layout/dashboardLayout'
import {
  loadMobileView,
  saveMobileView,
  reconcileMobileView,
  setMode as setModePure,
  setFocusOrder as setFocusOrderPure,
  resolveFocusStackOrder,
  weightFor as weightForPure,
  setSplitWeight as setSplitWeightPure,
  type MobileViewState,
} from '@/domain/layout/mobileView'

/**
 * F1 — owns the analyzer dashboard's mobile Focus Stack device preference: a
 * sibling composable to useCardVisibility (per-card show/hide) and
 * usePanelState (collapse/pin/mobile order), same "reconcile against the
 * current id set + persist on change" shape as both of those.
 */
export function useMobileView(chartIds: Ref<number[]> | ComputedRef<number[]>): {
  state: Ref<MobileViewState>
  mode: ComputedRef<MobileViewState['mode']>
  setMode: (mode: MobileViewState['mode']) => void
  focusOrder: ComputedRef<string[]>
  setFocusOrder: (order: string[]) => void
  focusStackIds: (visibleIdsInDefaultOrder: string[]) => string[]
  weightFor: (id: string, fallback?: number) => number
  setWeight: (id: string, weight: number) => void
} {
  const state = ref<MobileViewState>(loadMobileView())

  // Reconcile against the current set of card ids whenever charts are
  // added/removed — same trigger useCardVisibility/usePanelState use — so a
  // removed chart's focusOrder/splitWeights entry doesn't linger in
  // localStorage forever.
  watch(
    chartIds,
    (ids) => {
      const validIds = [...Object.values(STATIC_CARD_IDS), ...ids.map(chartItemId)]
      state.value = reconcileMobileView(state.value, validIds)
    },
    { deep: true, immediate: true },
  )

  watch(
    state,
    (next) => {
      saveMobileView(next)
    },
    { deep: true },
  )

  const mode = computed(() => state.value.mode)
  function setMode(next: MobileViewState['mode']): void {
    state.value = setModePure(state.value, next)
  }

  const focusOrder = computed(() => state.value.focusOrder)
  function setFocusOrder(order: string[]): void {
    state.value = setFocusOrderPure(state.value, order)
  }

  function focusStackIds(visibleIdsInDefaultOrder: string[]): string[] {
    return resolveFocusStackOrder(visibleIdsInDefaultOrder, state.value.focusOrder)
  }

  function weightFor(id: string, fallback = 1): number {
    return weightForPure(state.value, id, fallback)
  }

  // F1 phase 2 — persists a panel's draggable-divider height weight
  // (MobileFocusStack's `resize` emit calls this once per neighbour on drag
  // end). Invalid weights are silently dropped by setSplitWeightPure, same
  // permissive contract every other setter here has.
  function setWeight(id: string, weight: number): void {
    state.value = setSplitWeightPure(state.value, id, weight)
  }

  return { state, mode, setMode, focusOrder, setFocusOrder, focusStackIds, weightFor, setWeight }
}
