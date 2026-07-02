import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from '@/domain/analysis/laps'
import { planarGate, walkLapGates } from '@/domain/analysis/laps'

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
  const planarGates = gates.map(planarGate)

  const invalid: number[] = []

  for (const lap of laps) {
    // A lap spans samples [startIdx, endIdx] inclusive (endIdx is the boundary
    // sample where the NEXT crossing occurs — see lapsFromCrossings in
    // laps.ts), and the final segment (endIdx-1, endIdx) is the one whose
    // crossing closes this lap. A gate crossed right at the line (e.g. the last
    // sector gate coinciding with, or sitting just before, the finish) must
    // still count towards THIS lap, so that segment has to be tested too —
    // walkLapGates already includes `endIdx` in its walk.
    const crossed = walkLapGates(track, lap, planarGates, () => {})
    if (crossed < planarGates.length) invalid.push(lap.index)
  }

  return invalid
}
