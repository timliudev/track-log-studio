import type { Lap } from '@/domain/model/Lap'

/**
 * One lap's travelled distance from a cumulative GPS-distance axis.
 *
 * Invalid, out-of-range, or degenerate ranges return NaN rather than
 * pretending to be a zero-distance lap; callers can then keep an unknown
 * distance out of automatic validity decisions.
 */
export function lapDistanceM(lap: Pick<Lap, 'startIdx' | 'endIdx'>, cumDistM: Float64Array | null): number {
  if (!cumDistM || cumDistM.length === 0) return Number.NaN
  const { startIdx: start, endIdx: end } = lap
  if (start < 0 || end >= cumDistM.length) return Number.NaN
  return end > start ? cumDistM[end] - cumDistM[start] : Number.NaN
}
