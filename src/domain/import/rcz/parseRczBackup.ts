/**
 * Load ONE session out of a RaceChrono `.rcz` device backup (F3 stage 1 + 2).
 * See `listRczSessions.ts` for the backup shape and the non-OOM `unzipSync(
 * bytes, { filter })` mechanism this reuses — here the filter accepts only the
 * chosen session's own folder (`sessions/session_<key>/…`), so a single
 * session's channel files (tens of MB) are inflated, never the other ~700
 * sessions' worth of data (~12 GB) sitting alongside it in the same archive.
 *
 * Device roles are NOT fixed ids here (unlike the single-session `parseRcz`,
 * which hardcodes GPS=100/ECU=101 — that mapping is specific to RaceChrono's
 * single-session EXPORT and does not hold in a device backup: the validated
 * real backup has GPS at device id 200, model 101, with ids 100/101/102 being
 * CAN/ECU telemetry, type 2/3/8). Each device's role is instead read from
 * `sessionfragment.json`'s `devices.items[]` (`type === 1` ⇒ GPS; anything
 * else ⇒ CAN/ECU).
 *
 * STAGE 2 — MASTER CLOCK CHOICE: every device in a real backup has its OWN
 * int64 epoch-ms timestamp stream (`channel_<A>_<dev>_0_1_1`). Stage 1 forced
 * GPS to be the master clock (true for a single-session export, where GPS is
 * the only "master" candidate). In a device backup the GPS device is usually
 * the SPARSEST one — validated on a real 13.8 h backup: the three CAN devices
 * share one 50 Hz clock (~2,483,591 samples) while GPS is only 10 Hz (33,902
 * samples). Forcing GPS-as-master would throw away ~80% of the CAN devices'
 * time resolution for no reason, so instead: **the device with the MOST
 * timestamp samples becomes the master clock** (all devices span the same
 * session duration, so sample count is a direct, device-agnostic proxy for
 * rate — no need to compute or compare Hz explicitly). Every other device's
 * rows are joined onto the master clock by nearest-timestamp, exactly like
 * `parseRcz` already joins GPS onto the ECU master in a single-session
 * export (see `nearestIndexMap`). Ties (identical sample counts) are broken
 * by `sessionfragment.json`'s `devices.items[]` order, for a deterministic
 * result. A device with no readable timestamp stream contributes no channels
 * (there is nothing to join it onto the master clock by) but is still counted
 * in `headerInfo.undecodedDeviceCount`, so the gap stays visible rather than
 * silent.
 *
 * CHANNEL NAMING: every channel is named generically via the shared
 * `decodeRcChannelName(id)` / `NAMED_LO` table (same rule `parseRcz` uses for
 * the single-session ECU device) — no device or id is hardcoded here. GPS
 * (`device.type === 1`) keeps its five specially-decoded, already-validated
 * channels (lat/lon, speed, altitude, course, satellite count) exactly as
 * stage 1 emitted them. Channel id **2** (int64) is the one other
 * specially-decoded id, regardless of which device it appears on: validated
 * as CUMULATIVE DISTANCE in millimetres, monotonic from 0, sampled at the GPS
 * rate on the reference backup, whose last raw value matched `session.json`'s
 * `lengthDistance` exactly. Exposed as channel `distance` in **km** (raw/1e6)
 * to match the existing cross-importer convention (see `parseRcnx.ts`'s
 * `distance` column, also km).
 *
 * NAME COLLISIONS: multiple devices can produce the same `decodeRcChannelName`
 * result (e.g. two CAN devices both exposing raw accel on id 9 → `rc_x_acc`).
 * The unique-name guard first tries the plain name, then `<name>_dev<dev>`,
 * then `<name>_dev<dev>_<id>` — the last form is always unique because a
 * (device, id) pair identifies at most one channel file, so channels are
 * disambiguated deterministically rather than silently dropped.
 *
 * ⚠️ UNRESOLVED CALIBRATION — CAN accel/gyro (and any other non-GPS, non-
 * distance channel) are emitted as their **raw int32 values, completely
 * UNSCALED, with NO unit**. The real backup's raw ranges (accel ~-3219…-245,
 * gyro ~19409…-35400) do not match any scale factor that has been validated
 * against RaceChrono's own display — inventing a plausible-looking g / deg/s
 * divisor here would silently present WRONG physical units, which is worse
 * than admitting the gap. A future calibration pass needs a real backup
 * cross-checked against RaceChrono's own on-screen values for the same
 * channel/time range to derive (and validate) the true scale + offset. Until
 * then these channels are `rc_x_acc` / `rc_y_acc` / … / `rc_channel_<id>`
 * (unknown ids) with `unit: undefined` and raw integer magnitudes — do not
 * treat them as g or deg/s.
 */
