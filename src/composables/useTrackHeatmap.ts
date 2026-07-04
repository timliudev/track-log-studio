import { computed, type ComputedRef, type Ref } from 'vue'
import { normalizeChannel } from '@/domain/analysis/trackHeatmap'
import { colormapSwatches, type ColormapId } from '@/domain/analysis/colormap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'

/**
 * Track heatmap (#10/#11, A9-unified): colour the track by the SINGLE chosen
 * trackChannel's value, when trackColorEnabled — extracted from AnalyzerView
 * per the 2026-07-02 architecture audit's suggested seam. Self-contained:
 * only consumer is AnalyzerView's TrackMap prop + its own legend markup.
 */
export function useTrackHeatmap(
  session: Ref<LogSession | null> | ComputedRef<LogSession | null>,
  track: Ref<GpsTrack | null> | ComputedRef<GpsTrack | null>,
  trackChannel: Ref<string | null> | ComputedRef<string | null>,
  trackColormap: Ref<ColormapId> | ComputedRef<ColormapId>,
  trackColorEnabled: Ref<boolean> | ComputedRef<boolean>,
): {
  heatNorm: ComputedRef<ReturnType<typeof normalizeChannel> | null>
  colorValues: ComputedRef<Float64Array | null>
  legendGradient: ComputedRef<string>
  fmtVal: (v: number) => string
} {
  // Resolved channel DATA for the chosen trackChannel — own lookup (mirrors
  // useTrackExtrema's), so this composable stays independently usable without
  // relying on the extrema composable's internal state.
  const trackChannelData = computed(() => {
    const name = trackChannel.value
    if (!name) return null
    return session.value?.get(name) ?? null
  })

  // Normalise the chosen channel over the track (null when colouring is off,
  // no channel chosen, or the channel/track is absent).
  const heatNorm = computed(() => {
    const tk = track.value
    const ch = trackChannelData.value
    if (!trackColorEnabled.value || !tk || !ch) return null
    return normalizeChannel(ch.data, tk.valid)
  })
  const colorValues = computed(() => heatNorm.value?.norm ?? null)

  // Legend: a CSS gradient of the active colormap + the channel's min/max.
  const legendGradient = computed(
    () => `linear-gradient(to right, ${colormapSwatches(trackColormap.value, 16).join(',')})`,
  )

  // Compact value label for the legend ends — fewer decimals as magnitude grows.
  function fmtVal(v: number): string {
    if (!Number.isFinite(v)) return '—'
    const a = Math.abs(v)
    return v.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0)
  }

  return { heatNorm, colorValues, legendGradient, fmtVal }
}
