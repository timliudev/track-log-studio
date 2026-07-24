/**
 * RaceChrono `.rcz` single-session-export importer.
 *
 * An `.rcz` single-session export is a ZIP archive (no compression header
 * magic beyond the standard PK signature) containing, at the ZIP ROOT:
 *  - `session.json` — session metadata (timeCreated, trackName, bestLaptime,
 *    the official `laps[]` table…).
 *  - `sessionfragment.json` — the device list, keyed by device id, each with
 *    a `type` (1 = GPS, 2 = accelerometer, 3 = gyroscope, 4 = data device
 *    i.e. RC3/OBD/CAN, 8 = magnetometer). Device ids themselves have NO
 *    fixed meaning — only `type` does; see `parseRczCore.ts`'s module doc
 *    and `docs/specs/RCZ-FORMAT-SPEC.md` §3.2.
 *  - per-channel binary blobs named `channel[2]_<A>_<dev>_0_<id>_<type>`,
 *    where `<dev>` is the device id, `<id>` identifies the signal and the
 *    trailing `<type>` selects the element encoding:
 *      0 = int32 LE, 1 = int64 LE, 3 = float64 LE.
 *    Each blob is a bare little-endian array (no header); the element count
 *    is `byteLength / elemSize`.
 *
 * Each device's data arrays are index-aligned to its OWN int64 timestamp
 * stream (`channel_<A>_<dev>_0_1_1`). The device with the MOST samples
 * becomes the master Time axis; every other device's rows are joined onto
 * it by nearest timestamp. The actual per-channel decode (device-role
 * resolution, scale, GPS special-casing, lap import, header info) is shared
 * with the device-backup importer — see `parseRczCore.ts`.
 *
 * This file also hosts the channel-id naming (`decodeRcChannelName`) and the
 * low-level binary-array primitives (`ELEM_SIZE`, `parseChannelName`,
 * `readArray`, `readTimestamps`, `nearestIndexMap`), since `parseRczBackup.ts`
 * (device-backup sessions use the identical channel-file grammar, just
 * nested under a `sessions/session_<ID>/` prefix) and `parseRczCore.ts`
 * (the shared decode core) both import them from here.
 */
import { unzipSync } from 'fflate'
import type { LogSession } from '@/domain/model/LogSession'
import { buildRczSession, parseJsonEntry, type RczSessionFragmentJson, type RczSessionJson } from './parseRczCore'

/**
 * RaceChrono channel-id "low" codes (for k = 0) mapped to canonical names.
 * These names are shared across encodings: e.g. id 9 ("x acceleration") is
 * `rc_x_acc` whether it arrives as an int32 (phone/RC3 IMU, mm/s² raw) or a
 * float64 (OBD/CAN device, already G) — see `parseRczCore.ts`'s module doc
 * "★" for why scale, not name, is what depends on the encoding.
 */
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
  28: 'rc_x_magn',
  29: 'rc_y_magn',
  30: 'rc_z_magn',
}

const LO_MOD = 1_048_576

/**
 * Decode a RaceChrono channel id into a stable channel name. The id packs a
 * "low" signal code and a "bank" index `k`:
 *   lo = id % 1048576 ; k = floor(id / 1048576)
 * lo 5000/5001 are treated as a generic analog/digital "bank" fallback;
 * other lo values map via {@link NAMED_LO}. For k > 0 on a named code, a
 * `_<k+1>` suffix disambiguates.
 *
 * ⚠️ The `lo === 5000/5001` rule has NO sample evidence in either reference
 * archive (neither ever produced an id ≥ 1,048,576, nor 5000/5001 — see
 * RCZ-FORMAT-SPEC.md §9) and predates the validated RC3 analog/digital id
 * space (20002–20020, handled separately in `parseRczCore.ts` via
 * `rc3ChannelName` BEFORE this function is ever consulted for those ids).
 * It is kept only as a last-resort fallback for an id shape nothing else
 * recognises — treat it as unverified, not as a confirmed mapping.
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

/**
 * Element byte size for each RCZ channel type digit. Shared with
 * `parseRczBackup.ts` (device-backup sessions use the identical channel-file
 * grammar, just nested under a `sessions/session_<ID>/` prefix).
 */
export const ELEM_SIZE: Record<number, number> = { 0: 4, 1: 8, 3: 8 }

/** A parsed channel-file name, plus its (already-inflated) bytes. */
export interface ChannelFile {
  name: string
  dev: number
  id: number
  type: number
  bytes: Uint8Array
}

/**
 * Parse a `channel[2]_<A>_<dev>_0_<id>_<type>` file BASE name (no directory
 * prefix — callers reading a nested backup entry must strip the
 * `sessions/session_<ID>/` prefix first). Returns null when the name does not
 * match the channel-file shape.
 */
export function parseChannelName(name: string): { dev: number; id: number; type: number } | null {
  const m = name.match(/^channel2?_\d+_(\d+)_0_(\d+)_(\d+)$/)
  if (!m) return null
  return { dev: Number(m[1]), id: Number(m[2]), type: Number(m[3]) }
}

/** Read a bare little-endian numeric array into a number[] per its type. */
export function readArray(bytes: Uint8Array, type: number): number[] {
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
export function readTimestamps(files: Map<string, ChannelFile>, dev: number): number[] | null {
  const f = [...files.values()].find((c) => c.dev === dev && c.id === 1 && c.type === 1)
  return f ? readArray(f.bytes, 1) : null
}

/**
 * Build a nearest-neighbour index map from `dst` timestamps onto `src`
 * timestamps. Both are monotonically increasing; result[i] is the index into
 * `src` whose timestamp is closest to `dst[i]`. Used to join every non-master
 * device's rows onto the master clock (see `parseRczCore.ts`), and to locate
 * RaceChrono's own lap-boundary timestamps on the master clock.
 */
export function nearestIndexMap(dst: number[], src: number[]): Int32Array {
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

/** Parse a `.rcz` (RaceChrono single-session ZIP export) into a LogSession with formatId 'rcz'. */
export function parseRcz(bytes: Uint8Array): LogSession {
  const entries = unzipSync(bytes)

  const session = parseJsonEntry<RczSessionJson>(entries['session.json']) ?? {}
  const fragment = parseJsonEntry<RczSessionFragmentJson>(entries['sessionfragment.json'])

  const files = new Map<string, ChannelFile>()
  for (const [name, data] of Object.entries(entries)) {
    const parsed = parseChannelName(name)
    if (!parsed) continue
    files.set(name, { name, ...parsed, bytes: data })
  }

  return buildRczSession(files, session, fragment)
}
