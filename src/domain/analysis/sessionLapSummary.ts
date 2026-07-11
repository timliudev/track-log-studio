import type { Lap } from '@/domain/model/Lap'
import { fastestLapIndex, slowestLapIndex } from './bestLap'
import { computeMetric, type LapContext, type LapMetric } from './lapMetrics'

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

/** One per-lap row for a comparison recording's lap table. Mirrors the primary
 * LapTable's built-in columns (#/time/distance) plus fastest/slowest flags so the
 * two present laps in the same visual language, plus one raw value per
 * user-configured column (same order as the caller's `metrics` list) for full
 * column parity with the primary table. */
export interface ComparisonLapRow {
  index: number
  lapTimeMs: number
  /** Per-lap distance in metres; NaN when no track / degenerate span. */
  distanceM: number
  isFastest: boolean
  isSlowest: boolean
  /** Raw per-column values (channel/sector/delta), aligned index-for-index
   *  with the `metrics` argument. Empty when no columns are configured.
   *  NaN (not formatted) — callers format with the same idiom as the
   *  primary table (`formatMetricValue` / `formatMsColumn`). */
  cells: number[]
}

/**
 * Per-lap rows for one comparison recording. Comparison recordings carry no
 * primary-session exclusion state, so every finite lap participates and the
 * fastest/slowest markers are computed over all laps (matching
 * {@link buildSessionLapSummaries}). The slowest marker is suppressed when it
 * would land on the same lap as the fastest — with 0/1 valid laps they coincide
 * and a second marker on one row is just noise (same rule as the primary table).
 *
 * `ctx` is the comparison recording's OWN {@link LapContext} (its track's
 * cumulative distance, its own session for channel lookups, its own fastest
 * lap as the `delta` column's reference — sector gates are defined on the
 * PRIMARY track only, so `ctx.sectorTimings` is expected to be empty/absent
 * here and sector columns simply render '—'). `metrics` is the user-configured
 * column list (`lapStore.columns.map(c => c.metric)`); every value is sourced
 * through the SAME {@link computeMetric} path as the primary LapTable.
 */
export function buildComparisonLapRows(
  laps: readonly Lap[],
  ctx: LapContext,
  metrics: readonly LapMetric[] = [],
): ComparisonLapRow[] {
  const mutable = laps as Lap[]
  const fastest = fastestLapIndex(mutable, [])
  const slowestRaw = slowestLapIndex(mutable, [])
  const slowest = slowestRaw != null && slowestRaw !== fastest ? slowestRaw : null
  return laps.map((lap) => ({
    index: lap.index,
    lapTimeMs: lap.lapTimeMs,
    distanceM: computeMetric({ kind: 'distance' }, lap, ctx),
    isFastest: lap.index === fastest,
    isSlowest: lap.index === slowest,
    cells: metrics.map((metric) => computeMetric(metric, lap, ctx)),
  }))
}
