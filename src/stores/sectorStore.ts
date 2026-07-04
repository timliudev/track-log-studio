import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LapLine } from '@/domain/analysis/laps'

/**
 * Sector gates: the SINGLE working set of lines that drives sector timing and
 * lap validity (`sectorTiming.ts` / `sectorValidity.ts`), same object shape
 * as the start/finish line so it reuses the same crossing-detection and
 * drag-handle machinery. Transient (in-memory only, like `lapStore.line`) —
 * mirrored to idb by `useCircuitPersistence.ts`.
 *
 * Redesigned flow (A1+A15): auto-detection loads DIRECTLY into `gates` — no
 * separate accept/reject suggestion-review step. Manual add/remove/drag is
 * always available afterward via the actions below; `edited` tracks whether
 * the user has manually touched the set since the last detect/load/file
 * change, so the UI can confirm before a re-detect clobbers manual work.
 */
export const useSectorStore = defineStore('sector', () => {
  const gates = ref<LapLine[]>([])
  /** True once the user has manually added/removed/dragged a gate since the
   *  last `loadDetected`/`clearAll` (i.e. since gates last came from
   *  auto-detect or a fresh file) — re-detect should confirm before
   *  overwriting when this is true. */
  const edited = ref(false)

  /** Replace the working set with a freshly auto-detected gate list. Detected
   *  gates are immediately usable — no confirm step — and clear `edited`
   *  since this IS the new baseline to compare future manual edits against. */
  function loadDetected(lines: LapLine[]): void {
    gates.value = lines
    edited.value = false
  }

  /** Insert a manually-placed gate. Position within the array doesn't matter
   *  for correctness — callers should re-sort with `sortGatesByPosition`
   *  (gateOrder.ts) afterward — but appending keeps this a plain, cheap
   *  mutation. Marks the set as manually edited. */
  function addGate(line: LapLine): void {
    gates.value = [...gates.value, line]
    edited.value = true
  }

  function removeGate(i: number): void {
    gates.value = gates.value.filter((_, k) => k !== i)
    edited.value = true
  }

  /** Reposition gate `i` (e.g. after a drag). */
  function setGate(i: number, line: LapLine): void {
    gates.value = gates.value.map((g, k) => (k === i ? line : g))
    edited.value = true
  }

  /** Replace the full gate list in one shot (e.g. after re-sorting by
   *  lap-relative position). Does NOT itself mark `edited` — callers that
   *  reorder as a side effect of an edit already set it via the action that
   *  triggered the reorder. */
  function setGates(lines: LapLine[]): void {
    gates.value = lines
  }

  function clearGates(): void {
    gates.value = []
    edited.value = true
  }

  /** Clear the gate set and its edited flag (e.g. on file change) — a fresh
   *  file has no manual edits to protect. */
  function clearAll(): void {
    gates.value = []
    edited.value = false
  }

  return {
    gates,
    edited,
    loadDetected,
    addGate,
    removeGate,
    setGate,
    setGates,
    clearGates,
    clearAll,
  }
})
