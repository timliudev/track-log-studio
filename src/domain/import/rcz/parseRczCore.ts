/**
 * Shared core for RaceChrono `.rcz` session decoding — used by BOTH
 * `parseRcz.ts` (single-session export: files at the ZIP root) and
 * `parseRczBackup.ts` (one session out of a multi-session device backup:
 * files nested under `sessions/<key>/…`). The only difference between the
 * two callers is how they get from raw ZIP bytes to a `{ files, session,
 * fragment }` triple (root vs. prefix-stripped, whole-archive vs.
 * `unzipSync(..., { filter })`-scoped) — everything past that point (device
 * role resolution, master-clock choice, channel decode/scale, lap import,
 * header info) is identical, so it lives here once. See
 * `docs/specs/RCZ-FORMAT-SPEC.md` for the full reverse-engineering writeup
 * and validation numbers this module implements.
 *
 * DEVICE ROLES are never hardcoded by id. `sessionfragment.json`'s
 * `devices.items[]` (or, if absent, `devices2[].selector`) gives each device
 * id a `type`: 1 = GPS, 2 = accelerometer, 3 = gyroscope, 4 = data device
 * (RC3 / OBD / CAN), 8 = magnetometer. Only `type === 1` (GPS) changes
 * decode behaviour here — the others all fall through to the generic
 * id-keyed channel decode, because (see below) scale is a function of the
 * channel's ENCODING and id, not which device it sits on. If
 * `sessionfragment.json` is missing entirely (or has no usable device list),
 * we fall back to inferring GPS from the presence of a readable id-3
 * (int64-shaped, actually int32-pair) channel — the one channel shape that
 * is GPS-specific by construction.
 *
 * MASTER CLOCK: the device with the MOST timestamp samples becomes the
 * master clock (every device spans the same session duration, so sample
 * count is a device-agnostic proxy for rate); ties are broken by device
 * order (the order devices appear in `sessionfragment.json`, or ascending
 * device id in the no-fragment fallback). Every other device's rows are
 * joined onto the master clock by nearest-timestamp (`nearestIndexMap`).
 *
 * SCALE: RCZ-FORMAT-SPEC.md §5/§6, validated by cross-referencing every
 * `.rcz` int32 sample against RaceChrono's own CSV export at the identical
 * timestamp (median error 0 across thousands of points per channel):
 *   - int32 channels store the physical value × 1000 in an SI unit (m, m/s,
 *     deg, µT, …) — EXCEPT lat/lon (× 6,000,000) and the pure counts
 *     `satellites` / `fix_type` (unscaled). Acceleration is the one
 *     exception to "× 1000": its SI unit is m/s², but RaceChrono's own UI
 *     (and every downstream export) shows acceleration in G, so we divide
 *     by 9806.65 (mm/s² → G) instead of by 1000.
 *   - float64 channels are ALREADY the physical value in RaceChrono's
 *     configured display unit (G, deg/s, rpm, %, °C, km/h, …) — no scale.
 *   - `2147483647` (INT32_MAX) is RaceChrono's own "no data" sentinel for
 *     EVERY int32 channel (confirmed: RaceChrono's own CSV export prints an
 *     empty cell at the exact same sample) — it always becomes `NaN`, even
 *     for ids with no known scale.
 * ★ The same channel id can appear with different encodings on different
 * devices (e.g. id 9 "x acceleration" is mm/s² as int32 on a phone/RC3
 * device, but already-scaled G as float64 on an OBD/CAN device) — so scale
 * selection below keys off (encoding, id), never id alone and never device
 * type alone.
 *
 * NAME COLLISIONS: multiple devices can produce the same decoded channel
 * name (e.g. two devices both exposing id 9). The unique-name guard tries
 * the plain name, then `<name>_dev<dev>`, then `<name>_dev<dev>_<id>` — the
 * last form is always unique because a (device, id) pair identifies at most
 * one channel file.
 */
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import {
  decodeRcChannelName,
  nearestIndexMap,
  readArray,
  readTimestamps,
  type ChannelFile,
} from './parseRcz'

