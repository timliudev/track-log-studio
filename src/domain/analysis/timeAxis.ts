import type { LogSession } from '@/domain/model/LogSession'

/**
 * Seconds-from-start per sample. Uses the Time/Timer channel (elapsed ms) when
 * present, otherwise derives from the sample index and the estimated interval.
 */
export function timeSeconds(session: LogSession): Float64Array {
  const n = session.rowCount
  const out = new Float64Array(n)
  const tc = session.timeChannel?.data
  if (tc && n > 0) {
    const t0 = tc[0]
    for (let i = 0; i < n; i++) out[i] = (tc[i] - t0) / 1000
    return out
  }
  const stepS = (session.sampleIntervalMs ?? 100) / 1000
  for (let i = 0; i < n; i++) out[i] = i * stepS
  return out
}
