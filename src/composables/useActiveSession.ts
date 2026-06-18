import { computed, type ComputedRef } from 'vue'
import { useFileStore } from '@/stores/fileStore'
import { useSuspensionStore } from '@/stores/suspensionStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { applyDerivedChannels } from '@/domain/units/suspension'
import { extractGpsTrack, type GpsTrack } from '@/domain/analysis/gpsTrack'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { timeSeconds } from '@/domain/analysis/timeAxis'
import type { LogSession } from '@/domain/model/LogSession'

/**
 * The analyzer's active log (chosen in the analyzer, sourced from the shared
 * fileStore) augmented with calibrated suspension channels, plus its GPS track
 * and time/distance axes. All computed/cached and recomputed on change.
 */
export function useActiveSession(): {
  session: ComputedRef<LogSession | null>
  track: ComputedRef<GpsTrack | null>
  xValues: ComputedRef<Float64Array | null>
} {
  const fileStore = useFileStore()
  const susp = useSuspensionStore()
  const analyzer = useAnalyzerStore()

  const session = computed<LogSession | null>(() => {
    const id = analyzer.activeFileId
    if (id == null) return null
    const s = fileStore.getSession(id)
    return s ? applyDerivedChannels(s, susp.config) : null
  })

  const track = computed<GpsTrack | null>(() =>
    session.value ? extractGpsTrack(session.value) : null,
  )

  const time = computed<Float64Array | null>(() =>
    session.value ? timeSeconds(session.value) : null,
  )

  const distance = computed<Float64Array | null>(() =>
    track.value
      ? cumulativeDistanceM(track.value.lat, track.value.lon, track.value.valid)
      : null,
  )

  const xValues = computed<Float64Array | null>(() =>
    analyzer.xAxis === 'distance' ? distance.value : time.value,
  )

  return { session, track, xValues }
}