/** One `session.json`'s `laps[]` entry (RaceChrono's own lap table). */
export interface RczLapEntry {
  number?: number
  startTimestamp?: number
  finishTimestamp?: number
  isInvalid?: boolean
  sessionResume?: number
}

/**
 * Minimal shape of `session.json` consumed here — a superset covering both
 * the single-session export shape and the device-backup per-session shape
 * (they overlap almost entirely; fields either side doesn't have are simply
 * absent/undefined).
 */
export interface RczSessionJson {
  timeCreated?: number
  firstTimestamp?: number
  title?: string
  trackName?: string
  bestLaptime?: number
  lapCount?: number
  trackId?: number
  lengthDistance?: number
  lengthTime?: number
  laps?: RczLapEntry[]
}

/** One `sessionfragment.json` device-list entry (either `devices.items[]` or `devices2[].selector` shape). */
export interface RczDeviceEntry {
  id?: number
  model?: number | string
  type?: number
}

/** Minimal shape of `sessionfragment.json` consumed here. */
export interface RczSessionFragmentJson {
  primaryGpsDeviceIndex?: number
  devices?: { items?: RczDeviceEntry[] }
  devices2?: { selector?: RczDeviceEntry }[]
}

/** Parse a JSON ZIP-entry's bytes, tolerating a missing or malformed entry. */
export function parseJsonEntry<T>(data: Uint8Array | undefined): T | null {
  if (!data) return null
  try {
    return JSON.parse(new TextDecoder().decode(data)) as T
  } catch {
    return null
  }
}

/**
 * RaceChrono stores `bestLaptime` as the Int64 max (`9223372036854775807`)
 * when no lap has completed yet; JSON round-trips it through a float64, so
 * it is not bit-exact — treat anything absurdly large as "unset".
 */
const BEST_LAPTIME_UNSET_THRESHOLD = 1e15

/** RaceChrono's "no data" sentinel for every int32 channel. */
const INT32_MAX_SENTINEL = 2147483647

/** A device with its resolved role (`type`, per `sessionfragment.json`). */
interface ResolvedDevice {
  id: number
  type: number | undefined
}

/**
 * Resolve every device's role from `sessionfragment.json`, preferring
 * `devices.items[]`, then `devices2[].selector`, then (if the fragment is
 * missing/empty) inferring purely from the channel files themselves — a
 * device with a readable id-3 channel is GPS (see module doc), everything
 * else is a generic "data" device (type 4). `primaryGpsDeviceIndex` is used
 * as a last-resort hint only when no device was otherwise resolved as GPS.
 */
function resolveDeviceRoles(
  fragment: RczSessionFragmentJson | null,
  files: Map<string, ChannelFile>,
): ResolvedDevice[] {
  const items = fragment?.devices?.items
  if (Array.isArray(items) && items.length > 0) {
    const resolved = items
      .filter((d): d is RczDeviceEntry & { id: number } => typeof d.id === 'number')
      .map((d) => ({ id: d.id, type: d.type }))
    if (resolved.length > 0) return applyPrimaryGpsHint(resolved, fragment)
  }

  const devices2 = fragment?.devices2
  if (Array.isArray(devices2) && devices2.length > 0) {
    const resolved = devices2
      .map((d) => d?.selector)
      .filter((s): s is RczDeviceEntry & { id: number } => !!s && typeof s.id === 'number')
      .map((s) => ({ id: s.id, type: s.type }))
    if (resolved.length > 0) return applyPrimaryGpsHint(resolved, fragment)
  }

  // No usable sessionfragment.json: infer roles from the channel files. A
  // device with a readable id-3 (int64-typed file, actually int32 lat/lon
  // pairs — see readTimestamps/id-3 handling below) is GPS; everything else
  // with its own timestamp stream is a generic data device. Device order is
  // ascending id, for a deterministic master-clock tie-break.
  const devIds = new Set<number>()
  for (const f of files.values()) devIds.add(f.dev)
  const allFiles = [...files.values()]
  return [...devIds]
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      type: allFiles.some((f) => f.dev === id && f.id === 3 && f.type === 1) ? 1 : 4,
    }))
}

