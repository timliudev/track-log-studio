import type { Lap } from '@/domain/model/Lap'

export interface SessionLapSource {
  id: number
  name: string
  color: string
  laps: readonly Lap[]
}

export interface SessionLapSummary {
  id: number
  name: string
  color: string
  fastestMs: number | null
  deltaMs: number | null
  lapCount: number
}

export function fastestLapTime(laps: readonly Lap[], excluded: readonly number[] = []): number | null {
  const skip = new Set(excluded)
  let best = Infinity
  for (const lap of laps) {
    if (skip.has(lap.index)) continue
    if (Number.isFinite(lap.lapTimeMs) && lap.lapTimeMs > 0 && lap.lapTimeMs < best) best = lap.lapTimeMs
  }
  return Number.isFinite(best) ? best : null
}

/** Read-only cross-recording lap summary. Comparison recordings have no
 * primary-session exclusion state, so every detected finite lap participates. */
export function buildSessionLapSummaries(
  primaryLaps: readonly Lap[],
  primaryExcluded: readonly number[],
  comparisons: readonly SessionLapSource[],
): SessionLapSummary[] {
  const primaryBest = fastestLapTime(primaryLaps, primaryExcluded)
  return comparisons.map((source) => {
    const fastestMs = fastestLapTime(source.laps)
    return {
      id: source.id,
      name: source.name,
      color: source.color,
      fastestMs,
      deltaMs: fastestMs != null && primaryBest != null ? fastestMs - primaryBest : null,
      lapCount: source.laps.length,
    }
  })
}
