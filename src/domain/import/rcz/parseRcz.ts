/**
 * RaceChrono RCZ importer.
 *
 * An `.rcz` is a ZIP archive (no compression header magic beyond the standard
 * PK signature) containing:
 *  - `session.json` — session metadata (timeCreated, trackName, title, laps…).
 *  - per-channel binary blobs named `channel[2]_<A>_<dev>_0_<id>_<type>`, where
 *    `<dev>` is the device (100 = GPS, 101 = ECU), `<id>` identifies the signal
 *    and the trailing `<type>` selects the element encoding:
 *      0 = int32 LE, 1 = int64 LE, 3 = float64 LE.
 *    Each blob is a bare little-endian array (no header); the element count is
 *    `byteLength / elemSize`.
 *
 * Each device's data arrays are index-aligned to its OWN int64 timestamp stream
 * (`channel_<A>_<dev>_0_1_1`, ~32 Hz). The ECU stream is the master Time axis;
 * GPS channels are joined onto the ECU rows by nearest timestamp.
 *
 * GPS (device 100) special channels (keyed by `<id>`):
 *  - 1  (int64)  epoch-ms timestamp stream.
 *  - 3  (int32 PAIRS) lat/lon: each 8-byte element is two int32; degrees =
 *        intval / 6_000_000. Longitude keeps its sign (E positive).
 *  - 4  (int32)  velocity in mm/s → km/h = v * 0.0036.
 *  - 5  (int32)  altitude (m).
 *  - 6  (int32)  heading in millidegrees → deg = v / 1000.
 *  - 30002 (int32) satellite count.
 *
 * ECU (device 101):
 *  - `channel_<A>_101_0_1_1` (int64) epoch-ms timestamp stream (master clock).
 *  - `channel_<A>_101_0_2_1` counter (ignored).
 *  - `channel2_<A>_101_0_<id>_3` (float64) telemetry, named via the id rule.
 */
import { unzipSync } from 'fflate'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'

/** RaceChrono channel-id "low" codes (for k = 0) mapped to canonical names. */
const NAMED_LO: Record<number, string> = {
  10024: 'rc_rpm',
  1023: 'rc_air_fuel_ratio',
  10028: 'rc_timing_advance',
  10029: 'rc_intake_temp',
  10025: 'rc_throttle_pos',
  10026: 'rc_coolant_temp',
  10063: 'rc_ecu_voltage',
  66551: 'rc_wheel_speed_front',
  33783: 'rc_wheel_speed_rear',
  9: 'rc_x_acc',
  10: 'rc_y_acc',
  11: 'rc_z_acc',
  12: 'rc_x_rate_of_rotation',
  13: 'rc_y_rate_of_rotation',
  14: 'rc_z_rate_of_rotation',
}

const LO_MOD = 1_048_576

/**
 * Decode a RaceChrono channel id into a stable channel name. The id packs a
 * "low" signal code and a "bank" index `k`:
 *   lo = id % 1048576 ; k = floor(id / 1048576)
 * lo 5000/5001 are generic analog/digital banks; other lo values map via
 * {@link NAMED_LO}. For k > 0 on a named code, a `_<k+1>` suffix disambiguates.
 */
export function decodeRcChannelName(id: number): string {
  const lo = id % LO_MOD
  const k = Math.floor(id / LO_MOD)
  if (lo === 5000) return `rc_analog_${k}`
  if (lo === 5001) return `rc_digital_${k}`
  const named = NAMED_LO[lo]
  if (named) return k > 0 ? `${named}_${k + 1}` : named
  return `rc_channel_${id}`
}

/** Element byte size for each RCZ channel type digit. */
const ELEM_SIZE: Record<number, number> = { 0: 4, 1: 8, 3: 8 }

/** A parsed channel-file name. */
interface ChannelFile {
  name: string
  dev: number
  id: number
  type: number
  bytes: Uint8Array
}

/**
 * Parse a `channel[2]_<A>_<dev>_0_<id>_<type>` file name. Returns null when the
 * name does not match the channel-file shape.
 */
function parseChannelName(name: string): { dev: number; id: number; type: number } | null {
  const m = name.match(/^channel2?_\d+_(\d+)_0_(\d+)_(\d+)$/)
  if (!m) return null
  return { dev: Number(m[1]), id: Number(m[2]), type: Number(m[3]) }
}

/** Read a bare little-endian numeric array into a number[] per its type. */
function readArray(bytes: Uint8Array, type: number): number[] {
  const size = ELEM_SIZE[type]
  if (!size) return []
  const n = Math.floor(bytes.byteLength / size)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const off = i * size
    if (type === 0) out[i] = dv.getInt32(off, true)
    else if (type === 1) out[i] = Number(dv.getBigInt64(off, true))
    else out[i] = dv.getFloat64(off, true)
  }
  return out
}

/** Read the int64 epoch-ms timestamp stream for a device, or null if absent. */
function readTimestamps(files: Map<string, ChannelFile>, dev: number): number[] | null {
  const f = [...files.values()].find((c) => c.dev === dev && c.id === 1 && c.type === 1)
  return f ? readArray(f.bytes, 1) : null
}

/**
 * Build a nearest-neighbour index map from `dst` timestamps onto `src`
 * timestamps. Both are monotonically increasing; result[i] is the index into
 * `src` whose timestamp is closest to `dst[i]`. Used to join GPS rows onto the
 * ECU master clock.
 */
function nearestIndexMap(dst: number[], src: number[]): Int32Array {
  const map = new Int32Array(dst.length)
  if (src.length === 0) return map
  let j = 0
  for (let i = 0; i < dst.length; i++) {
    const t = dst[i]
    while (j + 1 < src.length && Math.abs(src[j + 1] - t) <= Math.abs(src[j] - t)) j++
    map[i] = j
  }
  return map
}

