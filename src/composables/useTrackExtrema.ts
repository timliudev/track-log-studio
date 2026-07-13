import { computed, type ComputedRef, type Ref } from 'vue'
import {
  detectChannelExtrema,
  findGlobalChannelExtremum,
  normalizeChannelExtrema,
  formatExtremumValue,
  type ChannelExtremum,
  type NormalizedChannelExtremum,
} from '@/domain/analysis/cornerSpeed'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'

// Re-exported so existing consumers (TrackChannelPanel.vue's `formatExtremumValue`
// import) keep working unchanged — the implementation now lives in the domain
// layer (cornerSpeed.ts) so B33's cross-session marker builder
// (crossSessionExtrema.ts) can share it without a domain->composable dependency.
export { formatExtremumValue }

/** A channel extremum (for the focused lap, or the whole track when no lap
 *  is focused) projected onto the map, normalised for colour. Alias of the
 *  domain layer's `NormalizedChannelExtremum` — kept as a distinct exported
 *  name since this composable is the established Vue-facing API consumers
 *  (TrackMap.vue, TrackChannelPanel.vue) already know. */
export type TrackExtremaMarker = NormalizedChannelExtremum

/**
 * A9: unified track-channel extrema (generalised from the old speed-only
 * corner apexes to ANY channel, min AND/OR max) — extracted from
 * AnalyzerView per the 2026-07-02 architecture audit's suggested seam. This
 * composable has TWO consumers (TrackMap's map markers and
 * TrackChannelPanel's list), which is exactly why it's a composable rather
 * than logic embedded in either panel.
 *
 * Multi-lap rule: extrema are only meaningful for ONE lap (or the whole
 * track) at a time (a numbered marker set doesn't generalise to overlaying
 * several laps' extrema on the same points), so `focusedLap` should resolve
 * to null unless exactly one lap is selected — the caller decides that
 * policy, this composable just consumes whatever single lap (or null) it's
 * given.
 *
 * No-lap fallback: when `focusedLap` is null (no lap selected, or several
 * selected at once), extrema fall back to the FULL TRACK's min/max instead
 * of going empty — a channel-marker reference should always be available,
 * not just when exactly one lap happens to be selected.
 *
 * B6: the whole-track fallback shows ONE marker per requested kind (a single
 * min and/or a single max — see `findGlobalChannelExtremum`), not the
 * multi-peak "corner apex" detection `detectChannelExtrema` does for a
 * focused lap. Running the per-corner peak finder over an entire multi-lap
 * session found a local extremum in every corner of every lap and flooded
 * the map; a single reference pair is what a "whole track" marker should
 * mean. Once a single lap is focused, the original multi-peak behaviour
 * (one marker per corner within that lap) still applies unchanged.
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
  trackExtremaIsLapScoped: ComputedRef<boolean | null>
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
    const tk = track.value
    const ch = trackChannelData.value
    if (!tk || !ch) return null
    // No single lap focused -> fall back to the whole track's range so the
    // marker feature still has a reference instead of going empty (see the
    // "No-lap fallback" doc above).
    const lap = focusedLap.value
    const startIdx = lap ? lap.startIdx : 0
    const endIdx = lap ? lap.endIdx : tk.lat.length

    if (!lap) {
      // B6: whole-track fallback collapses to a single min/max PAIR rather
      // than every local peak across every lap (see the "B6" doc above).
      const result: ChannelExtremum[] = []
      if (markMinima.value) {
        const m = findGlobalChannelExtremum(tk, ch.data, startIdx, endIdx, 'min')
        if (m) result.push(m)
      }
      if (markMaxima.value) {
        const m = findGlobalChannelExtremum(tk, ch.data, startIdx, endIdx, 'max')
        if (m) result.push(m)
      }
      return result.sort((a, b) => a.lapDistanceM - b.lapDistanceM)
    }

    const mins = markMinima.value
      ? detectChannelExtrema(tk, ch.data, startIdx, endIdx, { mode: 'min' })
      : []
    const maxs = markMaxima.value
      ? detectChannelExtrema(tk, ch.data, startIdx, endIdx, { mode: 'max' })
      : []
    return [...mins, ...maxs].sort((a, b) => a.lapDistanceM - b.lapDistanceM)
  })

  // Whether the current `trackExtrema` reflects a single focused lap (true)
  // or the whole-track fallback (false when a channel/marker is active but
  // no single lap is selected). Null mirrors trackExtrema's own null-ness
  // (no channel, no track, or neither marker toggle on) so consumers can
  // tell "nothing to show" apart from "showing the whole track".
  const trackExtremaIsLapScoped = computed<boolean | null>(() => {
    if (trackExtrema.value === null) return null
    return focusedLap.value != null
  })

  // Map markers need a normalised valueFrac (0..1) so the green/red gradient
  // is meaningful regardless of the channel's absolute range — normalised
  // across the CURRENT extrema set only (one lap's, or the whole-track
  // fallback's — see trackExtremaIsLapScoped), never across the whole session
  // when a single lap is focused.
  const mapExtremaMarkers = computed<TrackExtremaMarker[]>(() => normalizeChannelExtrema(trackExtrema.value ?? []))

  // Whether a channel is picked at all — distinguishes TrackChannelPanel's "pick
  // a channel first" hint from its "no track data" hint.
  const trackChannelChosen = computed(() => trackChannelData.value != null)

  return { trackChannelData, trackExtrema, trackExtremaIsLapScoped, mapExtremaMarkers, trackChannelChosen }
}
