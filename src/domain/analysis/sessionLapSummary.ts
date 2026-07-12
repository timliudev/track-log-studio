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

/** One per-lap row for a lap table. Shared shape for BOTH the primary
 * LapTable and any comparison-recording lap table (via {@link LapTableView})
 * so the two present laps through the exact same rendering + number-sourcing
 * path — one source of truth, not two parallel implementations. */
export interface LapTableRow {
  index: number
  lapTimeMs: number
  /** Per-lap distance in metres; NaN when no track / degenerate span. */
  distanceM: number
  isFastest: boolean
  isSlowest: boolean
  /** Whether this lap is excluded (manual, out-of-band, or sector-invalid for
   *  the primary; band-only for a read-only comparison recording — see
   *  {@link buildLapTableRows}'s `excluded` param). Drives the same dimmed/
   *  struck-through row styling in both tables. */
  isExcluded: boolean
  /** Raw per-column values (channel/sector/delta), aligned index-for-index
   *  with the `metrics` argument. Empty when no columns are configured.
   *  NaN (not formatted) — callers format with {@link formatLapMetricCell}. */
  cells: number[]
}

/**
 * Per-lap rows for one lap table — the SINGLE row-building path used by both
 * the primary LapTable (via its own `laps`/`lapStore.excluded`) and every
 * comparison recording's read-only lap table (via its own laps/track and the
 * shared valid-lap band, see B2). Fastest/slowest markers and the `excluded`
 * flag are all computed over the SAME `excluded` list passed in, so a
 * comparison recording's markers/dimming behave exactly like the primary's
 * once the same band rules are threaded through. The slowest marker is
 * suppressed when it would land on the same lap as the fastest — with 0/1
 * INCLUDED laps they coincide and a second marker on one row is just noise.
 *
 * `ctx` is the recording's OWN {@link LapContext} (its track's cumulative
 * distance, its own session for channel lookups, its own sector timings when
 * the shared gates cross its track — see B17 — and its own fastest lap as the
 * `delta` column's reference). `metrics` is the user-configured column list
 * (`lapStore.columns.map(c => c.metric)`); every value is sourced through the
 * SAME {@link computeMetric} path for every recording.
 */
export function buildLapTableRows(
  laps: readonly Lap[],
  ctx: LapContext,
  metrics: readonly LapMetric[] = [],
  excluded: readonly number[] = [],
): LapTableRow[] {
  const mutable = laps as Lap[]
  const fastest = fastestLapIndex(mutable, excluded)
  const slowestRaw = slowestLapIndex(mutable, excluded)
  const slowest = slowestRaw != null && slowestRaw !== fastest ? slowestRaw : null
  const skip = new Set(excluded)
  return laps.map((lap) => ({
    index: lap.index,
    lapTimeMs: lap.lapTimeMs,
    distanceM: computeMetric({ kind: 'distance' }, lap, ctx),
    isFastest: lap.index === fastest,
    isSlowest: lap.index === slowest,
    isExcluded: skip.has(lap.index),
    cells: metrics.map((metric) => computeMetric(metric, lap, ctx)),
  }))
}