import { unzipSync } from 'fflate'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import {
  decodeRcChannelName,
  nearestIndexMap,
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

/** One `sessionfragment.json` device-list entry. */
interface BackupDeviceEntry {
  id?: number
  model?: string
  type?: number
}

/** Minimal shape of a backup session's `sessionfragment.json`. */
interface SessionFragmentJson {
  devices?: { items?: BackupDeviceEntry[] }
}

const BEST_LAPTIME_UNSET_THRESHOLD = 1e15

/** A device with a successfully-read timestamp stream, ready to be joined. */
interface DecodableDevice {
  device: BackupDeviceEntry & { id: number }
  ts: number[]
}

/** Approximate sample rate (Hz) from a monotonic epoch-ms timestamp array. */
function approxRateHz(ts: number[]): number {
  if (ts.length < 2) return 0
  const spanMs = ts[ts.length - 1] - ts[0]
  if (spanMs <= 0) return 0
  return ((ts.length - 1) / spanMs) * 1000
}

/**
 * Parse ONE session from an `.rcz` device backup into a LogSession, decoding
 * EVERY device present (GPS + any CAN/ECU devices) joined onto whichever
 * device's clock has the most samples — see the module doc for the
 * master-clock rationale, naming rules and the unresolved accel/gyro
 * calibration caveat. `sessionKey` is `RczSessionInfo.key` from
 * `listRczSessions` — the FULL folder segment (e.g. `session_20260101_0800`),
 * so the archive path is `sessions/<sessionKey>/…`; both modules build that
 * same prefix from the identical capture group, so they stay in lock-step by
 * construction.
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

  // --- collect every device with a readable timestamp stream ---
  const decodable: DecodableDevice[] = []
  for (const d of devices) {
    if (typeof d.id !== 'number') continue
    const ts = readTimestamps(files, d.id)
    if (ts && ts.length > 0) decodable.push({ device: d as BackupDeviceEntry & { id: number }, ts })
  }
  if (decodable.length === 0) {
    throw new Error(`RCZ backup: no device with a timestamp stream found in ${prefix}`)
  }

  // --- master clock: the device with the MOST samples (see module doc) ---
  let master = decodable[0]
  for (const d of decodable) if (d.ts.length > master.ts.length) master = d
  const masterId = master.device.id
  const rowCount = master.ts.length
  const t0 = master.ts[0]

  const channels: Channel[] = []
  const used = new Set<string>()
  /** Push a channel, disambiguating by device then by (device,id) on collision. */
  const pushUnique = (
    baseName: string,
    dev: number,
    id: number,
    data: Float32Array,
    unit?: string,
  ): void => {
    let name = baseName
    if (used.has(name)) name = `${baseName}_dev${dev}`
    if (used.has(name)) name = `${baseName}_dev${dev}_${id}`
    if (used.has(name)) return // unreachable in practice: (dev,id) is unique per channel file
    used.add(name)
    channels.push({ name, rawName: name, description: undefined, unit, data })
  }

  // --- Time channel (ms, first = 0), from the chosen master clock ---
  const time = new Float32Array(rowCount)
  for (let i = 0; i < rowCount; i++) time[i] = master.ts[i] - t0
  pushUnique('Time', masterId, 0, time, 'ms')

  // --- every decodable device's channels, joined onto the master clock ---
  for (const { device, ts: devTs } of decodable) {
    const dev = device.id
    const isMaster = dev === masterId
    // Nearest-neighbour join from each master row to this device's own row
    // (skipped for the master device itself: identity map, exact by construction).
    const map = isMaster ? null : nearestIndexMap(master.ts, devTs)
    const idxAt = (i: number): number => (map ? map[i] : i)

    for (const f of files.values()) {
      if (f.dev !== dev) continue
      if (f.id === 1) continue // timestamp stream, already the row clock

      // GPS-special channels (same id grammar as parseRcz's device-100 branch),
      // only for the device flagged as GPS (type === 1) in sessionfragment.json.
      if (device.type === 1) {
        if (f.id === 3) {
          const flat = readArray(f.bytes, 0) // int32 PAIRS: lat, lon per 8-byte element.
          const lat = new Float32Array(rowCount)
          const lon = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            const latRaw = flat[idx * 2]
            const lonRaw = flat[idx * 2 + 1]
            lat[i] = latRaw === undefined ? NaN : latRaw / 6_000_000
            lon[i] = lonRaw === undefined ? NaN : lonRaw / 6_000_000 // keep sign (E +)
          }
          pushUnique('GPS_Lat', dev, f.id, lat, '°')
          pushUnique('GPS_Lon', dev, f.id, lon, '°')
          continue
        }
        if (f.id === 4) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? raw[idx] * 0.0036 : NaN // mm/s → km/h
          }
          pushUnique('GPS_Speed', dev, f.id, data, 'km/h')
          continue
        }
        if (f.id === 5) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? raw[idx] : NaN
          }
          pushUnique('GPS_Altitude', dev, f.id, data, 'm')
          continue
        }
        if (f.id === 6) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? raw[idx] / 1000 : NaN // millideg → deg
          }
          pushUnique('GPS_Course', dev, f.id, data, '°')
          continue
        }
        if (f.id === 30002) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? raw[idx] : NaN
          }
          pushUnique('Satellites', dev, f.id, data)
          continue
        }
      }

      // Cumulative distance — validated as id 2 (int64), independent of which
      // device it appears on (see module doc). mm → km, matching parseRcnx's
      // `distance` channel convention.
      if (f.id === 2 && f.type === 1) {
        const raw = readArray(f.bytes, 1)
        const data = new Float32Array(rowCount)
        for (let i = 0; i < rowCount; i++) {
          const idx = idxAt(i)
          data[i] = idx < raw.length ? raw[idx] / 1_000_000 : NaN
        }
        pushUnique('distance', dev, f.id, data, 'km')
        continue
      }

      // Everything else: generic decode + name via decodeRcChannelName, UNSCALED.
      // See module doc "UNRESOLVED CALIBRATION" — includes CAN accel/gyro
      // (ids 9-14 → rc_x_acc etc.) and any unknown id (→ rc_channel_<id>).
      const raw = readArray(f.bytes, f.type)
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) {
        const idx = idxAt(i)
        data[i] = idx < raw.length ? raw[idx] : NaN
      }
      pushUnique(decodeRcChannelName(f.id), dev, f.id, data)
    }
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

  headerInfo.deviceCount = String(devices.length)
  headerInfo.masterDeviceId = String(masterId)
  headerInfo.masterSampleRateHz = approxRateHz(master.ts).toFixed(1)
  for (const { device, ts } of decodable) {
    const channelCount = [...files.values()].filter((f) => f.dev === device.id && f.id !== 1).length
    headerInfo[`device_${device.id}_type`] = String(device.type ?? 'unknown')
    headerInfo[`device_${device.id}_channels`] = String(channelCount)
    headerInfo[`device_${device.id}_rateHz`] = approxRateHz(ts).toFixed(1)
  }
  const undecodedDeviceCount = devices.length - decodable.length
  if (undecodedDeviceCount > 0) headerInfo.undecodedDeviceCount = String(undecodedDeviceCount)

  const meta: LogMeta = { formatId: 'rcz', createdDate, headerInfo }
  return new LogSession(channels, meta)
}
