import type { LogSession } from '@/domain/model/LogSession'
import { buildGgPoints, looksLikeForce } from './ggData'

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
}

/** Build one bounded point cloud per session. Missing channel pairs are
 * skipped so recordings from different logger configurations can coexist. */
export function buildMultiSessionScatter(
  sources: readonly SessionScatterSource[],
  xName: string,
  yName: string,
  maxPoints = 5000,
): SessionScatterSeries[] {
  const scale = looksLikeForce(xName) && looksLikeForce(yName) ? 0.001 : 1
  const out: SessionScatterSeries[] = []
  for (const source of sources) {
    const x = source.session.get(xName)
    const y = source.session.get(yName)
    if (!x || !y) continue
    out.push({
      points: buildGgPoints(x.data, y.data, { scale, maxPoints }),
      color: source.color,
      name: source.name,
    })
  }
  return out
}
