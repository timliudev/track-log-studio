import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import { toRadians } from '@/domain/export/rc3Nmea/geo'

/** A start/finish line as two geographic endpoints (lat/lon decimal degrees). */
export interface LapLine {
  a: { lat: number; lon: number }
  b: { lat: number; lon: number }
}

export interface DetectLapsOptions {
  /** Ignore crossings closer together than this (debounce), default 5000 ms. */
  minLapMs?: number
  /** If set, only count crossings in one direction (sign of the 2D cross
   *  product of the line direction and the track-segment direction). Default:
   *  count crossings in whichever direction is most common (auto), so the line
   *  orientation the user draws doesn't matter. */
  direction?: 1 | -1
}

/** A raw start/finish crossing: boundary sample index, time and direction sign. */
interface Crossing {
  /** Sample index of the second point of the crossing segment (lap boundary). */
  idx: number
  /** Time at the boundary sample, in the same units as the caller's time axis. */
  t: number
  /** Sign of the 2D cross product (line direction x track-segment direction). */
  sign: number
}

/** A 2D planar point in metres, local to the lap line's midpoint. */
export interface PlanarPoint {
  x: number
  y: number
}

/**
 * Project a lat/lon to a local planar frame centred on (lat0, lon0). Longitude
 * is scaled by cos(lat0) so x and y share the same (degree) scale; the absolute
 * unit is irrelevant because every intersection test below is sign-based.
 *
 * Exported so other modules that need the SAME planar-projection + crossing
 * test (e.g. sector-gate validity) reuse this exact geometry rather than
 * re-deriving a subtly different one.
 */
export function project(
  lat: number,
  lon: number,
  lat0: number,
  lon0: number,
  cosLat0: number,
): PlanarPoint {
  return { x: (lon - lon0) * cosLat0, y: lat - lat0 }
}