/** Tag a device as GPS via `primaryGpsDeviceIndex` when nothing else already resolved one. */
function applyPrimaryGpsHint(
  devices: ResolvedDevice[],
  fragment: RczSessionFragmentJson | null,
): ResolvedDevice[] {
  if (devices.some((d) => d.type === 1)) return devices
  const hint = fragment?.primaryGpsDeviceIndex
  if (typeof hint !== 'number') return devices
  return devices.map((d) => (d.id === hint ? { ...d, type: 1 } : d))
}

/** A device with a successfully-read timestamp stream, ready to be joined. */
interface DecodableDevice {
  device: ResolvedDevice
  ts: number[]
}

/** Keep only devices with a readable own timestamp stream, in the given (role-resolution) order. */
function pickDecodableDevices(
  devices: ResolvedDevice[],
  files: Map<string, ChannelFile>,
): DecodableDevice[] {
  const out: DecodableDevice[] = []
  for (const d of devices) {
    const ts = readTimestamps(files, d.id)
    if (ts && ts.length > 0) out.push({ device: d, ts })
  }
  return out
}

/** The device with the most samples; ties go to whichever comes first (device order). */
function pickMaster(decodable: DecodableDevice[]): DecodableDevice {
  let master = decodable[0]
  for (const d of decodable) if (d.ts.length > master.ts.length) master = d
  return master
}

/** Approximate sample rate (Hz) from a monotonic epoch-ms timestamp array. */
function approxRateHz(ts: number[]): number {
  if (ts.length < 2) return 0
  const spanMs = ts[ts.length - 1] - ts[0]
  if (spanMs <= 0) return 0
  return ((ts.length - 1) / spanMs) * 1000
}

/** `raw`, or `NaN` when it is RaceChrono's INT32_MAX "no data" sentinel, scaled by `scale`. */
function scaledInt32(raw: number, scale: number): number {
  return raw === INT32_MAX_SENTINEL ? NaN : raw * scale
}

/**
 * Validated scale for an int32-encoded channel id — independent of which
 * device/device-type it appears on (see module doc "★"). Returns `null` for
 * ids with no validated scale: they stay raw/unscaled (still sentinel-
 * checked) rather than guessing a plausible-looking factor that was never
 * cross-checked against RaceChrono's own output.
 */
function int32ScaleFor(id: number): { unit?: string; scale: number } | null {
  // Accelerometer x/y/z: raw mm/s² → G (RCZ-FORMAT-SPEC.md §5.2/§6, max err 0.0061 G).
  if (id === 9 || id === 10 || id === 11) return { unit: 'G', scale: 1 / 9806.65 }
  // Gyroscope x/y/z: raw millideg/s → deg/s (max err 0.40 deg/s).
  if (id === 12 || id === 13 || id === 14) return { unit: 'deg/s', scale: 1 / 1000 }
  // Magnetometer x/y/z: raw nT → µT (max err 0.0064 µT).
  if (id === 28 || id === 29 || id === 30) return { unit: 'µT', scale: 1 / 1000 }
  // RC3 (type-4 device) digital1/2 + analog1-15 bank, all raw ×1000 → RC3
  // display unit (digital1 is shown by RaceChrono itself as RPM).
  if (id === 20002 || id === 20010) return { scale: 1 / 1000 }
  if (id >= 20003 && id <= 20007) return { scale: 1 / 1000 }
  if (id >= 20011 && id <= 20020) return { scale: 1 / 1000 }
  return null
}

