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

/** One selected lap belonging to a particular `SessionScatterSource` (matched
 * by `sourceId`, i.e. the file id) — see {@link buildMultiSessionScatterLaps}. */
export interface SessionScatterLapPick {
  sourceId: number
  index: number
  startIdx: number
  endIdx: number
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
 * file with two selected laps draws two clouds), named `"<source> · #<lap>"`
 * so the legend/tooltip disambiguate which lap a point belongs to.
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
      const name = `${source.name} · #${lap.index + 1}`
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
