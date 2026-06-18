import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'

export interface LapStats {
  /** Lap distance in metres. */
  distanceM: number
  /** Peak speed during the lap in km/h, or NaN when no speed channel exists. */
  topSpeedKmh: number
}

/**
 * Per-lap distance and peak speed. `distanceM` is the cumulative distance at
 * `endIdx` minus at `startIdx` (pass a precomputed cumulative array — e.g. from
 * `cumulativeDistanceM` — to avoid recomputing it per lap).
 *
 * `topSpeedKmh` is the max of `speedKmh` over [lap.startIdx, lap.endIdx]
 * ignoring NaN. The caller resolves the real speed channel once (GPS_Speed →
 * Vehicle_Speed) and passes its samples already in km/h; when no such channel
 * exists it passes `null` and `topSpeedKmh` is NaN (callers should render '—').
 *
 * `_track` and `_timeMs` are retained positionally (callers still pass them and
 * future stats may need them) but are unused now that speed comes from a real
 * channel rather than GPS deltas.
 *
 * @param cumDistM Per-sample cumulative distance (metres), aligned to samples.
 * @param speedKmh Per-sample speed in km/h (e.g. GPS_Speed.data), or null.
 */
export function lapStats(
  _track: GpsTrack,
  _timeMs: Float64Array,
  cumDistM: Float64Array,
  speedKmh: Float32Array | null,
  lap: Lap,
): LapStats {
  const start = lap.startIdx
  const end = lap.endIdx

  const distanceM =
    end > start && end < cumDistM.length ? cumDistM[end] - cumDistM[start] : 0

  let topSpeedKmh = NaN
  if (speedKmh) {
    const hi = Math.min(end, speedKmh.length - 1)
    for (let i = start; i <= hi; i++) {
      const v = speedKmh[i]
      if (!Number.isNaN(v) && (Number.isNaN(topSpeedKmh) || v > topSpeedKmh)) {
        topSpeedKmh = v
      }
    }
  }

  return { distanceM, topSpeedKmh }
}
