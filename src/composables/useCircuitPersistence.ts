import { ref, watch, type Ref } from 'vue'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { useTrackLibraryStore } from '@/stores/trackLibraryStore'
import { circuitKey } from '@/domain/persist/circuitKey'
import { getCircuitSetup, putCircuitSetup, type CircuitSetup } from '@/domain/persist/circuitStore'
import { resolveMatch, trackDefinitionGeometry, type AppliedGeometry } from '@/domain/tracks/matching'
import type { TrackDefinitionV1 } from '@/domain/tracks/schema'

/** Debounce (ms) between the last edit and the idb write, so dragging a gate
 *  or line handle doesn't fire an idb write per animation frame. */
const SAVE_DEBOUNCE_MS = 800

/**
 * Local persistence (DESIGN.md §11 D) + SHARED-library auto-apply
 * (docs/CLOUD-TRACK-DESIGN.md §4.2「流程①→②→③」): auto-restores a circuit's
 * saved start/finish line, sector gates and lap-table columns when a track is
 * geolocated to a previously-saved circuit OR a SHARED library entry, and
 * auto-saves the personal fields back to idb (debounced) whenever they
 * change.
 *
 * Phase 1 (already complete before this doc existed) covered flow ① in full:
 * a local `PersonalTrackOverlayV1` hit always wins. Phase 2 (this revision)
 * adds flow ② (SHARED library geo-scan when there's no usable local overlay)
 * and flow ③ (no match at all → leave state alone) via `resolveMatch` —
 * `useCircuitPersistence`'s job is unchanged in spirit: turn "what does
 * §4.2 say to apply" into the SAME store actions Phase 1 already used
 * (`setLine`/`loadDetected`/`addColumn`), so a restore/auto-apply is still
 * indistinguishable from the user recreating that setup by hand.
 *
 * The §4.3 "ambiguous, same-venue multiple layouts" case does NOT auto-pick —
 * this composable surfaces it as `ambiguousMatches` (a ref) for the UI to
 * render a picker; nothing is applied until `chooseTrack` (or `dismissAmbiguous`)
 * resolves it. §4.4's explicit detach is `detachFromSharedTrack`.
 *
 * Ownership: `lapStore.line`/`columns` and `sectorStore.gates` remain the
 * SOLE in-memory owners of this state — idb is a mirror, never a second
 * writer. The save side is a watcher that performs external I/O (idb.put),
 * which is fine (unlike a watcher writing into another Pinia store's state,
 * the #9-desync anti-pattern this codebase avoids elsewhere). The restore
 * side never mutates refs directly: it goes through the SAME store actions
 * that any other caller uses.
 */
