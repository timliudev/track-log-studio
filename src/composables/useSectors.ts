import { watch, type ComputedRef } from 'vue'
import type { Lap } from '@/domain/model/Lap'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { detectCorners, cornerGateLine, pickReferenceLap } from '@/domain/analysis/cornerDetection'
import { cumulativeDistanceM } from '@/domain/analysis/distance'

/**
 * Sector-gate auto-detection wiring: runs corner detection on a reference lap
 * chosen by {@link pickReferenceLap} (fastest among non-excluded laps with a
 * plausible total distance — guards against a broken/partial lap winning on
 * raw time alone) and stages the results as pending suggestions in
 * `sectorStore` for the user to review (accept/reject) before they become
 * confirmed gates. Also clears gates and suggestions on file change — they're
 * keyed to the current recording, same as the start/finish line and lap
 * selection.
 */
export function useSectors(laps: ComputedRef<Lap[]>): { runAutoDetect: () => void } {
  const { session, track } = useActiveSession()
  const lapStore = useLapStore()
  const sectorStore = useSectorStore()

  function runAutoDetect(): void {
    const s = session.value
    const tk = track.value
    if (!s || !tk) return
    const lap = pickReferenceLap(tk, laps.value, lapStore.excluded)
    if (!lap) return
    const { corners } = detectCorners(s, tk, lap.startIdx, lap.endIdx)
    const lapStartM = cumulativeDistanceM(tk.lat, tk.lon, tk.valid)[lap.startIdx]
    sectorStore.setSuggestions(
      corners.map((corner) => ({
        corner,
        line: cornerGateLine(tk, corner),
        lapDistanceM: corner.distanceM - lapStartM,
      })),
    )
  }

  watch(track, (next, prev) => {
    if (prev && next !== prev) sectorStore.clearAll()
  })

  return { runAutoDetect }
}
