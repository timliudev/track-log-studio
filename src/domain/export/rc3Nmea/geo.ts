/** Geographic helpers, ported from loga2nmea.py. Angles in decimal degrees. */

export const toRadians = (deg: number): number => (deg * Math.PI) / 180
export const toDegrees = (rad: number): number => (rad * 180) / Math.PI

/** Initial bearing from point 1 to point 2, in degrees [0, 360). */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRadians(lat1)
  const phi2 = toRadians(lat2)
  const dlon = toRadians(lon2 - lon1)
  const y = Math.sin(dlon) * Math.cos(phi2)
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dlon)
  const theta = toDegrees(Math.atan2(y, x))
  return (theta + 360) % 360
}

/** Great-circle distance between two points, in metres. */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = 6371000
  const phi1 = toRadians(lat1)
  const phi2 = toRadians(lat2)
  const dphi = toRadians(lat2 - lat1)
  const dlon = toRadians(lon2 - lon1)
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlon / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}
