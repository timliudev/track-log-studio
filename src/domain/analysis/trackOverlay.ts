import type { GpsTrack } from './gpsTrack'

/**
 * Multi-file track-map overlay (賽道地圖多檔疊圖): the shape a track map draws
 * for one OTHER loaded session's racing line, alongside the active session's
 * own (full-resolution, undecimated) track. See TrackMap.vue's `overlayTracks`
 * prop and `useTrackOverlay.ts`, which builds these from fileStore.
 */
export interface TrackOverlayEntry {
  /** fileStore file id — stable identity across toggles/reorders. */
  id: number
  /** Display label (the imported file's name). */
  label: string
  /** Per-session identity color (see domain/analysis/colorPalette.ts). */
  color: string
  /** Decimated (see {@link decimateGpsTrack}) GPS track to draw. */
  track: GpsTrack
}

/** Point cap applied to every OVERLAY track before it's stroked (the active
 *  session's own track is never decimated — this only bounds the cost of
 *  drawing N *additional* full-lap polylines at once, which is what actually
 *  scales with the number of overlaid sessions). Generous enough that a
 *  track's shape (corners, straights) reads cleanly on a small map; see
 *  decimateGpsTrack's doc for why a plain stride subsample (not LTTB) is used. */
export const OVERLAY_MAX_POINTS = 1000

/**
 * Uniformly stride-decimate a GPS track down to at most `maxPoints` samples,
 * for cheap rendering of BACKGROUND overlay tracks (other loaded sessions
 * drawn for visual comparison only — no cursor/hit-testing ever touches
 * these). Unlike `downsample.ts`'s LTTB (built for a single-valued function
 * of one monotonic axis, e.g. a time-series chart), a racing line has no such
 * axis to bucket by — it's a closed 2D curve — so a fixed-stride subsample is
 * enough: only the overall SHAPE needs to survive, not per-sample fidelity.
 * Always keeps the first and last sample so the polyline's extent is
 * preserved. A no-op (returns the input unchanged) when already within budget.
 */
export function decimateGpsTrack(track: GpsTrack, maxPoints: number): GpsTrack {
  const n = track.lat.length
  if (maxPoints < 2 || n <= maxPoints) return track

  const lat = new Float64Array(maxPoints)
  const lon = new Float64Array(maxPoints)
  const valid = new Uint8Array(maxPoints)
  const stride = (n - 1) / (maxPoints - 1)
  for (let i = 0; i < maxPoints; i++) {
    const idx = i === maxPoints - 1 ? n - 1 : Math.round(i * stride)
    lat[i] = track.lat[idx]
    lon[i] = track.lon[idx]
    valid[i] = track.valid[idx]
  }
  return { lat, lon, valid }
}
