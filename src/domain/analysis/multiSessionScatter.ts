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
