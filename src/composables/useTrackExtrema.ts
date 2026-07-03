import { computed, type ComputedRef, type Ref } from 'vue'
import { detectChannelExtrema } from '@/domain/analysis/cornerSpeed'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'

/** A per-lap channel extremum projected onto the map, normalised for colour. */
export interface TrackExtremaMarker {
  lat: number
  lon: number
  value: number
  /** Value normalised within THIS lap's own extrema set (0..1), for the map's green/red gradient. */
  valueFrac: number
  kind: 'min' | 'max'
  /** `value` pre-formatted for display (e.g. next to the marker on TrackMap) —
   *  see {@link formatExtremumValue}. */
  label: string
}

/**
 * Format a channel extremum's value for display (map label / list value).
 * Magnitude-adaptive decimals so both tiny (e.g. G-force ~1.2) and large (e.g.
 * RPM ~8500) channels read sensibly without a fixed, wrong-for-someone
 * precision: < 10 → 2dp, < 100 → 1dp, else whole numbers. Non-finite → em dash.
 * Pure — matches TrackChannelPanel's own `fmtValue` convention so the map
 * label and the side-panel list agree on the same channel's formatting.
 */
export function formatExtremumValue(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return v.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0)
}

/**
 * A9: unified track-channel extrema (generalised from the old speed-only
 * corner apexes to ANY channel, min AND/OR max) — extracted from
 * AnalyzerView per the 2026-07-02 architecture audit's suggested seam. This
 * composable has TWO consumers (TrackMap's map markers and
 * TrackChannelPanel's list), which is exactly why it's a composable rather
 * than logic embedded in either panel.
 *
 * Multi-lap rule: extrema are only meaningful for ONE lap at a time (a
 * numbered marker set doesn't generalise to overlaying several laps' extrema
 * on the same points), so `focusedLap` should resolve to null unless exactly
 * one lap is selected — the caller decides that policy, this composable just
 * consumes whatever single lap (or null) it's given.
 */
export function useTrackExtrema(
  session: Ref<LogSession | null> | ComputedRef<LogSession | null>,
  track: Ref<GpsTrack | null> | ComputedRef<GpsTrack | null>,
  trackChannel: Ref<string | null> | ComputedRef<string | null>,
  focusedLap: Ref<Lap | null> | ComputedRef<Lap | null>,
  markMinima: Ref<boolean> | ComputedRef<boolean>,
  markMaxima: Ref<boolean> | ComputedRef<boolean>,
): {
  trackChannelData: ComputedRef<{ data: Float32Array } | null>
  trackExtrema: ComputedRef<ReturnType<typeof detectChannelExtrema> | null>
  mapExtremaMarkers: ComputedRef<TrackExtremaMarker[]>
  trackChannelChosen: ComputedRef<boolean>
} {
  // Resolved channel DATA for the chosen trackChannel (shared by heatmap norm
  // and extrema) — single lookup, single owner of "is this channel usable".
  const trackChannelData = computed(() => {
    const name = trackChannel.value
    if (!name) return null
    return session.value?.get(name) ?? null
  })

  const trackExtrema = computed(() => {
    if (!markMinima.value && !markMaxima.value) return null
    const lap = focusedLap.value
    const tk = track.value
    const ch = trackChannelData.value
    if (!lap || !tk || !ch) return null
    const mins = markMinima.value
      ? detectChannelExtrema(tk, ch.data, lap.startIdx, lap.endIdx, { mode: 'min' })
      : []
    const maxs = markMaxima.value
      ? detectChannelExtrema(tk, ch.data, lap.startIdx, lap.endIdx, { mode: 'max' })
      : []
    return [...mins, ...maxs].sort((a, b) => a.lapDistanceM - b.lapDistanceM)
  })

  // Map markers need a per-lap-normalised valueFrac (0..1) so the green/red
  // gradient is meaningful regardless of the channel's absolute range —
  // normalised across THIS lap's own extrema set, not the whole session.
  const mapExtremaMarkers = computed<TrackExtremaMarker[]>(() => {
    const extrema = trackExtrema.value
    if (!extrema || extrema.length === 0) return []
    let min = Infinity
    let max = -Infinity
    for (const e of extrema) {
      if (e.value < min) min = e.value
      if (e.value > max) max = e.value
    }
    const span = max - min
    return extrema.map((e) => ({
      lat: e.lat,
      lon: e.lon,
      value: e.value,
      valueFrac: span > 1e-6 ? (e.value - min) / span : 1,
      kind: e.kind,
      label: formatExtremumValue(e.value),
    }))
  })

  // Whether a channel is picked at all — distinguishes TrackChannelPanel's "pick
  // a channel first" hint from its "select exactly one lap" hint.
  const trackChannelChosen = computed(() => trackChannelData.value != null)

  return { trackChannelData, trackExtrema, mapExtremaMarkers, trackChannelChosen }
}
