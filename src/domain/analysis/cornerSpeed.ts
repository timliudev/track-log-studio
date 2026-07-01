import type { GpsTrack } from './gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'
import { cumulativeDistanceM } from './distance'
import { findPeaks } from './signalPeaks'

/** A detected corner apex (speed minimum) along one lap. */
export interface CornerApex {
  /** Sample index (into the session/track's full row range) at the apex. */
  index: number
  /** Cumulative distance (m) at the apex, measured from the lap's own start. */
  lapDistanceM: number
  lat: number
  lon: number
  /** Speed (km/h) at the apex — the corner's minimum speed. */
  speedKmh: number
  /** Topographic prominence (km/h) that qualified this dip — see {@link findPeaks}. */
  prominence: number
}

export interface DetectCornerApexesOptions {
  /** Minimum prominence (km/h) a speed dip must have to count as a corner. Default 8. */
  minProminenceKmh?: number
  /**
   * Minimum real-world distance (m) between two accepted apexes. A single
   * physical corner can otherwise fragment into adjacent dips a few metres
   * apart in noisy GPS speed; spacing merges those back into one apex (the
   * most prominent of the cluster) — mirrors {@link cornerDetection}'s
   * `minSpacingM` NMS idea. Default 15.
   */
  minSpacingM?: number
}

// Calibrated 2026-07-02 as a starting point (not yet proven universal — same
// caveat as CURVATURE_DEFAULTS in cornerDetection.ts). GPS speed is noisier
// sample-to-sample than curvature, so the prominence floor is in km/h, not a
// tiny fraction of the signal's range.
export const CORNER_SPEED_DEFAULTS: Required<DetectCornerApexesOptions> = {
  minProminenceKmh: 8,
  minSpacingM: 15,
}

/**
 * Non-max suppression by real distance: visit candidates most-prominent
 * first, accept a candidate unless it falls within `minSpacingM` of an
 * already-accepted one. Mirrors {@link cornerDetection}'s `suppressNearby`.
 */
function suppressNearby(apexes: CornerApex[], minSpacingM: number): CornerApex[] {
  const bySpacing = [...apexes].sort((a, b) => b.prominence - a.prominence)
  const accepted: CornerApex[] = []
  for (const c of bySpacing) {
    if (accepted.every((a) => Math.abs(a.lapDistanceM - c.lapDistanceM) >= minSpacingM)) {
      accepted.push(c)
    }
  }
  return accepted.sort((a, b) => a.lapDistanceM - b.lapDistanceM)
}

/**
 * Detect corner apexes (speed minima) within one lap's sample range
 * [startIdx, endIdx), from a speed channel (km/h) aligned to the full
 * session/track. Reuses {@link findPeaks} on the NEGATED speed signal — a
 * minimum of speed is a maximum of -speed — with a prominence threshold so
 * straights and sample-to-sample GPS noise don't register as corners, then
 * merges GPS-noise-fragmented dips via {@link suppressNearby}. Pure; only
 * valid GPS fixes within the range are considered.
 */
export function detectCornerApexes(
  track: GpsTrack,
  speed: ArrayLike<number>,
  startIdx: number,
  endIdx: number,
  opts: DetectCornerApexesOptions = {},
): CornerApex[] {
  const { minProminenceKmh, minSpacingM } = { ...CORNER_SPEED_DEFAULTS, ...opts }

  const idxs: number[] = []
  for (let i = startIdx; i < endIdx; i++) {
    if (track.valid[i] && Number.isFinite(speed[i])) idxs.push(i)
  }
  if (idxs.length < 3) return []

  const negSpeed = new Float64Array(idxs.length)
  for (let k = 0; k < idxs.length; k++) negSpeed[k] = -speed[idxs[k]]

  const fullDist = cumulativeDistanceM(track.lat, track.lon, track.valid)
  const lapStartDist = fullDist[Math.max(0, Math.min(startIdx, fullDist.length - 1))]

  const peaks = findPeaks(negSpeed, { minProminence: minProminenceKmh })
  const apexes = peaks.map((p): CornerApex => {
    const i = idxs[p.index]
    return {
      index: i,
      lapDistanceM: fullDist[i] - lapStartDist,
      lat: track.lat[i],
      lon: track.lon[i],
      speedKmh: -p.value,
      prominence: p.prominence,
    }
  })

  return suppressNearby(apexes, minSpacingM)
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
