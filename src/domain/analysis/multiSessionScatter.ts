import type { LogSession } from '@/domain/model/LogSession'
import { buildGgPoints, buildGgPointsWithColor, looksLikeForce } from './ggData'
import { markerShapeForIndex, type MarkerShape } from './markerShapes'

export interface SessionScatterSource {
  id: number
  name: string
  color: string
  session: LogSession
}

export interface SessionScatterSeries {
  points: [number, number][]
  color: string
  name: string
  /** B25 — which file this series' points belong to, encoded as an ECharts
   *  marker/legend symbol name (see `markerShapeForIndex`'s doc). Assigned by
   *  the source's POSITION in `sources` (stable — matches FileBar/the global
   *  comparison list's order), not by file id. */
  symbol: MarkerShape
  /** Third-channel values aligned with `points`, present only when
   *  `colorChannel` is given and the session has that channel. When set, the
   *  colour AXIS (a shared continuous colormap — see GgChart.vue's
   *  `colorExtent`/`visualMap`) takes over hue for every series in the
   *  chart; `color` above is then unused for point colour and file identity
   *  is carried by `symbol` instead (see this module's/markerShapes.ts's
   *  doc for why). */
  colorValues?: number[]
}

/** Build one bounded point cloud per session. Missing channel pairs are
 * skipped so recordings from different logger configurations can coexist.
 * `colorChannel` (B25) picks a third channel to drive the shared colour-axis
 * gradient across ALL sessions' points — when given, `symbol` (not `color`)
 * is what tells the sessions apart on the chart. */
export function buildMultiSessionScatter(
  sources: readonly SessionScatterSource[],
  xName: string,
  yName: string,
  maxPoints = 5000,
  colorChannel?: string | null,
): SessionScatterSeries[] {
  const scale = looksLikeForce(xName) && looksLikeForce(yName) ? 0.001 : 1
  const out: SessionScatterSeries[] = []
  sources.forEach((source, index) => {
    const x = source.session.get(xName)
    const y = source.session.get(yName)
    if (!x || !y) return
    const symbol = markerShapeForIndex(index)
    const third = colorChannel ? source.session.get(colorChannel) : undefined
    if (third) {
      const { points, colorValues } = buildGgPointsWithColor(x.data, y.data, third.data, {
        scale,
        maxPoints,
      })
      out.push({
        points,
        colorValues,
        color: source.color,
        name: source.name,
        symbol,
      })
      return
    }
    out.push({
      points: buildGgPoints(x.data, y.data, { scale, maxPoints }),
      color: source.color,
      name: source.name,
      symbol,
    })
  })
  return out
}

/** One lap belonging to some file, identified only by its own index and
 * range — the shape `useLaps`/`ComparisonSession.laps` entries and
 * `lapStore.selected` both already resolve to (see {@link resolveComparisonLapPicks}). */
export interface LapRange {
  index: number
  startIdx: number
  endIdx: number
}

/**
 * B57 — merges the primary's own selected laps with any cross-session lap
 * picks (`lapStore.selectedAcrossSessions`, each a bare `{fileId, index}`
 * ref) into the flat `SessionScatterLapPick` list {@link buildMultiSessionScatterLaps}
 * expects. Pure (no store/session objects, just plain arrays) so this "does a
 * cross-session ref still resolve to a real lap on that comparison" step —
 * the same shape as TimeSeriesChart.vue's `crossLapSources` loop — is
 * unit-testable without mounting the component or a Pinia store. A ref whose
 * file isn't currently in `comparisons`, or whose lap index doesn't exist on
 * that file's own detected laps (stale selection after a source/line change),
 * is silently dropped rather than plotted with a wrong range. `lapLabel` is a
 * caller-supplied formatter (ScatterChart.vue passes the already-localized
 * `t('analyzer.gg.lapSeries', { n })` string) so this module stays free of
 * any i18n dependency while the resulting series name still respects the
 * user's language.
 */