/**
 * RC3 analog/digital channel name for the validated 20000-space ids (see
 * RCZ-FORMAT-SPEC.md §5.3 — order cross-checked against `.vbo` column order
 * AND per-point values). Returns null for any other id, including the
 * legacy `lo === 5000/5001` "bank" ids `decodeRcChannelName` still falls
 * back to — that older rule has NO sample evidence in either reference
 * archive and is kept purely as a last-resort fallback.
 */
function rc3ChannelName(id: number): string | null {
  if (id === 20002) return 'rc_digital_1'
  if (id === 20010) return 'rc_digital_2'
  if (id >= 20003 && id <= 20007) return `rc_analog_${id - 20002}` // 20003..20007 -> 1..5
  if (id >= 20011 && id <= 20020) return `rc_analog_${id - 20005}` // 20011..20020 -> 6..15
  return null
}

/**
 * Build an `IR_LapNumber`-style lap-counter channel (one integer per master-
 * clock row, incrementing at each lap boundary) from RaceChrono's OWN lap
 * table (`session.json`'s `laps[]`). Mirrors `parseRcnx.ts`'s
 * `buildLapNumberChannel` (Qstarz `sana_N.db` `lap` table) so the existing
 * `detectLapsByChannel` (`src/domain/analysis/laps.ts`) picks up RCZ's
 * official laps with NO analyzer changes — see RCZ-FORMAT-SPEC.md §3.1 / §8
 * item D.
 *
 * Unlike RCNX (which has an exact WayPoints row id per lap boundary), RCZ
 * only gives epoch-ms timestamps, so boundaries are located on the master
 * clock by NEAREST timestamp (`nearestIndexMap`) rather than an exact row
 * lookup. `isInvalid` laps still produce a counter transition (a boundary
 * exists) — like RCNX's `bFailed`, this detector has no failed-lap concept
 * upstream, so invalid laps are not specially flagged here; a future pass
 * could expose `isInvalid` as a separate channel if that distinction turns
 * out to matter downstream.
 */
function buildLapNumberChannelFromLaps(
  laps: RczLapEntry[] | undefined,
  masterTs: number[],
): Float32Array | null {
  if (!laps || laps.length === 0) return null
  const valid = laps.filter(
    (l): l is RczLapEntry & { startTimestamp: number; finishTimestamp: number } =>
      typeof l.startTimestamp === 'number' && typeof l.finishTimestamp === 'number',
  )
  if (valid.length === 0) return null

  const rowCount = masterTs.length
  const boundaryTs: number[] = []
  for (const l of valid) boundaryTs.push(l.startTimestamp, l.finishTimestamp)
  const idxMap = nearestIndexMap(boundaryTs, masterTs)

  const counter = new Float32Array(rowCount)
  let lapNo = 0
  let cursor = 0
  for (let li = 0; li < valid.length; li++) {
    const startIdx = idxMap[li * 2]
    const finishIdx = idxMap[li * 2 + 1]
    if (startIdx > cursor) {
      for (let i = cursor; i < startIdx && i < rowCount; i++) counter[i] = lapNo
      cursor = startIdx
    }
    lapNo += 1
    for (let i = cursor; i <= finishIdx && i < rowCount; i++) counter[i] = lapNo
    cursor = finishIdx + 1
  }
  // Trailing rows after the last lap's finish are a separate (incremented)
  // out-lap, not a continuation — this creates the closing edge for the
  // final lap. See parseRcnx.ts's buildLapNumberChannel for the full
  // rationale (identical shape, timestamp-indexed instead of wpId-indexed).
  if (lapNo > 0 && cursor < rowCount) {
    lapNo += 1
    for (let i = cursor; i < rowCount; i++) counter[i] = lapNo
  }
  return lapNo > 0 ? counter : null
}

