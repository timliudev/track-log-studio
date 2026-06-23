/**
 * ECEF (Earth-Centred Earth-Fixed) → WGS84 geodetic conversion.
 *
 * AiM `.xrk` GPS records store position as u-blox-style ECEF X/Y/Z. We convert
 * to latitude/longitude/altitude using the closed-form Bowring method with
 * WGS84 constants. Inputs are in METRES; outputs are degrees (lat/lon) and
 * metres (alt).
 */

// WGS84 ellipsoid constants.
const A = 6378137.0 // semi-major axis (m)
const F = 1 / 298.257223563 // flattening
const B = A * (1 - F) // semi-minor axis
const E2 = F * (2 - F) // first eccentricity squared
const EP2 = (A * A - B * B) / (B * B) // second eccentricity squared

export interface Lla {
  lat: number // degrees
  lon: number // degrees
  alt: number // metres
}

/**
 * Convert ECEF (metres) to WGS84 geodetic lat/lon/alt. Uses Bowring's
 * closed-form approximation (no iteration), accurate to well under a metre for
 * terrestrial positions.
 */
export function ecefToLla(x: number, y: number, z: number): Lla {
  const lon = Math.atan2(y, x)
  const p = Math.sqrt(x * x + y * y)
  if (p === 0) {
    // Polar singularity.
    const lat = z >= 0 ? Math.PI / 2 : -Math.PI / 2
    return { lat: (lat * 180) / Math.PI, lon: 0, alt: Math.abs(z) - B }
  }
  const theta = Math.atan2(z * A, p * B)
  const sinT = Math.sin(theta)
  const cosT = Math.cos(theta)
  const lat = Math.atan2(z + EP2 * B * sinT * sinT * sinT, p - E2 * A * cosT * cosT * cosT)
  const sinLat = Math.sin(lat)
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat)
  const alt = p / Math.cos(lat) - n
  return {
    lat: (lat * 180) / Math.PI,
    lon: (lon * 180) / Math.PI,
    alt,
  }
}
