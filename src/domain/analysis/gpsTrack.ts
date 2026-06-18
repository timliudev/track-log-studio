import type { LogSession } from '@/domain/model/LogSession'
import { makeFixResolver } from '@/domain/gps/gpsFix'

export interface GpsTrack {
  /** Decimal-degree latitude per sample (0 where no fix). */
  lat: Float64Array
  /** Decimal-degree longitude per sample (0 where no fix). */
  lon: Float64Array
  /** 1 where the sample has a valid GPS fix, else 0. */
  valid: Uint8Array
}

/**
 * Extract a per-sample GPS track in decimal degrees from the shared GPS fix
 * resolver ({@link makeFixResolver}) — the single source of fix logic shared
 * with the .nmea exporter. Handles both the integer deg/min ECU encoding and
 * the decimal-degree encoding (NMEA import, MX APP phone GPS). Coordinates are
 * kept in Float64 to preserve sub-metre precision.
 */
export function extractGpsTrack(session: LogSession): GpsTrack {
  const n = session.rowCount
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const valid = new Uint8Array(n)

  const resolver = makeFixResolver(session)
  if (resolver.hasPosition) {
    for (let i = 0; i < n; i++) {
      const fix = resolver.fixAt(i)
      if (!fix) continue
      lat[i] = fix.latDd
      lon[i] = fix.lonDd
      valid[i] = 1
    }
  }
  return { lat, lon, valid }
}

/** True if the track has at least one valid fix. */
export function hasGps(track: GpsTrack): boolean {
  return track.valid.some((v) => v === 1)
}
