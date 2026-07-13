import type { GpsTrack } from './gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'
import { cumulativeDistanceM } from './distance'
import { findPeaks } from './signalPeaks'

/** A detected local extremum (minimum or maximum) of some channel along one lap. */
export interface ChannelExtremum {
  /** Sample index (into the session/track's full row range) at the extremum. */
  index: number
  /** Cumulative distance (m) at the extremum, measured from the lap's own start. */
  lapDistanceM: number
  lat: number
  lon: number
  /** Channel value at the extremum (in the channel's own unit). */
  value: number
  /** Topographic prominence (channel unit) that qualified this extremum — see {@link findPeaks}. */
  prominence: number
  /** Which kind of extremum this is — min (a "valley", e.g. a corner apex's
   *  minimum speed) or max (a "peak", e.g. an RPM spike). */
  kind: 'min' | 'max'
}

export interface DetectChannelExtremaOptions {
  /** Which kind of extremum to find: local minima ("valleys") or maxima ("peaks"). */
  mode: 'min' | 'max'
  /**
   * Minimum prominence a value swing must have to count as a real extremum,
   * in the channel's own unit. When omitted, defaults to a fraction of the
   * channel's own value RANGE over the given sample span (see
   * `RELATIVE_PROMINENCE_FRACTION`) — this is what makes the same defaults
   * work sensibly whether the channel is km/h, RPM, °C or G, without a
   * per-channel calibration table. Pass an explicit value to override.
   */
  minProminence?: number
  /**
   * Minimum real-world distance (m) between two accepted extrema. A single
   * physical feature can otherwise fragment into adjacent bumps a few metres
   * apart in noisy sensor data; spacing merges those back into one (the most
   * prominent of the cluster) — mirrors {@link cornerDetection}'s
   * `minSpacingM` NMS idea. Default 15.
   */
  minSpacingM?: number
}

/**
 * Fraction of the channel's value range (max - min) over the sample span used
 * as the default minProminence when the caller doesn't supply one. The
 * original speed-only corner-apex detector used a fixed 8 km/h absolute floor
 * against a roughly 0-100 km/h race span — i.e. ~8% of the channel's own
 * range — so this generalises that same ratio to any channel (RPM, °C, G,
 * ...) instead of a fixed km/h floor.
 */
export const RELATIVE_PROMINENCE_FRACTION = 0.08

export const DEFAULT_MIN_SPACING_M = 15

/**
 * Non-max suppression by real distance: visit candidates most-prominent
 * first, accept a candidate unless it falls within `minSpacingM` of an
 * already-accepted one. Mirrors {@link cornerDetection}'s `suppressNearby`.
 */
function suppressNearby(extrema: ChannelExtremum[], minSpacingM: number): ChannelExtremum[] {
  const bySpacing = [...extrema].sort((a, b) => b.prominence - a.prominence)
  const accepted: ChannelExtremum[] = []
  for (const c of bySpacing) {
    if (accepted.every((a) => Math.abs(a.lapDistanceM - c.lapDistanceM) >= minSpacingM)) {
      accepted.push(c)
    }
  }
  return accepted.sort((a, b) => a.lapDistanceM - b.lapDistanceM)
}

/**
 * Detect local extrema (minima or maxima, per `opts.mode`) of ANY channel
 * within one lap's sample range [startIdx, endIdx), aligned to the full
 * session/track. Maxima use {@link findPeaks} directly; minima negate the
 * signal first (a minimum of `v` is a maximum of `-v`) — the technique
 * RaceChrono-style corner-apex (min speed) detection used, generalised here
 * to any channel and either extremum kind.
 *
 * `minProminence`, when not given, defaults to `RELATIVE_PROMINENCE_FRACTION`
 * of the channel's own value range over [startIdx, endIdx) — so RPM, °C or G
 * channels get a sensible floor without per-channel tuning. Fragmented
 * near-duplicate extrema (sensor noise) are merged via {@link suppressNearby}.
 * Pure; only valid GPS fixes within the range are considered.
 */
