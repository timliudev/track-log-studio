import type { LogSession } from '@/domain/model/LogSession'

export interface GpsTrack {
  /** Decimal-degree latitude per sample (0 where no fix). */
  lat: Float64Array
  /** Decimal-degree longitude per sample (0 where no fix). */
  lon: Float64Array
  /** 1 where the sample has a valid GPS fix, else 0. */
  valid: Uint8Array
}

/**
 * Extract a per-sample GPS track in decimal degrees. Mirrors the exporter's fix
 * logic (Rc3NmeaExporter.fixAt): uses GPS_Valid when present, otherwise treats a
 * non-zero coordinate as a fix. Coordinates are combined in Float64 to keep the
 * sub-metre precision that Float32 storage of the raw integer fields preserves.
 */
export function extractGpsTrack(session: LogSession): GpsTrack {
  const n = session.rowCount
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const valid = new Uint8Array(n)

  const cLatDeg = session.get('GPS_Lat_deg')?.data
  const cLatMin = session.get('GPS_Lat_min')?.data
  const cLatMmmm = session.get('GPS_Lat_mmmm')?.data
  const cLatNs = session.get('GPS_Lat_NS')?.data
  const cLonDeg = session.get('GPS_Lon_deg')?.data
  const cLonMin = session.get('GPS_Lon_min')?.data
  const cLonMmmm = session.get('GPS_Lon_mmmm')?.data
  const cLonEw = session.get('GPS_Lon_EW')?.data
  const cValid = session.get('GPS_Valid')?.data

  if (cLatDeg && cLonDeg) {
    const g = (a: Float32Array | undefined, i: number): number =>
      a && !Number.isNaN(a[i]) ? a[i] : 0
    const hasValidity = cValid !== undefined

    for (let i = 0; i < n; i++) {
      const latDeg = Math.trunc(g(cLatDeg, i))
      const latMin = g(cLatMin, i) + g(cLatMmmm, i) / 10000
      const lonDeg = Math.trunc(g(cLonDeg, i))
      const lonMin = g(cLonMin, i) + g(cLonMmmm, i) / 10000

      let ok: boolean
      if (hasValidity) {
        const code = Math.trunc(g(cValid, i))
        ok = code !== 0 && String.fromCharCode(code) === 'A'
      } else {
        ok = latDeg !== 0 || latMin !== 0 || lonDeg !== 0 || lonMin !== 0
      }
      if (!ok) continue

      const ns = cLatNs ? String.fromCharCode(Math.trunc(g(cLatNs, i))) : 'N'
      const ew = cLonEw ? String.fromCharCode(Math.trunc(g(cLonEw, i))) : 'E'
      let la = latDeg + latMin / 60
      if (ns === 'S') la = -la
      let lo = lonDeg + lonMin / 60
      if (ew === 'W') lo = -lo
      lat[i] = la
      lon[i] = lo
      valid[i] = 1
    }
  } else {
    // Fallback: decimal-degree channels produced by nmeaToSession
    const dLat = session.get('GPS_Lat')?.data
    const dLon = session.get('GPS_Lon')?.data
    if (dLat && dLon) {
      for (let i = 0; i < n; i++) {
        const la = dLat[i]
        const lo = dLon[i]
        if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) {
          lat[i] = la
          lon[i] = lo
          valid[i] = 1
        }
      }
    }
  }
  return { lat, lon, valid }
}

/** True if the track has at least one valid fix. */
export function hasGps(track: GpsTrack): boolean {
  return track.valid.some((v) => v === 1)
}
