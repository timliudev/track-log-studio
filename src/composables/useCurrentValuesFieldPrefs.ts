import { type ComputedRef, type Ref, ref, watch } from 'vue'
import {
  loadCurrentValuesFieldPrefs,
  reconcileCurrentValuesFieldPrefs,
  saveCurrentValuesFieldPrefs,
  setCurrentValuesSortMode as setSortModePure,
  toggleFieldHidden as toggleFieldHiddenPure,
  moveFieldInOrder as moveFieldInOrderPure,
  type CurrentValuesFieldPrefs,
  type CurrentValuesSortMode,
} from '@/domain/analysis/currentValuesFieldPrefs'

/**
 * B49 — owns the current-values card's field-arrangement preferences: a
 * sibling composable to `usePanelState`, with its own localStorage key (see
 * `currentValuesFieldPrefs.ts`'s module doc for why it's a separate module
 * from the dashboard-grid panel state).
 *
 * `channelKeys` is the reactive list of the CURRENT session's non-time field
 * keys (in the session's own channel order) — reconciled against on every
 * change so a channel removed (new session loaded) or added doesn't leave a
 * stale/incomplete `hidden`/`order` list behind (mirrors `usePanelState`'s
 * `chartIds` watch).
 */
export function useCurrentValuesFieldPrefs(channelKeys: Ref<string[]> | ComputedRef<string[]>): {
  prefs: Ref<CurrentValuesFieldPrefs>
  setSortMode: (mode: CurrentValuesSortMode) => void
  toggleFieldHidden: (key: string, force?: boolean) => void
  moveFieldUp: (key: string) => void
  moveFieldDown: (key: string) => void
} {
  const prefs = ref<CurrentValuesFieldPrefs>(loadCurrentValuesFieldPrefs())

  watch(
    channelKeys,
    (keys) => {
      prefs.value = reconcileCurrentValuesFieldPrefs(prefs.value, keys)
    },
    { deep: true, immediate: true },
  )

  watch(
    prefs,
    (next) => {
      saveCurrentValuesFieldPrefs(next)
    },
    { deep: true },
  )

  function setSortMode(mode: CurrentValuesSortMode): void {
    prefs.value = setSortModePure(prefs.value, mode)
  }
  function toggleFieldHidden(key: string, force?: boolean): void {
    prefs.value = toggleFieldHiddenPure(prefs.value, key, force)
  }
  function moveFieldUp(key: string): void {
    prefs.value = moveFieldInOrderPure(prefs.value, key, -1)
  }
  function moveFieldDown(key: string): void {
    prefs.value = moveFieldInOrderPure(prefs.value, key, 1)
  }

  return { prefs, setSortMode, toggleFieldHidden, moveFieldUp, moveFieldDown }
}
