import type { LogSession } from '@/domain/model/LogSession'

/** Where the session's absolute start instant was derived from. */
export type StartSource = 'gpsUtc' | 'created'

/** The absolute UTC instant corresponding to the session's elapsed=0 sample. */
export interface StartAnchor {
  /** Milliseconds since the Unix epoch (UTC) at the first (elapsed=0) sample. */
  startUtcMs: number
  source: StartSource
}

/**
 * Derive the absolute UTC instant that corresponds to the session's first sample
 * (elapsed time = 0), so a time axis of elapsed seconds can be relabelled with the
 * real wall-clock time.
 *
 * Preference order:
 *  1. GPS UTC fix — when GPS_UTC_hh and a created date are both present, the first
 *     finite UTC fix gives a real instant; its date comes from the header's created
 *     date. The fix is then back-dated by its own elapsed offset so the anchor lines
 *     up with elapsed=0.
 *  2. Created date — its LOCAL wall-clock components are reinterpreted as UTC, so
 *     rendering at offset 0 reproduces the time printed in the header.
 *
 * Pure: no Date.now() and no timezone reads.
 * @param session the immutable parsed log
 * @returns the start anchor, or null when neither source is available
 */
export function sessionStartAnchor(session: LogSession): StartAnchor | null {
  const created = session.meta.createdDate

  if (session.has('GPS_UTC_hh') && created) {
    const hhArr = session.get('GPS_UTC_hh')?.data
    const mmArr = session.get('GPS_UTC_mm')?.data
    const ssArr = session.get('GPS_UTC_ss')?.data
    const msArr = session.get('GPS_UTC_ms')?.data
    const time = session.timeChannel?.data

    if (hhArr) {
      for (let i = 0; i < hhArr.length; i++) {
        const hh = hhArr[i]
        if (!Number.isFinite(hh)) continue
        const mm = mmArr ? mmArr[i] : NaN
        const ss = ssArr ? ssArr[i] : NaN
        const ms = msArr ? msArr[i] : NaN
        // Require minutes/seconds to be present to treat this as a valid fix.
        if (!Number.isFinite(mm) || !Number.isFinite(ss)) continue

        const fixUtcMs = Date.UTC(
          created.getFullYear(),
          created.getMonth(),
          created.getDate(),
          hh,
          mm,
          ss,
          Number.isFinite(ms) ? ms : 0,
        )
        // The time channel is elapsed-from-start; the fix is at sample i, so
        // subtract its elapsed offset to anchor the instant at elapsed=0.
        const elapsedMs = time ? time[i] - time[0] : 0
        return { startUtcMs: fixUtcMs - elapsedMs, source: 'gpsUtc' }
      }
    }
    // No finite fix — fall through to the created-date anchor below.
  }

  if (created) {
    const startUtcMs = Date.UTC(
      created.getFullYear(),
      created.getMonth(),
      created.getDate(),
      created.getHours(),
      created.getMinutes(),
      created.getSeconds(),
      created.getMilliseconds(),
    )
    return { startUtcMs, source: 'created' }
  }

  return null
}
