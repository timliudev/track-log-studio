import type { Lap } from '@/domain/model/Lap'

/**
 * The `index` of the fastest lap, ignoring any laps the user has excluded as
 * garbage. "Fastest" is the smallest finite, positive `lapTimeMs`. Returns null
 * when no lap qualifies (empty input, every lap excluded, or no valid time).
 *
 * Pure and exclusion-aware so it is the single primitive behind the lap table's
 * best-lap marker and, later, the optimal-lap / delta-time metrics — those all
 * reason over the same "included laps" set.
 *
 * @param laps     Detected laps (any order); `index` is their stable handle.
 * @param excluded Lap indices marked as garbage; matched against `lap.index`.
 */
export function fastestLapIndex(laps: Lap[], excluded: readonly number[]): number | null {
  return extremeLapIndex(laps, excluded, 'min')
}

/**
 * The `index` of the slowest non-excluded lap (largest finite, positive
 * `lapTimeMs`); null when none qualifies. Companion to {@link fastestLapIndex}
 * with the same exclusion semantics, used for the lap table's slowest marker.
 */
export function slowestLapIndex(laps: Lap[], excluded: readonly number[]): number | null {
  return extremeLapIndex(laps, excluded, 'max')
}

/** Index of the lap with the min/max valid lap time among non-excluded laps. */
function extremeLapIndex(
  laps: Lap[],
  excluded: readonly number[],
  want: 'min' | 'max',
): number | null {
  const skip = new Set(excluded)
  let pick: number | null = null
  let pickTime = want === 'min' ? Infinity : -Infinity
  for (const lap of laps) {
    if (skip.has(lap.index)) continue
    const t = lap.lapTimeMs
    if (!Number.isFinite(t) || t <= 0) continue
    if (want === 'min' ? t < pickTime : t > pickTime) {
      pickTime = t
      pick = lap.index
    }
  }
  return pick
}
