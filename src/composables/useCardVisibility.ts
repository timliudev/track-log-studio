import { ref, watch, type ComputedRef, type Ref } from 'vue'
import { STATIC_CARD_IDS, chartItemId } from '@/domain/layout/dashboardLayout'
import {
  loadCardVisibilityPrefs,
  saveCardVisibilityPrefs,
  isCardVisible,
  setCardVisible as setCardVisiblePure,
  reconcileCardVisibilityPrefs,
  type CardVisibilityPrefs,
} from '@/domain/layout/cardVisibility'
import { cardHasData, type CardDataContext } from '@/domain/layout/cardDataAvailability'

/**
 * F2 — owns the analyzer dashboard's per-card visibility preference: a
 * sibling composable to usePanelState (collapse/pin) and useDashboardLayout
 * (position/size), same "reconcile against the current id set + persist on
 * change" shape as usePanelState.ts.
 *
 * `dataContext` is supplied by the caller (AnalyzerView) as a small reactive
 * snapshot of the cheap, already-computed signals cardHasData needs (sector
 * gates present, accel segment found, suspension channel wired, drivetrain
 * kind) — this composable doesn't reach into the session/stores itself, it
 * only combines that snapshot with the persisted prefs.
 */
export function useCardVisibility(
  chartIds: Ref<number[]> | ComputedRef<number[]>,
  dataContext: Ref<CardDataContext> | ComputedRef<CardDataContext>,
): {
  state: Ref<CardVisibilityPrefs>
  isVisible: (id: string) => boolean
  setVisible: (id: string, value: boolean) => void
} {
  const state = ref<CardVisibilityPrefs>(loadCardVisibilityPrefs())

  // Reconcile against the current set of card ids whenever charts are
  // added/removed — same trigger usePanelState uses — so a removed chart's
  // explicit show/hide entry doesn't linger in localStorage forever.
  watch(
    chartIds,
    (ids) => {
      const validIds = [...Object.values(STATIC_CARD_IDS), ...ids.map(chartItemId)]
      state.value = reconcileCardVisibilityPrefs(state.value, validIds)
    },
    { deep: true, immediate: true },
  )

  watch(
    state,
    (next) => {
      saveCardVisibilityPrefs(next)
    },
    { deep: true },
  )

  function isVisible(id: string): boolean {
    return isCardVisible(state.value, id, cardHasData(id, dataContext.value))
  }
  function setVisible(id: string, value: boolean): void {
    state.value = setCardVisiblePure(state.value, id, value)
  }

  return { state, isVisible, setVisible }
}
