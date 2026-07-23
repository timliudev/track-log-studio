/**
 * Load ONE session out of a RaceChrono `.rcz` device backup (F3 stage 1). See
 * `listRczSessions.ts` for the backup shape and the non-OOM `unzipSync(bytes,
 * { filter })` mechanism this reuses — here the filter accepts only the
 * chosen session's own folder (`sessions/session_<key>/…`), so a single
 * session's channel files (tens of MB) are inflated, never the other ~700
 * sessions' worth of data (~12 GB) sitting alongside it in the same archive.
 *
 * Device roles are NOT fixed ids here (unlike the single-session `parseRcz`,
 * which hardcodes GPS=100/ECU=101 — that mapping is specific to RaceChrono's
 * single-session EXPORT and does not hold in a device backup: the validated
 * real backup has GPS at device id 200, model 101, with ids 100/101/102 being
 * CAN/ECU telemetry, type 2/3/8). The GPS device for a session is instead
 * looked up from `sessionfragment.json`'s `devices.items[]` — the one entry
 * with `type === 1`.
 *
 * STAGE-1 SCOPE: only the GPS device's own channels are decoded (its int64
 * timestamp stream IS this function's Time channel — no cross-device
 * timestamp join is needed, unlike parseRcz's ECU-master/GPS-join model). CAN
 * / ECU devices (type 2/3/8, float64 telemetry) are present in a real backup
 * but are NOT decoded yet — the required generalisation (which device is the
 * "master" clock when GPS is no longer forced into that role, multi-device
 * channel-name collisions, per-device nearest-neighbour joins) needs its own
 * validated ground truth before landing; left as a clear follow-up. Detected
 * automatically and reported as `otherDeviceCount` in the resulting
 * `LogMeta.headerInfo` so the gap is visible in the UI rather than silent.
 */
import { unzipSync } from 'fflate'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import {
  decodeRcChannelName,
  parseChannelName,
  readArray,
  readTimestamps,
  type ChannelFile,
} from './parseRcz'

/** Minimal shape of a backup session's `session.json` that we consume. */
interface BackupSessionJson {
  timeCreated?: number
  firstTimestamp?: number
  lengthTime?: number
  lengthDistance?: number
  lapCount?: number
  bestLaptime?: number
  trackId?: number
}

/** Minimal shape of a backup session's `sessionfragment.json`. */
interface SessionFragmentJson {
  devices?: { items?: { id?: number; model?: string; type?: number }[] }
}

const BEST_LAPTIME_UNSET_THRESHOLD = 1e15

