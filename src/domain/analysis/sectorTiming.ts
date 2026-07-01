import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from '@/domain/analysis/laps'
import { project, segmentsIntersect, type PlanarPoint } from '@/domain/analysis/laps'
import { toRadians } from '@/domain/export/rc3Nmea/geo'

/** Per-lap sector timing: one time per sector (start/finish -> gate1 -> … -> finish). */
export interface LapSectorTimes {
  /** Lap this timing belongs to (matches {@link Lap.index}). */
  lapIndex: number
  /** Time (ms) spent in each sector, in gate order; length === gates.length + 1. */
  sectorTimesMs: number[]
  /** True iff every sector boundary (every gate, in order, plus the lap's own
   *  start/end) was actually crossed — i.e. the same notion of "complete" that
   *  {@link invalidSectorLapIndices} uses for validity. A lap that misses a gate
   *  or cuts the infield has fewer than `gates.length` internal crossings, so
   *  its trailing sector(s) cannot be timed; `complete` is false and
   *  `sectorTimesMs` is padded with NaN for the un-timed sectors. */
  complete: boolean
}

/**
 * Planar-projected gate, precomputed once per gate (own local frame, mirroring
 * {@link invalidSectorLapIndices}'s precompute so the two stay geometrically
 * identical).
 */
interface PlanarGate {
  lat0: number
  lon0: number
  cosLat0: number
  a: PlanarPoint
  b: PlanarPoint
}

function planarGate(g: LapLine): PlanarGate {
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

/**
 * Exact crossing time (ms) for the segment (prevIdx -> idx), linearly
 * interpolated by how far along the segment the straddle point falls (using
 * the same 2D cross-product straddle test as {@link segmentsIntersect}, so the
 * interpolation parameter is consistent with what decided this IS a crossing).
 * Falls back to the boundary sample's own time if the segment has zero planar
 * length (degenerate; interpolation parameter undefined).
 */
function interpolatedCrossingTimeMs(
  p1: PlanarPoint,
  p2: PlanarPoint,
  qa: PlanarPoint,
  qb: PlanarPoint,
  t1: number,
  t2: number,
): number {
  // Parametrize the track segment as p1 + s*(p2-p1); solve for s at the
  // intersection with line qa-qb via the standard 2D line-intersection formula.
  const rx = p2.x - p1.x
  const ry = p2.y - p1.y
  const sx = qb.x - qa.x
  const sy = qb.y - qa.y
  const denom = rx * sy - ry * sx
  if (denom === 0) return t2
  const s = ((qa.x - p1.x) * sy - (qa.y - p1.y) * sx) / denom
  const clamped = Math.min(1, Math.max(0, s))
  return t1 + clamped * (t2 - t1)
}

/**
 * Compute per-lap sector times by walking each lap's GPS fixes once, exactly
 * like {@link invalidSectorLapIndices}'s single-pointer gate walk, but instead
 * of only pass/fail we record the (interpolated) crossing time at each gate
 * and use it as a sector boundary. Sectors partition the lap as:
 * start/finish -> gate1 -> gate2 -> … -> gateN -> finish (N gates => N+1
 * sectors). With zero gates every lap has exactly one sector: the whole lap.
 *
 * A lap that fails to cross every gate in order (missed gate, or an
 * out-of-order infield cut) gets `complete: false` and its un-timed trailing
 * sectors are NaN — mirroring {@link invalidSectorLapIndices}'s pass/fail so a
 * lap excluded there is exactly the lap whose timing here is incomplete.
 */
export function computeSectorTimes(
  laps: readonly Lap[],
  track: GpsTrack,
  timeMs: Float64Array,
  gates: readonly LapLine[],
): LapSectorTimes[] {
  const planarGates = gates.map(planarGate)
  const { lat, lon, valid } = track
  const out: LapSectorTimes[] = []

  for (const lap of laps) {
    const start = Math.max(0, lap.startIdx)
    const end = Math.min(track.valid.length - 1, lap.endIdx)
    const sectorCount = planarGates.length + 1
    const sectorTimesMs = new Array<number>(sectorCount).fill(NaN)

    if (start >= end || start >= timeMs.length || end >= timeMs.length) {
      out.push({ lapIndex: lap.index, sectorTimesMs, complete: planarGates.length === 0 && start < end })
      continue
    }

    let gatePtr = 0
    let boundaryTime = timeMs[start]
    let prev = -1

    for (let i = start; i <= end && gatePtr < planarGates.length; i++) {
      if (!valid[i]) continue
      if (prev >= 0) {
        const g = planarGates[gatePtr]
        const p1 = project(lat[prev], lon[prev], g.lat0, g.lon0, g.cosLat0)
        const p2 = project(lat[i], lon[i], g.lat0, g.lon0, g.cosLat0)
        if (segmentsIntersect(p1, p2, g.a, g.b)) {
          const crossTime = interpolatedCrossingTimeMs(p1, p2, g.a, g.b, timeMs[prev], timeMs[i])
          sectorTimesMs[gatePtr] = crossTime - boundaryTime
          boundaryTime = crossTime
          gatePtr++
        }
      }
      prev = i
    }

    const complete = gatePtr >= planarGates.length
    if (complete) {
      // Final sector: last gate (or the lap start, with zero gates) -> finish.
      sectorTimesMs[sectorCount - 1] = timeMs[end] - boundaryTime
    }

    out.push({ lapIndex: lap.index, sectorTimesMs, complete })
  }

  return out
}

/** Per-sector theoretical-best result: the minimum time and which lap set it. */
export interface BestSector {
  bestMs: number
  lapIndex: number | null
}

/**
 * Theoretical-best (optimal) lap: for each sector index, the minimum time
 * across COMPLETE, non-excluded laps' timings, plus which lap owns that best
 * (possibly a different lap per sector — the whole point of an optimal lap).
 * A sector with no qualifying lap gets `{ bestMs: NaN, lapIndex: null }` and is
 * excluded from `optimalLapMs` (NaN poisons the sum only when EVERY sector is
 * missing is avoided by summing finite parts — see below).
 *
 * `optimalLapMs` is the sum of all `bestSectorMs[].bestMs`; NaN (no data) iff
 * every sector is unset. Returns `{ bestSectors: [], optimalLapMs: NaN }` for
 * zero sectors (e.g. no laps timed at all).
 */
export function computeOptimalLap(
  timings: readonly LapSectorTimes[],
  excluded: readonly number[],
): { bestSectors: BestSector[]; optimalLapMs: number } {
  const skip = new Set(excluded)
  const eligible = timings.filter((t) => t.complete && !skip.has(t.lapIndex))

  const sectorCount = eligible.reduce((m, t) => Math.max(m, t.sectorTimesMs.length), 0)
  const bestSectors: BestSector[] = Array.from({ length: sectorCount }, () => ({
    bestMs: NaN,
    lapIndex: null,
  }))

  for (const t of eligible) {
    for (let s = 0; s < t.sectorTimesMs.length; s++) {
      const v = t.sectorTimesMs[s]
      if (!Number.isFinite(v)) continue
      if (!Number.isFinite(bestSectors[s].bestMs) || v < bestSectors[s].bestMs) {
        bestSectors[s] = { bestMs: v, lapIndex: t.lapIndex }
      }
    }
  }

  let optimalLapMs = NaN
  for (const b of bestSectors) {
    if (!Number.isFinite(b.bestMs)) continue
    optimalLapMs = Number.isFinite(optimalLapMs) ? optimalLapMs + b.bestMs : b.bestMs
  }

  return { bestSectors, optimalLapMs }
}
