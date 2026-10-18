import type { LogSession } from './LogSession'

/**
 * B139: the instant of a session's first (elapsed=0) sample derived from
 * `meta.createdDate`. For a `.loga` the created date is the logger's READBACK
 * moment (end of the ride, `meta.createdDateIsEnd`), so the start is
 * `createdDate − data duration`; for every other source it is the start itself.
 * Single shared rule for the VBO exporter and the analysis time axis.
 *
 * @param created   `meta.createdDate`
 * @param isEnd     `meta.createdDateIsEnd === true`
 * @param durationMs elapsed ms from first to last sample
 */
export function createdDateToStartMs(created: Date, isEnd: boolean, durationMs: number): number {
  return isEnd && Number.isFinite(durationMs) ? created.getTime() - durationMs : created.getTime()
}

/** Elapsed ms between the first and last sample (0 for an empty session). */
export function sessionDurationMs(session: LogSession): number {
  const n = session.rowCount
  if (n <= 0) return 0
  const t = session.timeChannel?.data
  if (t && t.length >= n) return t[n - 1] - t[0]
  return (n - 1) * (session.sampleIntervalMs ?? 100)
}