/**
 * Parse ONE session from an `.rcz` device backup into a LogSession, decoding
 * only that session's GPS device (auto-detected via `sessionfragment.json`'s
 * `type === 1`). `sessionKey` is `RczSessionInfo.key` from `listRczSessions`
 * — the FULL folder segment (e.g. `session_20260101_0800`), so the archive
 * path is `sessions/<sessionKey>/…`; both modules build that same prefix from
 * the identical capture group, so they stay in lock-step by construction.
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

  let session: BackupSessionJson = {}
  let fragment: SessionFragmentJson = {}
  const files = new Map<string, ChannelFile>()
  for (const [fullName, data] of Object.entries(entries)) {
    const baseName = fullName.slice(prefix.length)
    if (baseName === 'session.json') {
      try {
        session = JSON.parse(new TextDecoder().decode(data)) as BackupSessionJson
      } catch {
        session = {}
      }
      continue
    }
    if (baseName === 'sessionfragment.json') {
      try {
        fragment = JSON.parse(new TextDecoder().decode(data)) as SessionFragmentJson
      } catch {
        fragment = {}
      }
      continue
    }
    const parsed = parseChannelName(baseName)
    if (!parsed) continue
    files.set(baseName, { name: baseName, ...parsed, bytes: data })
  }

  const devices = fragment.devices?.items ?? []
  const gpsDevice = devices.find((d) => d.type === 1)
  if (!gpsDevice || typeof gpsDevice.id !== 'number') {
    throw new Error(`RCZ backup: no GPS device (type 1) found in ${prefix}sessionfragment.json`)
  }
  const gpsDev = gpsDevice.id

  // --- master clock: the GPS device's own int64 timestamp stream ---
  const gpsTs = readTimestamps(files, gpsDev)
  if (!gpsTs || gpsTs.length === 0) {
    throw new Error(`RCZ backup: missing GPS timestamp stream (device ${gpsDev}) in ${prefix}`)
  }
  const rowCount = gpsTs.length
  const t0 = gpsTs[0]

  const channels: Channel[] = []
  const used = new Set<string>()
  const pushUnique = (baseName: string, id: number, data: Float32Array, unit?: string): void => {
    let name = baseName
    if (used.has(name)) name = `${baseName}_${id}`
    if (used.has(name)) return
    used.add(name)
    channels.push({ name, rawName: name, description: undefined, unit, data })
  }

  // --- Time channel (ms, first = 0), directly from the GPS master clock ---
  const time = new Float32Array(rowCount)
  for (let i = 0; i < rowCount; i++) time[i] = gpsTs[i] - t0
  pushUnique('Time', 0, time, 'ms')

  // --- GPS channels (same id grammar as parseRcz's device-100 branch) ---
  for (const f of files.values()) {
    if (f.dev !== gpsDev) continue // other devices: see module doc TODO
    if (f.id === 1) continue // timestamp stream, handled above
    if (f.id === 3) {
      const flat = readArray(f.bytes, 0) // int32 PAIRS: lat, lon per 8-byte element.
      const lat = new Float32Array(rowCount)
      const lon = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) {
        const latRaw = flat[i * 2]
        const lonRaw = flat[i * 2 + 1]
        lat[i] = latRaw === undefined ? NaN : latRaw / 6_000_000
        lon[i] = lonRaw === undefined ? NaN : lonRaw / 6_000_000 // keep sign (E +)
      }
      pushUnique('GPS_Lat', 0, lat, '°')
      pushUnique('GPS_Lon', 0, lon, '°')
      continue
    }
    if (f.id === 4) {
      const raw = readArray(f.bytes, 0)
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) data[i] = i < raw.length ? raw[i] * 0.0036 : NaN // mm/s → km/h
      pushUnique('GPS_Speed', f.id, data, 'km/h')
      continue
    }
    if (f.id === 5) {
      const raw = readArray(f.bytes, 0)
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) data[i] = i < raw.length ? raw[i] : NaN
      pushUnique('GPS_Altitude', f.id, data, 'm')
      continue
    }
    if (f.id === 6) {
      const raw = readArray(f.bytes, 0)
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) data[i] = i < raw.length ? raw[i] / 1000 : NaN // millideg → deg
      pushUnique('GPS_Course', f.id, data, '°')
      continue
    }
    if (f.id === 30002) {
      const raw = readArray(f.bytes, 0)
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) data[i] = i < raw.length ? raw[i] : NaN
      pushUnique('Satellites', f.id, data)
      continue
    }
    // Other GPS-device channels: decode + name generically, same fallback as parseRcz.
    const raw = readArray(f.bytes, f.type)
    const data = new Float32Array(rowCount)
    for (let i = 0; i < rowCount; i++) data[i] = i < raw.length ? raw[i] : NaN
    pushUnique(decodeRcChannelName(f.id), f.id, data)
  }

  // --- meta ---
  const createdEpoch = session.timeCreated ?? session.firstTimestamp
  const createdDate = typeof createdEpoch === 'number' ? new Date(createdEpoch) : null
  const headerInfo: Record<string, string> = { sessionKey }
  if (typeof session.lapCount === 'number') headerInfo.lapCount = String(session.lapCount)
  if (typeof session.lengthDistance === 'number') {
    headerInfo.distanceKm = String(session.lengthDistance / 1_000_000)
  }
  if (typeof session.bestLaptime === 'number' && session.bestLaptime < BEST_LAPTIME_UNSET_THRESHOLD) {
    headerInfo.bestLaptime = String(session.bestLaptime)
  }
  if (typeof session.trackId === 'number') headerInfo.trackId = String(session.trackId)
  const otherDeviceCount = devices.filter((d) => d.id !== gpsDev).length
  if (otherDeviceCount > 0) headerInfo.otherDeviceCount = String(otherDeviceCount)

  const meta: LogMeta = { formatId: 'rcz', createdDate, headerInfo }
  return new LogSession(channels, meta)
}
