import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from '@/domain/analysis/laps'
import { project, segmentsIntersect } from '@/domain/analysis/laps'
import { toRadians } from '@/domain/export/rc3Nmea/geo'

/**
 * Given a set of confirmed sector gates (in sector order), decide which laps
 * FAIL the "crossed every gate, in order" test — i.e. the lap either misses a
 * gate entirely, or crosses the gates out of sequence (e.g. the rider cut
 * across the infield / 切西瓜 and skipped ahead). Pure geometry, no store
 * imports; reuses the exact planar-projection + segment-straddle test that
 * {@link detectLapsByLine} uses for the start/finish line, so a gate and the
 * start/finish line are checked identically.
 *
 * Algorithm per lap: walk the lap's consecutive valid GPS fixes once, keeping
 * a single pointer into the gate sequence (starting at gate 0). For each
 * track segment, test it against the CURRENT expected gate only; if it
 * crosses, advance the pointer to the next gate. Crossings of a gate that
 * isn't the currently-expected one are ignored (this is what makes
 * out-of-order / skipped crossings fail: an early crossing of gate 2 before
 * gate 1 has been seen does nothing, and gate 1 is still awaited afterwards).
 * The lap passes iff the pointer reaches the end of the gate list before the
 * lap's last sample. A gate crossed multiple times in a row before advancing
 * is harmless (the pointer only needs ONE crossing to advance).
 *
 * With zero gates every lap trivially passes (nothing to fail), so behaviour
 * is byte-identical to today when no gates are confirmed.
 */
export function invalidSectorLapIndices(
  laps: readonly Lap[],
  track: GpsTrack,
  gates: readonly LapLine[],
): number[] {
  if (gates.length === 0) return []

  // Precompute each gate's planar endpoints once, centred on ITS OWN midpoint
  // (matching detectLapsByLine's per-line local frame — fine at track scale
  // since every test below is sign-based, not absolute-distance-based).
  const planarGates = gates.map((g) => {
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
  })

  const { lat, lon, valid } = track
  const invalid: number[] = []

  for (const lap of laps) {
    const start = Math.max(0, lap.startIdx)
    const end = Math.min(track.valid.length, lap.endIdx)

    let gatePtr = 0
    let prev = -1
    for (let i = start; i < end && gatePtr < planarGates.length; i++) {
      if (!valid[i]) continue
      if (prev >= 0) {
        const g = planarGates[gatePtr]
        const p1 = project(lat[prev], lon[prev], g.lat0, g.lon0, g.cosLat0)
        const p2 = project(lat[i], lon[i], g.lat0, g.lon0, g.cosLat0)
        if (segmentsIntersect(p1, p2, g.a, g.b)) {
          gatePtr++
        }
      }
      prev = i
    }

    if (gatePtr < planarGates.length) invalid.push(lap.index)
  }

  return invalid
}
