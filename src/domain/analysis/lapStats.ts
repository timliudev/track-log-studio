import { haversineM } from '@/domain/export/rc3Nmea/geo'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'

export interface LapStats {
  /** Lap distance in metres. */
  distanceM: number
  /** Peak speed during the lap in km/h (from GPS position/time). */
  topSpeedKmh: number
}

/**
 * Per-lap distance and peak speed from the GPS track. `distanceM` is the
 * cumulative distance at `endIdx` minus at `startIdx` (pass a precomputed
 * cumulative array — e.g. from `cumulativeDistanceM` — to avoid recomputing it
 * per lap). `topSpeedKmh` is the max, over consecutive VALID fixes within the
 * lap span, of the haversine step divided by the time step (m/s → km/h ×3.6).
 *
 * @param cumDistM Per-sample cumulative distance (metres), aligned to samples.
 */
export function lapStats(
  track: GpsTrack,
  timeMs: Float64Array,
  cumDistM: Float64Array,
  lap: Lap,
): LapStats {
  const { lat, lon, valid } = track
  const start = lap.startIdx
  const end = lap.endIdx

  const distanceM =
    end > start && end < cumDistM.length ? cumDistM[end] - cumDistM[start] : 0

  let topMps = 0
  let prev = -1
  for (let i = start; i <= end && i < valid.length; i++) {
    if (!valid[i]) continue
    if (prev >= 0) {
      const dt = (timeMs[i] - timeMs[prev]) / 1000
      if (dt > 0) {
        const stepM = haversineM(lat[prev], lon[prev], lat[i], lon[i])
        const mps = stepM / dt
        if (mps > topMps) topMps = mps
      }
    }
    prev = i
  }

  return { distanceM, topSpeedKmh: topMps * 3.6 }
}