/** Extra options for {@link buildRczSession}. */
export interface RczBuildOptions {
  /** Set only when decoding one session out of a device backup — becomes `headerInfo.sessionKey`. */
  sessionKey?: string
}

/**
 * Build a `LogSession` from an already-unzipped (and, for a backup, already
 * prefix-scoped) set of RCZ channel files plus their `session.json` /
 * `sessionfragment.json`. Shared by `parseRcz` (single-session export,
 * prefix `''`) and `parseRczBackupSession` (device backup, prefix
 * `sessions/<key>/`) — see module doc.
 */
export function buildRczSession(
  files: Map<string, ChannelFile>,
  session: RczSessionJson,
  fragment: RczSessionFragmentJson | null,
  opts: RczBuildOptions = {},
): LogSession {
  const devices = resolveDeviceRoles(fragment, files)
  const decodable = pickDecodableDevices(devices, files)
  if (decodable.length === 0) {
    throw new Error('RCZ: no device with a timestamp stream found')
  }

  const master = pickMaster(decodable)
  const masterId = master.device.id
  const rowCount = master.ts.length
  const t0 = master.ts[0]

  // Every device carries its OWN id-2 cumulative-distance file (see the id-2
  // branch below) — join'd onto the master clock they're all equivalent, so
  // emitting one per device just spams the channel picker with duplicates
  // (`distance` / `distance_dev101` / `distance_dev102` / …, all identical
  // end values). Pick exactly one source device up front: GPS (type 1, the
  // most trustworthy position-derived source) first, else the master-clock
  // device, else whichever decodable device came first — `masterId` always
  // exists once we get here, so that last tier is unreachable in practice
  // and kept only for documentation/defensiveness.
  const gpsDevice = decodable.find((d) => d.device.type === 1)
  const distanceSourceDev = gpsDevice?.device.id ?? masterId ?? decodable[0].device.id

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
    const map = isMaster ? null : nearestIndexMap(master.ts, devTs)
    const idxAt = (i: number): number => (map ? map[i] : i)

    for (const f of files.values()) {
      if (f.dev !== dev) continue
      if (f.id === 1) continue // timestamp stream, already the row clock

      // GPS-special channels — only for the device resolved as GPS (type 1).
      if (device.type === 1) {
        if (f.id === 3) {
          // int32 PAIRS (lat, lon) packed into an int64-sized file.
          const flat = readArray(f.bytes, 0)
          const lat = new Float32Array(rowCount)
          const lon = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            const latRaw = flat[idx * 2]
            const lonRaw = flat[idx * 2 + 1]
            lat[i] = latRaw === undefined ? NaN : scaledInt32(latRaw, 1 / 6_000_000)
            lon[i] = lonRaw === undefined ? NaN : scaledInt32(lonRaw, 1 / 6_000_000) // keep sign (E +)
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
            data[i] = idx < raw.length ? scaledInt32(raw[idx], 0.0036) : NaN // mm/s → km/h
          }
          pushUnique('GPS_Speed', dev, f.id, data, 'km/h')
          continue
        }
        if (f.id === 5) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? scaledInt32(raw[idx], 1 / 1000) : NaN // mm → m
          }
          pushUnique('GPS_Altitude', dev, f.id, data, 'm')
          continue
        }
        if (f.id === 6) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? scaledInt32(raw[idx], 1 / 1000) : NaN // millideg → deg
          }
          pushUnique('GPS_Course', dev, f.id, data, '°')
          continue
        }
        if (f.id === 30002) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? scaledInt32(raw[idx], 1) : NaN // unscaled count
          }
          pushUnique('Satellites', dev, f.id, data)
          continue
        }
        if (f.id === 30003) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? scaledInt32(raw[idx], 1) : NaN // unscaled enum
          }
          pushUnique('GPS_FixType', dev, f.id, data)
          continue
        }
        if (f.id === 30004) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? scaledInt32(raw[idx], 1 / 1000) : NaN // DOP ×1000
          }
          pushUnique('GPS_CoordinatePrecision', dev, f.id, data, 'DOP')
          continue
        }
        if (f.id === 30005) {
          const raw = readArray(f.bytes, 0)
          const data = new Float32Array(rowCount)
          for (let i = 0; i < rowCount; i++) {
            const idx = idxAt(i)
            data[i] = idx < raw.length ? scaledInt32(raw[idx], 1 / 1000) : NaN // DOP ×1000
          }
          pushUnique('GPS_AltitudePrecision', dev, f.id, data, 'DOP')
          continue
        }
      }

      // Cumulative distance — id 2 (int64), same content on every device
      // (validated: identical values across devices in the reference
      // single-session sample once joined onto the master clock). Every
      // device carries its own copy of this file, but we only want ONE
      // `distance` channel in the output — see `distanceSourceDev` above for
      // the GPS-first selection — so non-selected devices' id-2 files are
      // skipped entirely rather than emitted as `distance_devNNN` dupes.
      // mm → km, matching parseRcnx's `distance` channel convention.
      if (f.id === 2 && f.type === 1) {
        if (dev !== distanceSourceDev) continue
        const raw = readArray(f.bytes, 1)
        const data = new Float32Array(rowCount)
        for (let i = 0; i < rowCount; i++) {
          const idx = idxAt(i)
          data[i] = idx < raw.length ? raw[idx] / 1_000_000 : NaN
        }
        pushUnique('distance', dev, f.id, data, 'km')
        continue
      }

      if (f.type === 0) {
        // int32-encoded channel. Scale is id-based (see module doc "★"),
        // never device-type-based: the same id means the same physical
        // quantity regardless of which device's int32 stream it comes from.
        const rule = int32ScaleFor(f.id)
        const raw = readArray(f.bytes, 0)
        const data = new Float32Array(rowCount)
        const scale = rule?.scale ?? 1
        for (let i = 0; i < rowCount; i++) {
          const idx = idxAt(i)
          data[i] = idx < raw.length ? scaledInt32(raw[idx], scale) : NaN
        }
        const name = rc3ChannelName(f.id) ?? decodeRcChannelName(f.id)
        pushUnique(name, dev, f.id, data, rule?.unit)
        continue
      }

      // float64 (already the physical value in RaceChrono's display unit —
      // see module doc) and any other encoding: pass through unscaled.
      const raw = readArray(f.bytes, f.type)
      const data = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) {
        const idx = idxAt(i)
        data[i] = idx < raw.length ? raw[idx] : NaN
      }
      pushUnique(decodeRcChannelName(f.id), dev, f.id, data)
    }
  }

  // --- RaceChrono's own official laps → IR_LapNumber channel ---
  const lapChannel = buildLapNumberChannelFromLaps(session.laps, master.ts)
  if (lapChannel) pushUnique('IR_LapNumber', masterId, -1, lapChannel)

  // --- meta ---
  const createdEpoch = session.timeCreated ?? session.firstTimestamp
  const createdDate = typeof createdEpoch === 'number' ? new Date(createdEpoch) : null

  const headerInfo: Record<string, string> = {}
  if (opts.sessionKey) headerInfo.sessionKey = opts.sessionKey
  if (session.trackName) headerInfo.trackName = String(session.trackName)
  if (session.title) headerInfo.title = String(session.title)
  if (typeof session.bestLaptime === 'number' && session.bestLaptime < BEST_LAPTIME_UNSET_THRESHOLD) {
    headerInfo.bestLaptime = String(session.bestLaptime)
  }
  if (typeof session.lapCount === 'number') headerInfo.lapCount = String(session.lapCount)
  if (typeof session.trackId === 'number') headerInfo.trackId = String(session.trackId)
  if (typeof session.lengthDistance === 'number') {
    headerInfo.distanceKm = String(session.lengthDistance / 1_000_000)
  }

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
