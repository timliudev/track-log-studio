import { haversineM } from '@/domain/export/rc3Nmea/geo'

/**
 * Cumulative travelled distance (metres) per sample, from the GPS track.
 * Distance only advances between valid fixes; invalid samples carry the last
 * accumulated value so the array stays aligned with the sample index.
 */
export function cumulativeDistanceM(
  lat: Float64Array,
  lon: Float64Array,
  valid: Uint8Array,
): Float64Array {
  const n = lat.length
  const dist = new Float64Array(n)
  let acc = 0
  let prev = -1
  for (let i = 0; i < n; i++) {
    if (valid[i]) {
      if (prev >= 0) acc += haversineM(lat[prev], lon[prev], lat[i], lon[i])
      prev = i
    }
    dist[i] = acc
  }
  return dist
}
