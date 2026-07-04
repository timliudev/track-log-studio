import { watch, type ComputedRef } from 'vue'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from '@/domain/analysis/laps'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { detectCorners, cornerGateLine, pickReferenceLap } from '@/domain/analysis/cornerDetection'
import { sortGatesByPosition } from '@/domain/analysis/gateOrder'

/**
 * Sector-gate wiring (A1+A15 redesign): auto-detection runs corner detection
 * on a reference lap chosen by {@link pickReferenceLap} (fastest among
 * non-excluded laps with a plausible total distance — guards against a
 * broken/partial lap winning on raw time alone) and loads the result DIRECTLY
 * into `sectorStore.gates` — no separate suggestion/review step. Also exposes
 * `addGateAtCursor` for manual placement and `reorderGates` to keep gate
 * order meaningful (sector timing/validity depend on order along the lap)
 * after any manual add/remove. Clears gates on file change — they're keyed to
 * the current recording, same as the start/finish line and lap selection.
 */
export function useSectors(laps: ComputedRef<Lap[]>): {
  runAutoDetect: () => void
  addGateAtCursor: (cursorIdx: number | null) => void
  reorderGates: () => void
} {
  const { session, track } = useActiveSession()
  const lapStore = useLapStore()
  const sectorStore = useSectorStore()

  function referenceLap(): Lap | undefined {
    return pickReferenceLap(track.value!, laps.value, lapStore.excluded)
  }

  function runAutoDetect(): void {
    const s = session.value
    const tk = track.value
    if (!s || !tk) return
    const lap = pickReferenceLap(tk, laps.value, lapStore.excluded)
    if (!lap) return
    const { corners } = detectCorners(s, tk, lap.startIdx, lap.endIdx)
    sectorStore.loadDetected(corners.map((corner) => cornerGateLine(tk, corner)))
  }

  /**
   * Add a gate at the current map cursor sample (falls back to the reference
   * lap's midpoint sample when there's no cursor, e.g. the button was clicked
   * without hovering the map first), oriented perpendicular to the local
   * heading like a detected gate (`cornerGateLine` needs a `Corner`-shaped
   * point, so a synthetic one is built from the chosen sample). Re-sorts the
   * set afterward so the new gate lands in its correct sector-order position.
   */
  function addGateAtCursor(cursorIdx: number | null): void {
    const tk = track.value
    if (!tk) return
    const lap = referenceLap()
    let idx = cursorIdx
    if (idx == null || idx < 0 || idx >= tk.valid.length || !tk.valid[idx]) {
      if (!lap) return
      idx = Math.floor((lap.startIdx + lap.endIdx) / 2)
      while (idx < lap.endIdx && !tk.valid[idx]) idx++
      if (!tk.valid[idx]) return
    }
    const gate = cornerGateLine(tk, { index: idx, distanceM: 0, lat: tk.lat[idx], lon: tk.lon[idx], value: 0, prominence: 0 })
    sectorStore.addGate(gate)
    reorderGates()
  }

  /**
   * Re-sort `sectorStore.gates` by lap-relative position along the reference
   * lap (gateOrder.ts) — sector order must follow the direction of travel, so
   * this must run after every add/remove (drags don't change ORDER enough to
   * warrant a re-sort on every frame; a drag that crosses another gate is rare
   * enough to leave for a future manual/re-detect fix rather than resorting
   * on every pointermove).
   */
  function reorderGates(): void {
    const tk = track.value
    const lap = referenceLap()
    if (!tk || !lap) return
    const sorted = sortGatesByPosition(tk, lap, sectorStore.gates, (line: LapLine) => line)
    sectorStore.setGates(sorted)
  }

  watch(track, (next, prev) => {
    if (prev && next !== prev) sectorStore.clearAll()
  })

  return { runAutoDetect, addGateAtCursor, reorderGates }
}
