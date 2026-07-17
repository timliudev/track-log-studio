import type { GpsTrack } from './gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from './laps'
import { planarGate, walkLapGates } from './laps'
import { cumulativeDistanceM } from './distance'

/**
 * Lap-relative distance (m) at which `gate` sits along `lap`'s span of
 * `track` — the same quantity `useSectors.ts` computes for auto-detected
 * corners (`corner.distanceM - lapStartM`), generalised to an ARBITRARY gate
 * line so manually-added/dragged gates can be ordered alongside detected
 * ones.
 *
 * Two strategies, in order:
 *  1. **Crossing**: use the same shared gate walker as sector timing/validity
 *     to find the FIRST proper straddle or sampled-point pass-through. The
 *     gate's "real" position is where the track actually crosses it; ordinary
 *     straddles are interpolated and sampled crossings use that exact fix.
 *  2. **Nearest point** fallback: a gate that doesn't cleanly cross the
 *     reference lap (e.g. just dropped at the map cursor before the user
 *     drags it onto the racing line, or a lap that takes a slightly different
 *     line this time) still needs a defined order — fall back to the
 *     distance of whichever track sample's midpoint-to-gate-midpoint distance
 *     is smallest.
 *
 * Returns null if the lap has fewer than two valid fixes to measure against.
 */
export function gatePositionOnLap(track: GpsTrack, lap: Lap, gate: LapLine): number | null {
  const { lat, lon, valid } = track
  const start = Math.max(0, lap.startIdx)
  const end = Math.min(track.valid.length - 1, lap.endIdx)
  if (start >= end) return null

  const fullDist = cumulativeDistanceM(lat, lon, valid)
  const lapStartM = fullDist[start]

  // The same shared gate walker used by sector timing and validity also owns
  // sampled-point crossing semantics, so ordering cannot disagree with them.
  const planar = planarGate(gate)

  let nearestIdx = -1
  let nearestDistSq = Infinity
  const gmx = (gate.a.lat + gate.b.lat) / 2
  const gmy = (gate.a.lon + gate.b.lon) / 2

  for (let i = start; i <= end; i++) {
    if (!valid[i]) continue

    // Track this sample's distance to the gate midpoint for the fallback.
    const dLat = lat[i] - gmx
    const dLon = lon[i] - gmy
    const dSq = dLat * dLat + dLon * dLon
    if (dSq < nearestDistSq) {
      nearestDistSq = dSq
      nearestIdx = i
    }

  }

  let crossingDistanceM: number | null = null
  walkLapGates(track, lap, [planar], ({ p1, p2, prevIdx, idx }) => {
    if (prevIdx === idx) {
      crossingDistanceM = fullDist[idx]
      return
    }
    // Interpolate distance within the same proper-straddle segment the shared
    // walker accepted, mirroring sectorTiming's time interpolation.
    const rx = p2.x - p1.x
    const ry = p2.y - p1.y
    const sx = planar.b.x - planar.a.x
    const sy = planar.b.y - planar.a.y
    const denom = rx * sy - ry * sx
    const fraction = denom === 0
      ? 1
      : Math.min(1, Math.max(0, ((planar.a.x - p1.x) * sy - (planar.a.y - p1.y) * sx) / denom))
    crossingDistanceM = fullDist[prevIdx] + fraction * (fullDist[idx] - fullDist[prevIdx])
  })
  if (crossingDistanceM != null) return crossingDistanceM - lapStartM

  if (nearestIdx < 0) return null
  return fullDist[nearestIdx] - lapStartM
}

/** A gate with a precomputed lap-relative position, used to sort/reorder. */
export interface OrderedGate<T> {
  gate: T
  positionM: number
}

/**
 * Sort gates by their lap-relative crossing position on the reference lap
 * (ascending — sector order must follow the direction of travel), using
 * {@link gatePositionOnLap} for each. Gates whose position can't be
 * determined (null — e.g. no valid fixes in the lap) sort LAST, in their
 * original relative order, rather than being dropped — an un-positionable
 * gate is still a gate the user asked for.
 *
 * Pure: takes the line-extraction function so it works for both raw
 * `LapLine[]` and any richer gate shape (e.g. `{ line, edited }`) without a
 * cast.
 */
export function sortGatesByPosition<T>(
  track: GpsTrack,
  lap: Lap,
  gates: readonly T[],
  lineOf: (g: T) => LapLine,
): T[] {
  const positioned = gates.map((gate, originalIndex) => {
    const positionM = gatePositionOnLap(track, lap, lineOf(gate))
    return { gate, originalIndex, positionM }
  })
  positioned.sort((a, b) => {
    const aNull = a.positionM == null
    const bNull = b.positionM == null
    if (aNull && bNull) return a.originalIndex - b.originalIndex
    if (aNull) return 1
    if (bNull) return -1
    return a.positionM! - b.positionM! || a.originalIndex - b.originalIndex
  })
  return positioned.map((p) => p.gate)
}
