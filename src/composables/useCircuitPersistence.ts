import { watch } from 'vue'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { circuitKey } from '@/domain/persist/circuitKey'
import { getCircuitSetup, putCircuitSetup, type CircuitSetup } from '@/domain/persist/circuitStore'

/** Debounce (ms) between the last edit and the idb write, so dragging a gate
 *  or line handle doesn't fire an idb write per animation frame. */
const SAVE_DEBOUNCE_MS = 800

/**
 * Local persistence (DESIGN.md §11 D): auto-restores a circuit's saved
 * start/finish line, sector gates and lap-table columns when a track is
 * geolocated to a previously-saved circuit, and auto-saves those same fields
 * back to idb (debounced) whenever they change.
 *
 * Ownership: `lapStore.line`/`columns` and `sectorStore.gates` remain the
 * SOLE in-memory owners of this state — idb is a mirror, never a second
 * writer. The save side is a watcher that performs external I/O (idb.put),
 * which is fine (unlike a watcher writing into another Pinia store's state,
 * the #9-desync anti-pattern this codebase avoids elsewhere). The restore
 * side never mutates refs directly: it goes through the SAME store actions
 * (`setLine`/`addGate`/`addColumn`) that any other caller uses, so a restore
 * is indistinguishable from the user recreating that setup by hand.
 */
export function useCircuitPersistence(): void {
  const { track } = useActiveSession()
  const lapStore = useLapStore()
  const sectorStore = useSectorStore()

  // The circuit key for the CURRENTLY ACTIVE track, recomputed whenever the
  // track identity changes (file switch). Null when there's no GPS to key by.
  let activeKey: string | null = null
  // True once auto-restore has run (or been skipped) for the current track,
  // so the save-side watcher doesn't fire (and overwrite a saved setup with
  // the pre-restore defaults) while restore is still in flight.
  let restoreSettled = false

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSave(): void {
    if (!activeKey || !restoreSettled) return
    if (saveTimer) clearTimeout(saveTimer)
    const key = activeKey
    saveTimer = setTimeout(() => {
      const setup: CircuitSetup = {
        key,
        line: lapStore.line,
        gates: sectorStore.gates,
        columns: lapStore.columns,
        updatedAt: Date.now(),
      }
      void putCircuitSetup(setup)
    }, SAVE_DEBOUNCE_MS)
  }

  async function restoreFor(key: string): Promise<void> {
    const saved = await getCircuitSetup(key)
    // The active track may have changed again while this await was in
    // flight; only apply the restore if it's still for the current circuit.
    if (activeKey !== key) return
    if (saved) {
      if (saved.line) lapStore.setLine(saved.line)
      sectorStore.clearGates()
      for (const gate of saved.gates) sectorStore.addGate(gate)
      if (saved.columns.length > 0) {
        for (const col of [...lapStore.columns]) lapStore.removeColumn(col.id)
        for (const col of saved.columns) lapStore.addColumn(col.metric)
      }
    }
    restoreSettled = true
  }

  watch(
    track,
    (next, prev) => {
      if (next === prev) return
      restoreSettled = false
      activeKey = next ? circuitKey(next) : null
      if (activeKey) {
        void restoreFor(activeKey)
      } else {
        // No GPS to key by — nothing to restore; allow saves to no-op (guarded
        // by `activeKey` being null in scheduleSave, so this is just clarity).
        restoreSettled = true
      }
    },
    { immediate: true },
  )

  // Auto-save: mirror line/gates/columns to idb whenever they change, for the
  // circuit active at the time of the change. Debounced so rapid edits (e.g.
  // dragging a gate handle) collapse into one write.
  watch(() => lapStore.line, scheduleSave, { deep: true })
  watch(() => sectorStore.gates, scheduleSave, { deep: true })
  watch(() => lapStore.columns, scheduleSave, { deep: true })
}
