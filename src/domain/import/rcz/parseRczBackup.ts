/**
 * Load ONE session out of a RaceChrono `.rcz` device backup (F3 stage 1 + 2).
 * See `listRczSessions.ts` for the backup shape and the non-OOM `unzipSync(
 * bytes, { filter })` mechanism this reuses — here the filter accepts only the
 * chosen session's own folder (`sessions/session_<key>/…`), so a single
 * session's channel files (tens of MB) are inflated, never the other ~700
 * sessions' worth of data (~12 GB) sitting alongside it in the same archive.
 *
 * All the actual decode logic (device-role resolution from
 * `sessionfragment.json`, master-clock choice, per-channel scale, GPS
 * special-casing, official-lap import, header info) is shared with the
 * single-session importer — see `parseRczCore.ts`'s module doc for the full
 * writeup and `docs/specs/RCZ-FORMAT-SPEC.md` for the validation numbers.
 * This file's only job is: filter-extract the chosen session's ZIP entries,
 * strip the `sessions/<key>/` prefix, split `session.json` /
 * `sessionfragment.json` from the channel-data files, and hand all three to
 * `buildRczSession`.
 *
 * `sessionKey` is `RczSessionInfo.key` from `listRczSessions` — the FULL
 * folder segment (e.g. `session_20260101_0800`), so the archive path is
 * `sessions/<sessionKey>/…`; both modules build that same prefix from the
 * identical capture group, so they stay in lock-step by construction.
 *
 * CALIBRATION STATUS: previously this module emitted every non-GPS,
 * non-distance channel as a raw, completely unscaled int32 with no unit,
 * because no scale factor had been validated against RaceChrono's own
 * display. That gap is now closed — `docs/specs/RCZ-FORMAT-SPEC.md` §5/§6
 * cross-references every int32 channel against RaceChrono's own CSV export
 * at matching timestamps (median error 0 across thousands of points per
 * channel) and the resulting scale/unit table is applied in
 * `parseRczCore.ts`'s `int32ScaleFor`. Channels with NO validated rule
 * (any id outside that table) are still emitted raw/unscaled — see
 * `int32ScaleFor`'s doc for why an unverified guess is refused there too.
 */
import { unzipSync } from 'fflate'
import type { LogSession } from '@/domain/model/LogSession'
import {
  parseChannelName,
  type ChannelFile,
} from './parseRcz'
import {
  buildRczSession,
  parseJsonEntry,
  type RczSessionFragmentJson,
  type RczSessionJson,
} from './parseRczCore'

/**
 * Parse ONE session from an `.rcz` device backup into a LogSession, decoding
 * EVERY device present (GPS + any CAN/ECU devices) joined onto whichever
 * device's clock has the most samples — see `parseRczCore.ts`'s module doc
 * for the master-clock rationale, naming rules and the scale table.
 */
export function parseRczBackupSession(bytes: Uint8Array, sessionKey: string): LogSession {
  const prefix = `sessions/${sessionKey}/`

  // --- streaming-filtered extract: ONLY this session's own files ---
  const entries = unzipSync(bytes, {
    filter: (file) => file.name.startsWith(prefix),
  })
  if (Object.keys(entries).length === 0) {
    throw new Error(`RCZ backup: no files found under ${prefix}`)
  }

  let sessionData: Uint8Array | undefined
  let fragmentData: Uint8Array | undefined
  const files = new Map<string, ChannelFile>()
  for (const [fullName, data] of Object.entries(entries)) {
    const baseName = fullName.slice(prefix.length)
    if (baseName === 'session.json') {
      sessionData = data
      continue
    }
    if (baseName === 'sessionfragment.json') {
      fragmentData = data
      continue
    }
    const parsed = parseChannelName(baseName)
    if (!parsed) continue
    files.set(baseName, { name: baseName, ...parsed, bytes: data })
  }

  const session = parseJsonEntry<RczSessionJson>(sessionData) ?? {}
  const fragment = parseJsonEntry<RczSessionFragmentJson>(fragmentData)

  return buildRczSession(files, session, fragment, { sessionKey })
}