export function useCircuitPersistence(): {
  /** Non-null while the current track matches 2+ SHARED library entries
   *  (§4.3) — the UI should render a picker; call `chooseTrack` with one of
   *  these or `dismissAmbiguous` to proceed without applying anything. */
  ambiguousMatches: Ref<TrackDefinitionV1[] | null>
  /** Apply one of `ambiguousMatches` (or any SHARED track) and remember the
   *  choice (writes a `PersonalTrackOverlayV1` with this `trackId`, no
   *  `localOverride`) so future loads of this same circuit resolve straight
   *  to flow ① without asking again. */
  chooseTrack: (track: TrackDefinitionV1) => void
  /** Clear the ambiguous-match prompt without applying anything (flow ③-like
   *  outcome for this load — the user can still pick later via the same UI
   *  if it's shown again, e.g. on next file load of the same circuit). */
  dismissAmbiguous: () => void
  /** Currently-applied SHARED track, if the active circuit's overlay is
   *  attached to one with no local override (§4.4 "not detached" state) — the
   *  UI uses this to show which library entry is in effect and offer detach. */
  appliedSharedTrack: Ref<TrackDefinitionV1 | null>
  /** §4.4 explicit detach: copy the currently-applied geometry (whatever its
   *  source) into `localOverride` and clear `trackId`, so this circuit stops
   *  following future SHARED-library updates and reverts to a plain personal
   *  setup — same effect as if the user had drawn it by hand. */
  detachFromSharedTrack: () => void
} {
  const { track } = useActiveSession()
  const lapStore = useLapStore()
  const sectorStore = useSectorStore()
  const trackLibrary = useTrackLibraryStore()

  const ambiguousMatches = ref<TrackDefinitionV1[] | null>(null)
  const appliedSharedTrack = ref<TrackDefinitionV1 | null>(null)

  // The circuit key for the CURRENTLY ACTIVE track, recomputed whenever the
  // track identity changes (file switch). Null when there's no GPS to key by.
  let activeKey: string | null = null
  // trackId currently in effect for activeKey (null if none / local-only),
  // mirrored into the next auto-save so flow ① keeps resolving to it.
  let activeTrackId: string | null = null
  // True once auto-restore has run (or been skipped) for the current track,
  // so the save-side watcher doesn't fire (and overwrite a saved setup with
  // the pre-restore defaults) while restore is still in flight.
  let restoreSettled = false

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleSave(): void {
    if (!activeKey || !restoreSettled) return
    if (saveTimer) clearTimeout(saveTimer)
    const key = activeKey
    const trackId = activeTrackId
    saveTimer = setTimeout(() => {
      const setup: CircuitSetup = {
        schemaVersion: 1,
        key,
        trackId,
        localOverride: { line: lapStore.line, gates: sectorStore.gates },
        columns: lapStore.columns,
        updatedAt: Date.now(),
      }
      void putCircuitSetup(setup)
    }, SAVE_DEBOUNCE_MS)
  }

  function applyGeometry(geometry: AppliedGeometry | null): void {
    if (geometry?.line) lapStore.setLine(geometry.line)
    // Restoring/auto-applying is not a manual edit — go through
    // `loadDetected` (not `addGate` per gate) so `sectorStore.edited` stays
    // false and a later auto-re-detect doesn't prompt to confirm overwriting
    // a restore the user hasn't touched yet.
    if (geometry) sectorStore.loadDetected(geometry.gates)
  }

  function applyColumns(columns: CircuitSetup['columns']): void {
    if (columns.length === 0) return
    for (const col of [...lapStore.columns]) lapStore.removeColumn(col.id)
    for (const col of columns) lapStore.addColumn(col.metric)
  }

  async function restoreFor(key: string): Promise<void> {
    ambiguousMatches.value = null
    appliedSharedTrack.value = null
    const saved = await getCircuitSetup(key)
    // The active track may have changed again while this await was in
    // flight; only apply the restore if it's still for the current circuit.
    if (activeKey !== key) return

    const match = resolveMatch(key, saved, trackLibrary.tracks)
    switch (match.kind) {
      case 'localOverride':
        activeTrackId = saved?.trackId ?? null
        applyGeometry(match.geometry)
        break
      case 'sharedTrack':
        activeTrackId = match.track.id
        appliedSharedTrack.value = match.track
        applyGeometry(match.geometry)
        break
      case 'ambiguous':
        activeTrackId = null
        ambiguousMatches.value = match.candidates
        break
      case 'none':
        activeTrackId = null
        break
    }
    if (saved) applyColumns(saved.columns)
    restoreSettled = true
  }

  /** §4.2 "already applied once" bookkeeping: writes an overlay recording
   *  `trackId` with no `localOverride`, so the NEXT load of this circuit hits
   *  flow ① directly (re-reading the SHARED track by id, picking up any
   *  library update) instead of re-scanning §4.3 candidates every time. */
  function rememberSharedChoice(key: string, trackId: string): void {
    const setup: CircuitSetup = {
      schemaVersion: 1,
      key,
      trackId,
      columns: lapStore.columns,
      updatedAt: Date.now(),
    }
    void putCircuitSetup(setup)
  }

  function chooseTrack(chosen: TrackDefinitionV1): void {
    if (!activeKey) return
    ambiguousMatches.value = null
    appliedSharedTrack.value = chosen
    activeTrackId = chosen.id
    applyGeometry(trackDefinitionGeometry(chosen))
    rememberSharedChoice(activeKey, chosen.id)
  }

  function dismissAmbiguous(): void {
    ambiguousMatches.value = null
  }

  function detachFromSharedTrack(): void {
    if (!activeKey || !appliedSharedTrack.value) return
    appliedSharedTrack.value = null
    activeTrackId = null
    // Freeze the currently-applied geometry into a plain local override —
    // scheduleSave already writes lapStore.line/sectorStore.gates verbatim,
    // so simply clearing activeTrackId + re-triggering a save is sufficient;
    // the geometry itself doesn't need to change (it's already what's live).
    scheduleSave()
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
        ambiguousMatches.value = null
        appliedSharedTrack.value = null
        restoreSettled = true
      }
    },
    { immediate: true },
  )

  // Auto-save: mirror line/gates/columns to idb whenever they change, for the
  // circuit active at the time of the change. Debounced so rapid edits (e.g.
  // dragging a gate handle) collapse into one write. A manual edit after a
  // SHARED auto-apply implicitly detaches (§4.4 "adjust, don't detach" case:
  // the edit is saved as this circuit's localOverride from then on) — but
  // `appliedSharedTrack`/the UI banner stays visible until the user explicitly
  // detaches, since the trackId link itself isn't cleared by an edit alone.
  watch(() => lapStore.line, scheduleSave, { deep: true })
  watch(() => sectorStore.gates, scheduleSave, { deep: true })
  watch(() => lapStore.columns, scheduleSave, { deep: true })

  return { ambiguousMatches, chooseTrack, dismissAmbiguous, appliedSharedTrack, detachFromSharedTrack }
}
