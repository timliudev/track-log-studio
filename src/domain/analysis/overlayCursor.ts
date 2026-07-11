import type { Lap } from '@/domain/model/Lap'
import { nearestXIndex } from './timelineData'

/**
 * Overlay↔map cursor bridge (疊圈游標連動).
 *
 * Overlay charts plot every selected lap re-based onto ONE shared, lap-relative
 * X grid (see {@link buildLapOverlay}/{@link buildCrossSessionLapOverlay}): a
 * lap's sample `i` is drawn at `xValues[i] - xValues[lap.startIdx] + offset`.
 * The track map and timeline charts, by contrast, live in the primary session's
 * own SAMPLE-INDEX space. These pure helpers convert between the two so a hover
 * on an overlay chart can drive the map's cursor (and vice-versa) — the "common
 * X ↔ each lap's sample index" mapping the shared cursor needs.
 */

/** Lap-relative ("rebased") X for sample `i` within `lap` — the exact value the
 *  overlay resampler plots it at. */
export function rebasedX(xValues: ArrayLike<number>, lap: Lap, offset: number, i: number): number {
  return xValues[i] - xValues[lap.startIdx] + offset
}

/**
 * grid→sample half: the session sample index within `lap` whose rebased X is
 * closest to the shared-grid X `gridX`. `null` when the lap has no finite
 * anchor / the grid value is non-finite. Linear scan over the lap span — cheap
 * at hover rates and robust to non-uniform sampling (distance axes aren't
 * evenly spaced in index).
 */
export function sampleIndexAtGridX(
  xValues: ArrayLike<number>,
  lap: Lap,
  offset: number,
  gridX: number,
): number | null {
  const x0 = xValues[lap.startIdx]
  if (!Number.isFinite(x0) || !Number.isFinite(gridX)) return null
  let best: number | null = null
  let bestDist = Infinity
  for (let i = lap.startIdx; i <= lap.endIdx; i++) {
    const x = xValues[i]
    if (!Number.isFinite(x)) continue
    const d = Math.abs(x - x0 + offset - gridX)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * sample→grid half: the index into the shared grid `grid` closest to sample
 * `sampleIdx`'s rebased X — but only when that sample actually lies within
 * `lap`. `null` otherwise, so a session cursor sitting on a lap that isn't part
 * of the overlay never fabricates a bogus overlay position.
 */
export function gridIndexAtSampleIndex(
  xValues: ArrayLike<number>,
  lap: Lap,
  offset: number,
  grid: ArrayLike<number>,
  sampleIdx: number,
): number | null {
  if (sampleIdx < lap.startIdx || sampleIdx > lap.endIdx) return null
  return nearestXIndex(grid, rebasedX(xValues, lap, offset, sampleIdx))
}

/** The first lap in `laps` (selection order) whose half-open-inclusive span
 *  contains `sampleIdx`, or `null`. Picks which lap's rebasing maps a session
 *  cursor onto the shared grid. */
export function lapContaining(laps: readonly Lap[], sampleIdx: number): Lap | null {
  for (const lap of laps) {
    if (sampleIdx >= lap.startIdx && sampleIdx <= lap.endIdx) return lap
  }
  return null
}
