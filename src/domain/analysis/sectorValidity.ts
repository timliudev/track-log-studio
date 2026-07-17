import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from '@/domain/analysis/laps'
import { planarGate, walkLapGates } from '@/domain/analysis/laps'

export interface SectorLapFailure {
  lapIndex: number
  /** One-based number of the first gate the lap did not reach in sequence. */
  missedSector: number
}

export interface SectorValidityResult {
  failures: SectorLapFailure[]
  /** True when gates exist, laps exist, and not one lap passes all gates. */
  allFailed: boolean
}

/** Detailed sector-check result used by policy/UI consumers. */
export function evaluateSectorValidity(
  laps: readonly Lap[],
  track: GpsTrack,
  gates: readonly LapLine[],
): SectorValidityResult {
  if (gates.length === 0 || laps.length === 0) return { failures: [], allFailed: false }
  const planarGates = gates.map(planarGate)
  const failures: SectorLapFailure[] = []
  for (const lap of laps) {
    const crossed = walkLapGates(track, lap, planarGates, () => {})
    if (crossed < planarGates.length) failures.push({ lapIndex: lap.index, missedSector: crossed + 1 })
  }
  return { failures, allFailed: failures.length === laps.length }
}

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
  return evaluateSectorValidity(laps, track, gates).failures.map((failure) => failure.lapIndex)
}
