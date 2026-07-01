import { aggregateChannel, type Aggregation } from './lapAggregate'
import type { LapSectorTimes } from './sectorTiming'
import type { Lap } from '@/domain/model/Lap'
import type { LogSession } from '@/domain/model/LogSession'

/**
 * Everything a metric might need to compute itself for a lap. `sectorTimings` /
 * `bestLapTimeMs` back the `sectorTime` and `delta` metrics below — adding a
 * field here (not a new compute signature) is how new cross-lap metrics slot in.
 */
export interface LapContext {
  session: LogSession | null
  cumDistM: Float64Array | null
  /** Per-lap sector timings (§11 E), keyed by lap index via {@link LapSectorTimes.lapIndex}.
   *  Empty/absent when there are no confirmed sector gates or no track. */
  sectorTimings?: readonly LapSectorTimes[]
  /** The fastest included lap's total time (ms), used as the `delta` metric's
   *  reference. `null`/NaN when there is no qualifying lap (delta is then NaN). */
  bestLapTimeMs?: number | null
}

/**
 * A per-lap metric descriptor. Discriminated union so a new kind (delta, sector,
 * …) is added in two places only: a variant here and a case in {@link computeMetric}.
 * `channel` aggregations are the firmware-signal metrics; `lapTime` / `distance`
 * are derived from the lap structure / GPS track; `sectorTime` / `delta` are
 * derived from sector-gate crossings (§11 E — see `sectorTiming.ts`).
 */
export type LapMetric =
  | { kind: 'lapTime' }
  | { kind: 'distance' }
  | { kind: 'channel'; channel: string; agg: Aggregation }
  | { kind: 'sectorTime'; sector: number }
  | { kind: 'delta' }

/**
 * Compute a metric's value for one lap. Pure; returns NaN when not computable
 * (missing channel, degenerate span, out-of-range, etc.). This is the SINGLE
 * place that decides how a displayed per-lap number is sourced — raw-channel
 * aggregation and lap-structure metrics live behind one interface so callers
 * never branch on "is this a channel or a built-in".
 */
export function computeMetric(metric: LapMetric, lap: Lap, ctx: LapContext): number {
  switch (metric.kind) {
    case 'lapTime':
      return lap.lapTimeMs

    case 'distance': {
      const cum = ctx.cumDistM
      if (!cum || lap.endIdx <= lap.startIdx || lap.endIdx >= cum.length) return NaN
      return cum[lap.endIdx] - cum[lap.startIdx]
    }

    case 'channel': {
      if (!ctx.session || !metric.channel) return NaN
      const ch = ctx.session.get(metric.channel)
      if (!ch) return NaN
      return aggregateChannel(ch.data, lap.startIdx, lap.endIdx, metric.agg)
    }

    case 'sectorTime': {
      const timing = ctx.sectorTimings?.find((t) => t.lapIndex === lap.index)
      if (!timing) return NaN
      const v = timing.sectorTimesMs[metric.sector]
      return v === undefined ? NaN : v
    }

    case 'delta': {
      const best = ctx.bestLapTimeMs
      if (best == null || !Number.isFinite(best)) return NaN
      if (!Number.isFinite(lap.lapTimeMs)) return NaN
      return lap.lapTimeMs - best
    }
  }
}

/**
 * Domain stays i18n-free, so there is no `metricLabel(metric): string` here:
 * the metric descriptor IS the structured "label" (its `kind` + channel/agg),
 * and {@link LapTable} formats it into a localized header (channel kind →
 * `${channel} · ${aggLabel(agg)}`; built-in kinds → a looked-up label).
 */