/** Minimal shape of session.json that we consume. */
interface SessionJson {
  timeCreated?: number
  firstTimestamp?: number
  title?: string
  trackName?: string
  bestLaptime?: number
}

/** Parse a `.rcz` (RaceChrono ZIP) into a LogSession with formatId 'rcz'. */
export function parseRcz(bytes: Uint8Array): LogSession {
  const entries = unzipSync(bytes)

  // --- session.json metadata ---
  let session: SessionJson = {}
  const sessionRaw = entries['session.json']
  if (sessionRaw) {
    try {
      session = JSON.parse(new TextDecoder().decode(sessionRaw)) as SessionJson
    } catch {
      session = {}
    }
  }

  // --- index channel files ---
  const files = new Map<string, ChannelFile>()
  for (const [name, data] of Object.entries(entries)) {
    const parsed = parseChannelName(name)
    if (!parsed) continue
    files.set(name, { name, ...parsed, bytes: data })
  }

  // --- master clock: ECU timestamp stream ---
  const ecuTs = readTimestamps(files, 101)
  if (!ecuTs || ecuTs.length === 0) {
    throw new Error('RCZ: missing ECU timestamp stream (channel_*_101_0_1_1)')
  }
  const rowCount = ecuTs.length
  const t0 = ecuTs[0]

  const channels: Channel[] = []
  const used = new Set<string>()
  /** Push a channel, ensuring its name is unique (else append `_<id>`). */
  const pushUnique = (baseName: string, id: number, data: Float32Array, unit?: string): void => {
    let name = baseName
    if (used.has(name)) name = `${baseName}_${id}`
    if (used.has(name)) return // give up rather than collide silently
    used.add(name)
    channels.push({ name, rawName: name, description: undefined, unit, data })
  }

  // --- Time channel (ms, first = 0) from ECU clock ---
  const time = new Float32Array(rowCount)
  for (let i = 0; i < rowCount; i++) time[i] = ecuTs[i] - t0
  pushUnique('Time', 0, time, 'ms')

  // --- ECU telemetry: channel2_*_101_0_<id>_3 (float64) ---
  for (const f of files.values()) {
    if (f.dev !== 101 || f.type !== 3) continue
    const raw = readArray(f.bytes, 3)
    const data = new Float32Array(rowCount)
    for (let i = 0; i < rowCount; i++) data[i] = i < raw.length ? raw[i] : NaN
    pushUnique(decodeRcChannelName(f.id), f.id, data)
  }

  // --- GPS channels (device 100), joined onto the ECU clock by timestamp ---
  const gpsTs = readTimestamps(files, 100)
  // Nearest-neighbour map from each ECU row to a GPS sample index.
  const gpsMap =
    gpsTs && gpsTs.length > 0 ? nearestIndexMap(ecuTs, gpsTs) : null
  const sampleAt = (raw: number[], row: number): number => {
    const idx = gpsMap ? gpsMap[row] : row
    return idx < raw.length ? raw[idx] : NaN
  }
  const pushGps = (
    name: string,
    raw: number[],
    transform: (v: number) => number,
    unit?: string,
  ): void => {
    const data = new Float32Array(rowCount)
    for (let i = 0; i < rowCount; i++) {
      const v = sampleAt(raw, i)
      data[i] = Number.isFinite(v) ? transform(v) : NaN
    }
    pushUnique(name, 0, data, unit)
  }

  for (const f of files.values()) {
    if (f.dev !== 100) continue
    if (f.id === 1) continue // timestamp stream, handled above
    if (f.id === 3) {
      // int32 PAIRS: lat, lon per 8-byte element.
      const flat = readArray(f.bytes, 0) // int32 stream
      const lat = new Float32Array(rowCount)
      const lon = new Float32Array(rowCount)
      for (let i = 0; i < rowCount; i++) {
        const idx = gpsMap ? gpsMap[i] : i
        const latRaw = flat[idx * 2]
        const lonRaw = flat[idx * 2 + 1]
        lat[i] = latRaw === undefined ? NaN : latRaw / 6_000_000
        lon[i] = lonRaw === undefined ? NaN : lonRaw / 6_000_000 // keep sign (E +)
      }
      pushUnique('GPS_Lat', 0, lat, '°')
      pushUnique('GPS_Lon', 0, lon, '°')
      continue
    }
    if (f.id === 4) {
      pushGps('GPS_Speed', readArray(f.bytes, 0), (v) => v * 0.0036, 'km/h') // mm/s → km/h
      continue
    }
    if (f.id === 5) {
      pushGps('GPS_Altitude', readArray(f.bytes, 0), (v) => v, 'm')
      continue
    }
    if (f.id === 6) {
      pushGps('GPS_Course', readArray(f.bytes, 0), (v) => v / 1000, '°') // millideg → deg
      continue
    }
    if (f.id === 30002) {
      pushGps('Satellites', readArray(f.bytes, 0), (v) => v)
      continue
    }
    // Other device-100 channels: decode + name generically.
    pushGps(decodeRcChannelName(f.id), readArray(f.bytes, f.type), (v) => v)
  }

  // --- meta ---
  const createdEpoch = session.timeCreated ?? session.firstTimestamp
  const createdDate =
    typeof createdEpoch === 'number' ? new Date(createdEpoch) : null
  const headerInfo: Record<string, string> = {}
  if (session.trackName) headerInfo.trackName = String(session.trackName)
  if (session.title) headerInfo.title = String(session.title)
  if (typeof session.bestLaptime === 'number') {
    headerInfo.bestLaptime = String(session.bestLaptime)
  }

  const meta: LogMeta = { formatId: 'rcz', createdDate, headerInfo }
  return new LogSession(channels, meta)
}
