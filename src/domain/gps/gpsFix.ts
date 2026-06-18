import type { LogSession } from '@/domain/model/LogSession'

/**
 * A resolved GPS fix for one sample: decimal degrees (latDd/lonDd) plus the
 * degree/minute decomposition NMEA $GPGGA/$GPRMC sentences need.
 */
export interface GpsFix {
  latDeg: number
  latMin: number
  latNs: string
  lonDeg: number
  lonMin: number
  lonEw: string
  latDd: number
  lonDd: number
}

export interface FixResolver {
  /** True if the session carries GPS position channels at all. */
  readonly hasPosition: boolean
  /** The fix at row i, or null if that row has no valid fix. */
  fixAt(i: number): GpsFix | null
}

/** Read a Float32 cell as a number; NaN / missing → 0. */
function cell(a: Float32Array | undefined, i: number): number {
  return a && !Number.isNaN(a[i]) ? a[i] : 0
}

/** Decompose a signed decimal degree into deg + minutes + hemisphere. */
function decompose(
  dd: number,
  pos: string,
  neg: string,
): { deg: number; min: number; hemi: string } {
  const abs = Math.abs(dd)
  const deg = Math.trunc(abs)
  return { deg, min: (abs - deg) * 60, hemi: dd < 0 ? neg : pos }
}

/**
 * Single source of truth for turning a session's GPS channels into per-row
 * decimal-degree fixes. Both the analyzer track ({@link extractGpsTrack}) and
 * the .nmea exporter consume this so the fix logic lives in exactly one place.
 *
 * Two coordinate encodings are recognised (checked in this order):
 *  1. Integer deg/min/mmmm + NS/EW, optionally gated by GPS_Valid='A' — aRacer
 *     Super2 / SuperX / RaceAMP firmware.
 *  2. Decimal degrees in GPS_Lat / GPS_Lon — NMEA import, and the MX APP phone
 *     log (Phone_GPS_Latitude/Longitude resolve here via canonical aliases).
 * A fix is "valid" when GPS_Valid says so (encoding 1, when present) or, with no
 * validity flag, when the coordinate is non-zero.
 */
export function makeFixResolver(session: LogSession): FixResolver {
  const cLatDeg = session.get('GPS_Lat_deg')?.data
  const cLonDeg = session.get('GPS_Lon_deg')?.data

  // Encoding 1: integer degrees/minutes (aRacer ECU firmware).
  if (cLatDeg && cLonDeg) {
    const cLatMin = session.get('GPS_Lat_min')?.data
    const cLatMmmm = session.get('GPS_Lat_mmmm')?.data
    const cLatNs = session.get('GPS_Lat_NS')?.data
    const cLonMin = session.get('GPS_Lon_min')?.data
    const cLonMmmm = session.get('GPS_Lon_mmmm')?.data
    const cLonEw = session.get('GPS_Lon_EW')?.data
    const cValid = session.get('GPS_Valid')?.data
    const hasValidity = cValid !== undefined

    return {
      hasPosition: true,
      fixAt(i): GpsFix | null {
        const latDeg = Math.trunc(cell(cLatDeg, i))
        const latMin = cell(cLatMin, i) + cell(cLatMmmm, i) / 10000
        const lonDeg = Math.trunc(cell(cLonDeg, i))
        const lonMin = cell(cLonMin, i) + cell(cLonMmmm, i) / 10000

        let valid: boolean
        if (hasValidity) {
          const code = Math.trunc(cell(cValid, i))
          valid = code !== 0 && String.fromCharCode(code) === 'A'
        } else {
          valid = latDeg !== 0 || latMin !== 0 || lonDeg !== 0 || lonMin !== 0
        }
        if (!valid) return null

        const latNs = cLatNs ? String.fromCharCode(Math.trunc(cell(cLatNs, i))) : 'N'
        const lonEw = cLonEw ? String.fromCharCode(Math.trunc(cell(cLonEw, i))) : 'E'
        let latDd = latDeg + latMin / 60
        if (latNs === 'S') latDd = -latDd
        let lonDd = lonDeg + lonMin / 60
        if (lonEw === 'W') lonDd = -lonDd
        return { latDeg, latMin, latNs, lonDeg, lonMin, lonEw, latDd, lonDd }
      },
    }
  }

  // Encoding 2: decimal degrees (NMEA import, MX APP phone GPS).
  const dLat = session.get('GPS_Lat')?.data
  const dLon = session.get('GPS_Lon')?.data
  if (dLat && dLon) {
    return {
      hasPosition: true,
      fixAt(i): GpsFix | null {
        const latDd = dLat[i]
        const lonDd = dLon[i]
        if (!Number.isFinite(latDd) || !Number.isFinite(lonDd)) return null
        if (latDd === 0 && lonDd === 0) return null
        const la = decompose(latDd, 'N', 'S')
        const lo = decompose(lonDd, 'E', 'W')
        return {
          latDeg: la.deg,
          latMin: la.min,
          latNs: la.hemi,
          lonDeg: lo.deg,
          lonMin: lo.min,
          lonEw: lo.hemi,
          latDd,
          lonDd,
        }
      },
    }
  }

  return { hasPosition: false, fixAt: () => null }
}