/** 2D cross product of (b - a) x (c - a); its sign gives the orientation. */
function cross(a: PlanarPoint, b: PlanarPoint, c: PlanarPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/**
 * True if segment p1-p2 properly straddles segment q1-q2 (standard
 * orientation test). Collinear/endpoint-touch cases are treated as non-crossing
 * to avoid double-counting a track grazing the line.
 */
export function segmentsIntersect(
  p1: PlanarPoint,
  p2: PlanarPoint,
  q1: PlanarPoint,
  q2: PlanarPoint,
): boolean {
  const d1 = cross(q1, q2, p1)
  const d2 = cross(q1, q2, p2)
  const d3 = cross(p1, p2, q1)
  const d4 = cross(p1, p2, q2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * A gate line pre-projected into its own local planar frame (centred on the
 * gate's own midpoint) — the precompute every gate-walking consumer
 * (sector validity, sector timing, gate ordering) needs once per gate before
 * walking a lap's fixes against it.
 */
export interface PlanarGate {
  lat0: number
  lon0: number
  cosLat0: number
  a: PlanarPoint
  b: PlanarPoint
}

/**
 * Project a gate line into its own local planar frame. Exported so every
 * module that walks a lap testing sequential gate crossings (sector validity,
 * sector timing, gate ordering) precomputes gates identically instead of each
 * re-deriving the same per-gate midpoint frame.
 */
export function planarGate(g: LapLine): PlanarGate {
  const lat0 = (g.a.lat + g.b.lat) / 2
  const lon0 = (g.a.lon + g.b.lon) / 2
  const cosLat0 = Math.cos(toRadians(lat0))
  return {
    lat0,
    lon0,
    cosLat0,
    a: project(g.a.lat, g.a.lon, lat0, lon0, cosLat0),
    b: project(g.b.lat, g.b.lon, lat0, lon0, cosLat0),
  }
}

/** A single segment straddling the CURRENTLY-expected gate, passed to {@link walkLapGates}'s callback. */
export interface GateCrossing {
  /** Index into `gates` (and the pointer position) of the gate just crossed. */
  gateIdx: number
  /** Planar projection of the track segment's start point (sample `prevIdx`). */
  p1: PlanarPoint
  /** Planar projection of the track segment's end point (sample `idx`). */
  p2: PlanarPoint
  /** Sample index of the segment's start point. */
  prevIdx: number
  /** Sample index of the segment's end point (the boundary sample). */
  idx: number
}

/**
 * Walk a lap's consecutive valid GPS fixes once, testing each track segment
 * against a single sequential pointer into `gates` (starting at gate 0):
 * a segment crossing the CURRENTLY-expected gate advances the pointer and
 * invokes `onCrossing`; crossings of any other gate are ignored. This is the
 * shared "walk lap, find gate crossing" primitive behind sector validity,
 * sector timing, and gate ordering — same algorithm each callsite needs, only
 * what they DO with a crossing (mark invalid, interpolate a time, interpolate
 * a distance) differs.
 *
 * Returns the number of gates actually crossed (== `gates.length` iff every
 * gate was crossed in order before the lap's last sample).
 */
export function walkLapGates(
  track: GpsTrack,
  lap: Pick<Lap, 'startIdx' | 'endIdx'>,
  gates: readonly PlanarGate[],
  onCrossing: (crossing: GateCrossing) => void,
): number {
  const { lat, lon, valid } = track
  const start = Math.max(0, lap.startIdx)
  const end = Math.min(track.valid.length - 1, lap.endIdx)

  let gatePtr = 0
  let prev = -1
  for (let i = start; i <= end && gatePtr < gates.length; i++) {
    if (!valid[i]) continue
    if (prev >= 0) {
      const g = gates[gatePtr]
      const p1 = project(lat[prev], lon[prev], g.lat0, g.lon0, g.cosLat0)
      const p2 = project(lat[i], lon[i], g.lat0, g.lon0, g.cosLat0)
      if (segmentsIntersect(p1, p2, g.a, g.b)) {
        onCrossing({ gateIdx: gatePtr, p1, p2, prevIdx: prev, idx: i })
        gatePtr++
      }
    }
    prev = i
  }

  return gatePtr
}

/**
 * Build laps between consecutive crossings. N crossings -> N-1 laps. The span
 * is [crossing[i].idx, crossing[i+1].idx); the out-lap before the first
 * crossing and the in-lap after the last are not laps.
 */
function lapsFromCrossings(crossings: Crossing[]): Lap[] {
  if (crossings.length < 2) return []
  const laps: Lap[] = []
  for (let i = 0; i < crossings.length - 1; i++) {
    const start = crossings[i]
    const end = crossings[i + 1]
    laps.push({
      index: i,
      startIdx: start.idx,
      endIdx: end.idx,
      lapTimeMs: end.t - start.t,
    })
  }
  return laps
}

/**
 * Detect laps by counting where the GPS track crosses the start/finish line.
 * Walks consecutive VALID fixes; for each adjacent pair (p_i -> p_{i+1}) tests
 * 2D segment intersection against the line a-b (treat lat/lon as planar with a
 * cos(lat) longitude scale around the line's mean latitude — fine at track
 * scale). A crossing marks a lap boundary at sample i+1. Apply the direction
 * filter and minLapMs debounce. Returns laps BETWEEN consecutive crossings
 * (N crossings -> N-1 laps); the partial out-lap before the first crossing and
 * in-lap after the last are NOT laps.
 *
 * `timeMs` is the per-sample time axis. Its units and `minLapMs` must match;
 * the default minLapMs (5000) assumes milliseconds.
 */
export function detectLapsByLine(
  track: GpsTrack,
  timeMs: Float64Array,
  line: LapLine,
  opts: DetectLapsOptions = {},
): Lap[] {
  const minLapMs = opts.minLapMs ?? 5000
  const { lat, lon, valid } = track
  const n = lat.length

  // Guard: need at least two valid fixes to form a segment.
  let validCount = 0
  for (let i = 0; i < n; i++) if (valid[i]) validCount++
  if (validCount < 2) return []

  // Local planar frame centred on the line's midpoint.
  const lat0 = (line.a.lat + line.b.lat) / 2
  const lon0 = (line.a.lon + line.b.lon) / 2
  const cosLat0 = Math.cos(toRadians(lat0))
  const qa = project(line.a.lat, line.a.lon, lat0, lon0, cosLat0)
  const qb = project(line.b.lat, line.b.lon, lat0, lon0, cosLat0)

  // Collect raw crossings over consecutive valid fixes.
  const raw: Crossing[] = []
  let prev = -1
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue
    if (prev >= 0) {
      const p1 = project(lat[prev], lon[prev], lat0, lon0, cosLat0)
      const p2 = project(lat[i], lon[i], lat0, lon0, cosLat0)
      if (segmentsIntersect(p1, p2, qa, qb)) {
        // Direction sign: orientation of the line direction (a->b) relative to
        // the track segment direction (p1->p2), via cross of the two vectors.
        const lineDx = qb.x - qa.x
        const lineDy = qb.y - qa.y
        const segDx = p2.x - p1.x
        const segDy = p2.y - p1.y
        const s = lineDx * segDy - lineDy * segDx
        raw.push({ idx: i, t: timeMs[i], sign: Math.sign(s) })
      }
    }
    prev = i
  }

  if (raw.length < 2) return []

  // Direction filter: explicit, or auto (majority sign).
  let wanted: number
  if (opts.direction !== undefined) {
    wanted = opts.direction
  } else {
    let pos = 0
    let neg = 0
    for (const c of raw) {
      if (c.sign > 0) pos++
      else if (c.sign < 0) neg++
    }
    wanted = neg > pos ? -1 : 1
  }
  const directed = raw.filter((c) => c.sign === wanted)

  // Debounce AFTER direction filtering: drop crossings within minLapMs of the
  // previously kept one, keeping the earliest of a cluster.
  const kept: Crossing[] = []
  for (const c of directed) {
    if (kept.length === 0 || c.t - kept[kept.length - 1].t >= minLapMs) {
      kept.push(c)
    }
  }

  return lapsFromCrossings(kept)
}

/**
 * Detect laps from the ECU's own lap channel when present. Uses IR_LapNumber
 * (a lap counter that increments) to find boundaries; lap duration comes from
 * the time axis between boundaries to stay consistent with the line method.
 * Returns [] if there is no IR_LapNumber channel or fewer than two boundaries.
 *
 * `timeMs` is the per-sample time axis; its units determine lapTimeMs units.
 */
export function detectLapsByChannel(session: LogSession, timeMs: Float64Array): Lap[] {
  const boundaries = lapChannelBoundaries(session)
  if (boundaries.length < 2) return []

  const laps: Lap[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const startIdx = boundaries[i]
    const endIdx = boundaries[i + 1]
    laps.push({
      index: i,
      startIdx,
      endIdx,
      lapTimeMs: timeMs[endIdx] - timeMs[startIdx],
    })
  }
  return laps
}

/** Sample indices where the ECU lap counter increases. */
export function lapChannelBoundaries(session: LogSession): number[] {
  const lapCh = session.get('IR_LapNumber')
  if (!lapCh) return []
  const boundaries: number[] = []
  let prevLap = NaN
  for (let i = 0; i < lapCh.data.length; i++) {
    const v = lapCh.data[i]
    if (!Number.isFinite(v)) continue
    if (!Number.isNaN(prevLap) && v > prevLap) boundaries.push(i)
    if (Number.isNaN(prevLap) || v !== prevLap) prevLap = v
  }

  return boundaries
}

/**
 * Infer a start/finish line from the ECU lap-counter transition positions.
 * Multiple transitions are averaged to reduce GPS jitter; their local travel
 * vectors are averaged and the returned line is perpendicular to that motion.
 */
export function inferLapLineFromChannel(
  session: LogSession,
  track: GpsTrack,
  halfWidthM = 15,
): LapLine | null {
  const boundaries = lapChannelBoundaries(session)
  if (boundaries.length === 0) return null
  const points: Array<{ idx: number; lat: number; lon: number; hx: number; hy: number }> = []
  for (const boundary of boundaries) {
    let idx = boundary
    while (idx < track.valid.length && !track.valid[idx]) idx++
    if (idx >= track.valid.length) continue
    let before = idx - 1
    while (before >= 0 && (!track.valid[before] || (track.lat[before] === track.lat[idx] && track.lon[before] === track.lon[idx]))) before--
    let after = idx + 1
    while (after < track.valid.length && (!track.valid[after] || (track.lat[after] === track.lat[idx] && track.lon[after] === track.lon[idx]))) after++
    if (before < 0 || after >= track.valid.length) continue
    const cosLat = Math.cos(toRadians(track.lat[idx])) || 1
    const hx = (track.lon[after] - track.lon[before]) * cosLat
    const hy = track.lat[after] - track.lat[before]
    const len = Math.hypot(hx, hy)
    if (len > 0) points.push({ idx, lat: track.lat[idx], lon: track.lon[idx], hx: hx / len, hy: hy / len })
  }
  if (points.length === 0) return null
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length
  const lon = points.reduce((sum, point) => sum + point.lon, 0) / points.length
  const hx = points.reduce((sum, point) => sum + point.hx, 0)
  const hy = points.reduce((sum, point) => sum + point.hy, 0)
  const headingLength = Math.hypot(hx, hy)
  if (headingLength === 0) return null
  const east = -hy / headingLength
  const north = hx / headingLength
  const earthR = 6371000
  const dLat = (north * halfWidthM / earthR) * (180 / Math.PI)
  const dLon = (east * halfWidthM / (earthR * (Math.cos(toRadians(lat)) || 1))) * (180 / Math.PI)
  return { a: { lat: lat + dLat, lon: lon + dLon }, b: { lat: lat - dLat, lon: lon - dLon } }
}
