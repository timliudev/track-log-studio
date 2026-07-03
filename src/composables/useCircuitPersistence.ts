import { watch } from 'vue'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { circuitKey } from '@/domain/persist/circuitKey'
import { getCircuitSetup, putCircuitSetup, type CircuitSetup } from '@/domain/persist/circuitStore'
import { resolveGeometryToApply } from '@/domain/tracks/schema'

/** Debounce (ms) between the last edit and the idb write, so dragging a gate
 *  or line handle doesn't fire an idb write per animation frame. */
const SAVE_DEBOUNCE_MS = 800

/**
 * Local persistence (DESIGN.md §11 D; docs/CLOUD-TRACK-DESIGN.md §4.2 「流程
 * ①」): auto-restores a circuit's saved start/finish line, sector gates and
 * lap-table columns when a track is geolocated to a previously-saved circuit,
 * and auto-saves those same fields back to idb (debounced) whenever they
 * change. This IS the design doc's "Phase 1 流程①" in full — per §7 第一階段,
 * flow ① (local `PersonalTrackOverlayV1` lookup, highest precedence) was
 * already complete before that doc was written; Phase 1 only needed the
 * schema/shape alignment (see schema.ts). Flow ②（SHARED 庫查詢）and flow's
 * detach affordance (§4.4, meaningful only once a SHARED track exists to
 * detach FROM) are later phases, intentionally not built here.
 *
 * Ownership: `lapStore.line`/`columns` and `sectorStore.gates` remain the
 * SOLE in-memory owners of this state — idb is a mirror, never a second
 * writer. The save side is a watcher that performs external I/O (idb.put),
 * which is fine (unlike a watcher writing into another Pinia store's state,
 * the #9-desync anti-pattern this codebase avoids elsewhere). The restore
 * side never mutates refs directly: it goes through the SAME store actions
 * (`setLine`/`loadDetected`/`addColumn`) that any other caller uses, so a
 * restore is indistinguishable from the user recreating that setup by hand.
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
      // Phase 1 (docs/CLOUD-TRACK-DESIGN.md §7 第一階段): there is no SHARED
      // track library yet, so every saved overlay is a "local override" one —
      // `trackId` stays null and the geometry always lives in
      // `localOverride`, matching pre-v1 behavior exactly (see schema.ts).
      const setup: CircuitSetup = {
        schemaVersion: 1,
        key,
        trackId: null,
        localOverride: { line: lapStore.line, gates: sectorStore.gates },
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
      // §4.2 matching/precedence, scoped to what Phase 1 has — see
      // resolveGeometryToApply's doc comment for the full flow ①/②/③ mapping.
      const geometry = resolveGeometryToApply(saved)
      if (geometry?.line) lapStore.setLine(geometry.line)
      // Restoring from idb is not a manual edit — go through `loadDetected`
      // (not `addGate` per gate) so `sectorStore.edited` stays false and a
      // later auto-re-detect doesn't prompt to confirm overwriting a restore
      // the user hasn't touched yet.
      if (geometry) sectorStore.loadDetected(geometry.gates)
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