export function resolveComparisonLapPicks(
  primaryId: number,
  primaryLaps: readonly LapRange[],
  crossRefs: readonly { fileId: number; index: number }[],
  comparisons: readonly { id: number; laps: readonly LapRange[] }[],
  lapLabel: (index: number) => string,
): SessionScatterLapPick[] {
  const picks: SessionScatterLapPick[] = primaryLaps.map((lap) => ({
    sourceId: primaryId,
    index: lap.index,
    startIdx: lap.startIdx,
    endIdx: lap.endIdx,
    label: lapLabel(lap.index),
  }))
  for (const ref of crossRefs) {
    const comparison = comparisons.find((entry) => entry.id === ref.fileId)
    const lap = comparison?.laps.find((entry) => entry.index === ref.index)
    if (!comparison || !lap) continue
    picks.push({
      sourceId: ref.fileId,
      index: lap.index,
      startIdx: lap.startIdx,
      endIdx: lap.endIdx,
      label: lapLabel(lap.index),
    })
  }
  return picks
}

/** One selected lap belonging to a particular `SessionScatterSource` (matched
 * by `sourceId`, i.e. the file id) — see {@link buildMultiSessionScatterLaps}. */
export interface SessionScatterLapPick {
  sourceId: number
  index: number
  startIdx: number
  endIdx: number
  /** Already-localized "Lap N"-style label (see `resolveComparisonLapPicks`'s
   *  `lapLabel` doc) — combined with the owning source's name for the
   *  series legend/tooltip text. */
  label: string
}

/**
 * B57 — lap-selected variant of {@link buildMultiSessionScatter}: instead of
 * one whole-session cloud per source, produces one CLIPPED cloud per selected
 * lap (the primary's own `lapStore.selected` laps, plus any cross-session
 * picks made from another source's own per-lap table — see ScatterChart.vue's
 * `ggSeries` for how the two selections are merged into `laps` before calling
 * this). Session identity still owns hue (`source.color`, same convention as
 * `buildMultiSessionScatter`) — only the point RANGE is lap-specific, colour
 * is not. A source with no lap picked in `laps` contributes nothing (mirrors
 * TimeSeriesChart's cross-session overlay: once ANY lap selection is active,
 * only sessions that actually have a lap picked are drawn — there's no
 * "whole session" fallback per source). Each lap gets its own series (so a
 * file with two selected laps draws two clouds), named `"<source> · <lap
 * label>"` (the label already localized by the caller) so the legend/tooltip
 * disambiguate which lap a point belongs to.
 */
export function buildMultiSessionScatterLaps(
  sources: readonly SessionScatterSource[],
  laps: readonly SessionScatterLapPick[],
  xName: string,
  yName: string,
  maxPoints = 5000,
  colorChannel?: string | null,
): SessionScatterSeries[] {
  const scale = looksLikeForce(xName) && looksLikeForce(yName) ? 0.001 : 1
  const out: SessionScatterSeries[] = []
  sources.forEach((source, index) => {
    const x = source.session.get(xName)
    const y = source.session.get(yName)
    if (!x || !y) return
    const symbol = markerShapeForIndex(index)
    const third = colorChannel ? source.session.get(colorChannel) : undefined
    const picks = laps.filter((lap) => lap.sourceId === source.id)
    for (const lap of picks) {
      const name = `${source.name} · ${lap.label}`
      if (third) {
        const { points, colorValues } = buildGgPointsWithColor(x.data, y.data, third.data, {
          scale,
          start: lap.startIdx,
          end: lap.endIdx,
          maxPoints,
        })
        out.push({ points, colorValues, color: source.color, name, symbol })
        continue
      }
      out.push({
        points: buildGgPoints(x.data, y.data, { scale, start: lap.startIdx, end: lap.endIdx, maxPoints }),
        color: source.color,
        name,
        symbol,
      })
    }
  })
  return out
}
