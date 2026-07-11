import type { LogSession } from '@/domain/model/LogSession'
import { buildGgPoints, buildGgPointsWithColor, looksLikeForce } from './ggData'

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
  /** Optional third-channel values aligned with `points`, retained for the
   * tooltip while `color` continues to encode session identity. */
  tooltipValues?: number[]
}

/** Build one bounded point cloud per session. Missing channel pairs are
 * skipped so recordings from different logger configurations can coexist. */
export function buildMultiSessionScatter(
  sources: readonly SessionScatterSource[],
  xName: string,
  yName: string,
  maxPoints = 5000,
  tooltipChannel?: string | null,
): SessionScatterSeries[] {
  const scale = looksLikeForce(xName) && looksLikeForce(yName) ? 0.001 : 1
  const out: SessionScatterSeries[] = []
  for (const source of sources) {
    const x = source.session.get(xName)
    const y = source.session.get(yName)
    if (!x || !y) continue
    const third = tooltipChannel ? source.session.get(tooltipChannel) : undefined
    if (third) {
      const { points, colorValues } = buildGgPointsWithColor(x.data, y.data, third.data, {
        scale,
        maxPoints,
      })
      out.push({
        points,
        tooltipValues: colorValues,
        color: source.color,
        name: source.name,
      })
      continue
    }
    out.push({
      points: buildGgPoints(x.data, y.data, { scale, maxPoints }),
      color: source.color,
      name: source.name,
    })
  }
  return out
}
