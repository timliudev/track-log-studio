import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LapLine } from '@/domain/analysis/laps'
import type { Corner } from '@/domain/analysis/cornerDetection'

/** A pending auto-detected corner, not yet confirmed as a sector gate. */
export interface SectorSuggestion {
  corner: Corner
  line: LapLine
  /** Distance (m) from the reference lap's own start — readable within a
   *  single lap, unlike `corner.distanceM` (session-cumulative). */
  lapDistanceM: number
}

/**
 * Sector gates: confirmed lines the user has accepted (order = sector order,
 * same object shape as the start/finish line so it can reuse the same
 * crossing-detection and drag-handle machinery) plus the pending
 * auto-detected suggestions awaiting review. Transient (in-memory only, like
 * `lapStore.line`) — local persistence is queue item D, not yet built.
 */
export const useSectorStore = defineStore('sector', () => {
  const gates = ref<LapLine[]>([])
  const suggestions = ref<SectorSuggestion[]>([])

  function setSuggestions(list: SectorSuggestion[]): void {
    suggestions.value = list
  }

  function clearSuggestions(): void {
    suggestions.value = []
  }

  /** Accept suggestion `i`: move it from suggestions into confirmed gates. */
  function acceptSuggestion(i: number): void {
    const s = suggestions.value[i]
    if (!s) return
    gates.value = [...gates.value, s.line]
    suggestions.value = suggestions.value.filter((_, k) => k !== i)
  }

  /** Reject suggestion `i`: drop it without adding a gate. */
  function rejectSuggestion(i: number): void {
    suggestions.value = suggestions.value.filter((_, k) => k !== i)
  }

  /** Accept every pending suggestion as a confirmed gate. */
  function acceptAllSuggestions(): void {
    gates.value = [...gates.value, ...suggestions.value.map((s) => s.line)]
    suggestions.value = []
  }

  /** Append a manually-placed gate. */
  function addGate(line: LapLine): void {
    gates.value = [...gates.value, line]
  }

  function removeGate(i: number): void {
    gates.value = gates.value.filter((_, k) => k !== i)
  }

  /** Reposition gate `i` (e.g. after a drag). */
  function setGate(i: number, line: LapLine): void {
    gates.value = gates.value.map((g, k) => (k === i ? line : g))
  }

  function clearGates(): void {
    gates.value = []
  }

  /** Clear both confirmed gates and pending suggestions (e.g. on file change). */
  function clearAll(): void {
    gates.value = []
    suggestions.value = []
  }

  return {
    gates,
    suggestions,
    setSuggestions,
    clearSuggestions,
    acceptSuggestion,
    rejectSuggestion,
    acceptAllSuggestions,
    addGate,
    removeGate,
    setGate,
    clearGates,
    clearAll,
  }
})
