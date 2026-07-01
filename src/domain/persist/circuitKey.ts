import type { GpsTrack } from '@/domain/analysis/gpsTrack'

/** Rounding grid for the key: ~3 decimal degrees of lat/lon ≈ 100 m at the
 *  equator (111 km per degree / 1000). Two recordings of the *same* circuit
 *  land on the same rounded centroid even with GNSS drift between sessions;
 *  two *different* circuits more than ~100 m apart do not collide. */
const GRID_DECIMALS = 3

/** Matching tolerance in decimal degrees: two centroids within this distance
 *  (per axis) are treated as the same circuit. One grid step (10^-3°, ~100 m)
 *  so a centroid that rounds to an adjacent grid cell near a boundary still
 *  matches. */
export const CIRCUIT_MATCH_TOLERANCE_DEG = 10 ** -GRID_DECIMALS

function round(n: number): number {
  const f = 10 ** GRID_DECIMALS
  return Math.round(n * f) / f
}

/**
 * A stable, deterministic key identifying "the circuit" a session's GPS track
 * was recorded on: the MEDIAN lat/lon of its valid fixes (robust to a few
 * stray/outlier fixes, unlike a mean), rounded to a ~100 m grid so repeat
 * visits to the same track — with ordinary GNSS drift between sessions —
 * produce the identical key. Returns null when the track has no valid GPS fix
 * (no way to geolocate the circuit; callers should skip persistence).
 */
export function circuitKey(track: GpsTrack): string | null {
  const centroid = circuitCentroid(track)
  if (!centroid) return null
  return `${round(centroid.lat).toFixed(GRID_DECIMALS)},${round(centroid.lon).toFixed(GRID_DECIMALS)}`
}

/** The raw (unrounded) median-fix centroid used to derive {@link circuitKey},
 *  also useful for a tolerance-based "is this close enough" match against a
 *  saved key without recomputing from a track. Null when no valid fix exists. */
export function circuitCentroid(track: GpsTrack): { lat: number; lon: number } | null {
  const lats: number[] = []
  const lons: number[] = []
  for (let i = 0; i < track.valid.length; i++) {
    if (track.valid[i]) {
      lats.push(track.lat[i])
      lons.push(track.lon[i])
    }
  }
  if (lats.length === 0) return null
  return { lat: median(lats), lon: median(lons) }
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Parse a `circuitKey()` string back into its lat/lon (for tolerance checks
 *  against a fresh centroid). Returns null if the string isn't a key this
 *  module produced. */
export function parseCircuitKey(key: string): { lat: number; lon: number } | null {
  const parts = key.split(',')
  if (parts.length !== 2) return null
  const lat = Number(parts[0])
  const lon = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

/**
 * Whether two circuit keys should be considered the same circuit: exact
 * string match (the common case — same rounding grid), OR their parsed
 * centroids fall within {@link CIRCUIT_MATCH_TOLERANCE_DEG} on both axes
 * (covers a centroid that lands just across a grid boundary between visits).
 */
export function circuitKeysMatch(a: string, b: string): boolean {
  if (a === b) return true
  const pa = parseCircuitKey(a)
  const pb = parseCircuitKey(b)
  if (!pa || !pb) return false
  return (
    Math.abs(pa.lat - pb.lat) <= CIRCUIT_MATCH_TOLERANCE_DEG &&
    Math.abs(pa.lon - pb.lon) <= CIRCUIT_MATCH_TOLERANCE_DEG
  )
}