export function detectChannelExtrema(
  track: GpsTrack,
  values: ArrayLike<number>,
  startIdx: number,
  endIdx: number,
  opts: DetectChannelExtremaOptions,
): ChannelExtremum[] {
  const { mode, minSpacingM = DEFAULT_MIN_SPACING_M } = opts

  const idxs: number[] = []
  for (let i = startIdx; i < endIdx; i++) {
    if (track.valid[i] && Number.isFinite(values[i])) idxs.push(i)
  }
  if (idxs.length < 3) return []

  let lo = Infinity
  let hi = -Infinity
  for (const i of idxs) {
    const v = values[i]
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = hi - lo
  const minProminence = opts.minProminence ?? Math.max(range * RELATIVE_PROMINENCE_FRACTION, 1e-9)

  // Maxima operate on the raw signal; minima negate it so "local max of -v"
  // finds "local min of v" (same sign flip as detectCornerApexes' negSpeed).
  const sign = mode === 'max' ? 1 : -1
  const signal = new Float64Array(idxs.length)
  for (let k = 0; k < idxs.length; k++) signal[k] = sign * values[idxs[k]]

  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const lapStartDist = fullDist[Math.max(0, Math.min(startIdx, fullDist.length - 1))]

  const peaks = findPeaks(signal, { minProminence })
  const extrema = peaks.map((p): ChannelExtremum => {
    const i = idxs[p.index]
    return {
      index: i,
      lapDistanceM: fullDist[i] - lapStartDist,
      lat: track.lat[i],
      lon: track.lon[i],
      value: sign * p.value,
      prominence: p.prominence,
      kind: mode,
    }
  })

  return suppressNearby(extrema, minSpacingM)
}

/**
 * Find the SINGLE global extremum (min or max) of a channel within
 * [startIdx, endIdx) — no peak-finding, just the one absolute lowest/highest
 * valid sample. Used for the whole-track (no-lap-focused) marker fallback
 * (B6): `detectChannelExtrema`'s per-lap "corner apex" design finds one local
 * peak per corner, which is correct for a single lap but floods the map with
 * a marker per corner of every lap once it's run over an entire multi-lap
 * session — this gives exactly one reference point per requested kind
 * instead. Returns null when there are no valid samples in range.
 */
export function findGlobalChannelExtremum(
  track: GpsTrack,
  values: ArrayLike<number>,
  startIdx: number,
  endIdx: number,
  mode: 'min' | 'max',
): ChannelExtremum | null {
  let bestIdx = -1
  let bestValue = mode === 'max' ? -Infinity : Infinity
  for (let i = startIdx; i < endIdx; i++) {
    if (!track.valid[i] || !Number.isFinite(values[i])) continue
    const v = values[i]
    if (mode === 'max' ? v > bestValue : v < bestValue) {
      bestValue = v
      bestIdx = i
    }
  }
  if (bestIdx < 0) return null
  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const lapStartDist = fullDist[Math.max(0, Math.min(startIdx, fullDist.length - 1))]
  return {
    index: bestIdx,
    lapDistanceM: fullDist[bestIdx] - lapStartDist,
    lat: track.lat[bestIdx],
    lon: track.lon[bestIdx],
    value: bestValue,
    prominence: 0,
    kind: mode,
  }
}

/**
 * Resolve the session's speed channel (km/h), preferring GPS_Speed over
 * Vehicle_Speed — the same fallback used to seed the lap table's default
 * "top speed" column (see `useLaps.ts`). Returns null when neither is present.
 */
export function resolveSpeedChannel(session: LogSession): string | null {
  if (session.has('GPS_Speed')) return 'GPS_Speed'
  if (session.has('Vehicle_Speed')) return 'Vehicle_Speed'
  return null
}

/** A channel extremum normalised for map display (map-ready shape, no Vue
 *  dependency) — `useTrackExtrema.ts`'s `TrackExtremaMarker` re-exports this
 *  type; the composable stays the single Vue-facing name so existing
 *  consumers (TrackMap.vue's prop, TrackChannelPanel.vue) are unaffected. */
export interface NormalizedChannelExtremum {
  lat: number
  lon: number
  value: number
  /** Value normalised within the current extrema set (0..1), for the map's green/red gradient. */
  valueFrac: number
  kind: 'min' | 'max'
  /** `value` pre-formatted for display (e.g. next to the marker on TrackMap). */
  label: string
}

/**
 * Format a channel extremum's value for display (map label / list value).
 * Magnitude-adaptive decimals so both tiny (e.g. G-force ~1.2) and large (e.g.
 * RPM ~8500) channels read sensibly without a fixed, wrong-for-someone
 * precision: < 10 → 2dp, < 100 → 1dp, else whole numbers. Non-finite → em dash.
 */
export function formatExtremumValue(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return v.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0)
}

/**
 * Normalise a set of channel extrema into map-ready markers: `valueFrac` is
 * computed relative to THIS set's own min/max (a degenerate single-value set
 * — zero span — falls back to 1, not NaN), and `label` is pre-formatted via
 * {@link formatExtremumValue}. Pure — shared by `useTrackExtrema.ts` (primary
 * session's own lap/whole-track extrema) and B33's cross-session comparison
 * markers (`crossSessionExtrema.ts`), which each normalise their own file's
 * extrema set independently before merging the resulting marker arrays — a
 * marker's colour gradient must stay meaningful within its own lap's range
 * even when several files' markers are drawn on the same map at once.
 */
export function normalizeChannelExtrema(extrema: ChannelExtremum[]): NormalizedChannelExtremum[] {
  if (extrema.length === 0) return []
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
}
