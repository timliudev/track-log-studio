import { watch, type ComputedRef, type Ref } from 'vue'
import type { Lap } from '@/domain/model/Lap'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import {
  detectSectorGates,
  shouldAutoDetectSectorGates,
  type CircuitGeometryOrigin,
} from '@/domain/analysis/sectorAutoDetection'

/**
 * Populate sector gates once for a fresh circuit after persistence and track-
 * library matching have both settled. This lives at the analyzer root rather
 * than in SectorPanel so collapsing/remounting a card cannot trigger detection.
 */
export function useSectorAutoPopulate(
  laps: ComputedRef<Lap[]>,
  geometryOrigin: Ref<CircuitGeometryOrigin>,
  restoreEpoch: Ref<number>,
): void {
  const { session, track } = useActiveSession()
  const lapStore = useLapStore()
  const sectorStore = useSectorStore()
  let attemptedEpoch = -1

  watch(
    [
      restoreEpoch,
      geometryOrigin,
      () => lapStore.line,
      () => sectorStore.gates.length,
      () => sectorStore.edited,
      laps,
    ],
    () => {
      const epoch = restoreEpoch.value
      if (attemptedEpoch === epoch) return
      if (!shouldAutoDetectSectorGates({
        hasStartFinishLine: lapStore.line != null,
        gateCount: sectorStore.gates.length,
        geometryOrigin: geometryOrigin.value,
        userEdited: sectorStore.edited,
      })) return

      const gates = detectSectorGates(session.value, track.value, laps.value, lapStore.excluded)
      // Laps can settle one reactive flush after the circuit restore. Keep the
      // epoch eligible until a plausible reference lap actually exists.
      if (gates === null) return
      attemptedEpoch = epoch
      sectorStore.loadDetected(gates)
    },
    { immediate: true, flush: 'post' },
  )
}
