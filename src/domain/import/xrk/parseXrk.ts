/**
 * AiM `.xrk` importer (Solo 2 DL / MyChron5 loggers).
 *
 * `.xrk` is a FLAT little-endian message stream from offset 0 — there is no
 * header index. A linear scanner dispatches on each message's 2-byte opcode and
 * tolerates corruption by backing up one byte ("bad bytes") rather than
 * aborting. See docs/specs/XRK-FORMAT-SPEC.md for the full reverse-engineered spec.
 *
 * Message families (opcode = first 2 bytes, little-endian u16):
 *  - `<h` (0x6863) H-message: header(12B) + payload(hlen) + footer(8B). Carries
 *    config (CNF→CHS channel table), GPS, LAP, track, and metadata.
 *  - `(S` (0x5328) S-message: one sample for a channel.
 *  - `(M` (0x4D28) M-message: a batch of `count` periodic samples.
 *  - `(c` (0x6328) c-message: an alternate single-sample encoding.
 *  - `(G` (0x4728) G-message: interleaved group samples (unused in our samples).
 *
 * The CNF channel table MUST be parsed first because every S/M/c message length
 * is driven by its channel's `size`. Each channel carries its own timecodes; we
 * resample every channel onto one common Time axis (ms, starting at 0) with a
 * forward-fill / nearest two-pointer join.
 */
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import { ecefToLla } from './ecef'

// --- opcode / framing constants (little-endian u16 of the 2 ASCII bytes) ---
// '<'=0x3c 'h'=0x68 → 0x683c. (The spec appendix's 0x6863 is byte-swapped.)
const OP_H = 0x683c // '<h'
const OP_S = 0x5328 // '(S'
const OP_M = 0x4d28 // '(M'
const OP_C = 0x6328 // '(c'
const OP_G = 0x4728 // '(G'
const TERMINATOR = 0x29 // ')'
const CL = 0x3e // '>'

/** A channel definition decoded from a CHS record (112 bytes). */
interface ChannelDef {
  index: number
  shortName: string
  longName: string
  size: number
  unitCode: number
  decoder: number
  rateCode: number
}

/** A raw, undecoded sample: an absolute timecode (ms) and its source bytes. */
interface RawSample {
  tc: number
  off: number // byte offset into the file of this sample's data
}

/** A 56-byte GPS ECEF record. */
interface GpsRecord {
  tc: number
  x: number // cm
  y: number
  z: number
  vx: number // cm/s
  vy: number
  vz: number
}

/** A lap marker. */
interface LapRecord {
  lap: number
  durationMs: number
  endTimeMs: number
}

/** Unit map: `unknown[12] & 127` → [unit string, decimal places]. */
const UNIT_MAP: Record<number, string> = {
  1: '%',
  3: 'G',
  4: 'deg',
  5: 'deg/s',
  6: '',
  9: 'Hz',
  11: '',
  12: 'mm',
  14: 'bar',
  15: 'rpm',
  16: 'km/h',
  17: 'C',
  18: 'ms',
  19: 'Nm',
  20: 'km/h',
  21: 'V',
  22: 'l',
  24: 'l/s',
  26: 'time?',
  27: 'A',
  30: 'lambda',
  31: 'gear',
  33: '%',
  37: 'mG',
  43: 'kg',
  44: '',
}

/** M-message per-sample interval (ms) by `rateCode & 127`. */
function mmsLookup(rateCode: number): number | null {
  switch (rateCode & 127) {
    case 8:
      return 5 // 200 Hz
    case 16:
      return 10 // 100 Hz
    case 32:
      return 20 // 50 Hz
    case 64:
      return 40 // 25 Hz
    case 80:
      return 50 // 20 Hz
    default:
      return null
  }
}

/** Gear table for decoder 15: index → label, mapped back to a numeric gear. */
function gearValue(raw: number): number {
  // The 64-bit field packs the gear in bits 16..18; bit 19 set = neutral.
  if (raw & 0x80000) return 0
  return (raw >> 16) & 7
}

/**
 * Decode an IEEE-754 half-precision (float16) bit pattern to a float32 value.
 * JS has no native half; do it by hand.
 */
export function float16ToFloat32(h: number): number {
  const sign = (h & 0x8000) >> 15
  const exp = (h & 0x7c00) >> 10
  const frac = h & 0x03ff
  let value: number
  if (exp === 0) {
    // subnormal (or zero)
    value = frac * Math.pow(2, -24)
  } else if (exp === 0x1f) {
    // inf / nan
    value = frac === 0 ? Infinity : NaN
  } else {
    value = (1 + frac / 1024) * Math.pow(2, exp - 15)
  }
  return sign ? -value : value
}

/** Read a NUL-terminated ASCII string from a fixed-width field. */
function readCString(dv: DataView, off: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    const c = dv.getUint8(off + i)
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  return s.trim()
}

/** Decode the token (`tok`) integer to its 1–4 char ASCII string. */
function decodeToken(tok: number): string {
  // Strip a trailing space encoded in the top byte (e.g. 'TRK ' → 'TRK').
  if ((tok >>> 24) === 0x20) tok -= 0x20 << 24
  let s = ''
  let i = tok >>> 0
  while (i) {
    s += String.fromCharCode(i & 0xff)
    i = Math.floor(i / 256)
  }
  return s
}

/** Parse a single 112-byte CHS record into a ChannelDef. */
export function parseChsRecord(payload: Uint8Array): ChannelDef {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    index: dv.getUint16(0, true),
    shortName: readCString(dv, 24, 8),
    longName: readCString(dv, 32, 24),
    size: dv.getUint8(72),
    unitCode: dv.getUint8(12) & 127,
    decoder: dv.getUint8(20),
    rateCode: dv.getUint8(64) & 127,
  }
}

/** Internal result of the linear scan, before resampling. */
interface ScanResult {
  channels: Map<number, ChannelDef>
  samples: Map<number, RawSample[]>
  gps: GpsRecord[]
  laps: LapRecord[]
  meta: Record<string, string>
  /** Track start/finish line and name from the TRK chunk. */
  track: { name?: string; sfLat?: number; sfLon?: number }
}

/**
 * Recursively parse a CNF payload (a nested H-message stream) into the channel
 * table. Each CHS record (hlen=112) defines one channel.
 */
function parseCnf(payload: Uint8Array, channels: Map<number, ChannelDef>): void {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  let pos = 0
  const end = payload.byteLength
  while (pos + 12 <= end) {
    const op = dv.getUint16(pos, true)
    if (op !== OP_H) {
      pos++
      continue
    }
    const tok = dv.getUint32(pos + 2, true)
    const hlen = dv.getInt32(pos + 6, true)
    const cl = dv.getUint8(pos + 11)
    if (cl !== CL || hlen < 0 || pos + 12 + hlen + 8 > end) {
      pos++
      continue
    }
    const token = decodeToken(tok)
    const innerOff = payload.byteOffset + pos + 12
    if (token === 'CHS' && hlen >= 73) {
      const rec = parseChsRecord(new Uint8Array(payload.buffer, innerOff, hlen))
      if (!channels.has(rec.index)) channels.set(rec.index, rec)
    } else if (token === 'ENF') {
      // nested config container — recurse
      parseCnf(new Uint8Array(payload.buffer, innerOff, hlen), channels)
    }
    // CDE/GRP and others ignored for the channel table.
    pos += 12 + hlen + 8
  }
}

/** Validate an H-message footer checksum (payload byte sum, low 16 bits). */
function checksumOk(
  bytes: Uint8Array,
  payloadOff: number,
  hlen: number,
  footerOff: number,
): boolean {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ftrTok = dv.getUint32(footerOff + 1, true)
  const ftrSum = dv.getUint16(footerOff + 5, true)
  // Quick token check against header token (header tok is 4 bytes before).
  let sum = 0
  for (let i = 0; i < hlen; i++) sum = (sum + bytes[payloadOff + i]) & 0xffff
  return sum === ftrSum && ftrTok === dv.getUint32(payloadOff - 10, true)
}

/** Linear single-pass scan over the whole message stream. */
function scan(bytes: Uint8Array): ScanResult {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const total = bytes.byteLength
  const channels = new Map<number, ChannelDef>()
  const samples = new Map<number, RawSample[]>()
  const gps: GpsRecord[] = []
  const laps: LapRecord[] = []
  const meta: Record<string, string> = {}
  const track: ScanResult['track'] = {}
  // The order the metadata tokens were seen matters: TMD/TMT take the FIRST,
  // others take the LAST. We record both and resolve at the end.
  const metaFirst = new Set(['TMD', 'TMT'])

  const pushSample = (index: number, tc: number, off: number): void => {
    let arr = samples.get(index)
    if (!arr) {
      arr = []
      samples.set(index, arr)
    }
    // De-dup / replay tolerance: only accept strictly increasing timecodes.
    const last = arr.length > 0 ? arr[arr.length - 1].tc : -Infinity
    if (tc > last) arr.push({ tc, off })
  }

  let pos = 0
  while (pos + 2 <= total) {
    const op = dv.getUint16(pos, true)

    if (op === OP_H) {
      if (pos + 12 > total) break
      const hlen = dv.getInt32(pos + 6, true)
      const cl = dv.getUint8(pos + 11)
      const payloadOff = pos + 12
      const footerOff = payloadOff + hlen
      if (cl !== CL || hlen < 0 || footerOff + 8 > total) {
        pos++
        continue
      }
      if (!checksumOk(bytes, payloadOff, hlen, footerOff)) {
        pos++
        continue
      }
      const token = decodeToken(dv.getUint32(pos + 2, true))
      if (token === 'CNF') {
        parseCnf(new Uint8Array(bytes.buffer, bytes.byteOffset + payloadOff, hlen), channels)
      } else if (token === 'GPS' && hlen >= 44) {
        gps.push({
          tc: dv.getInt32(payloadOff + 0, true),
          x: dv.getInt32(payloadOff + 16, true),
          y: dv.getInt32(payloadOff + 20, true),
          z: dv.getInt32(payloadOff + 24, true),
          vx: dv.getInt32(payloadOff + 32, true),
          vy: dv.getInt32(payloadOff + 36, true),
          vz: dv.getInt32(payloadOff + 40, true),
        })
      } else if (token === 'LAP' && hlen >= 20) {
        laps.push({
          lap: dv.getUint16(payloadOff + 2, true),
          durationMs: dv.getUint32(payloadOff + 4, true),
          endTimeMs: dv.getUint32(payloadOff + 16, true),
        })
      } else if (token === 'TRK' && hlen >= 44) {
        track.name = readCString(dv, payloadOff, 32)
        track.sfLat = dv.getInt32(payloadOff + 36, true) / 1e7
        track.sfLon = dv.getInt32(payloadOff + 40, true) / 1e7
      } else if (token.length > 0 && hlen > 0) {
        // Generic ASCII metadata.
        const text = readCString(dv, payloadOff, hlen)
        if (text.length > 0) {
          if (metaFirst.has(token)) {
            if (!(token in meta)) meta[token] = text
          } else {
            meta[token] = text
          }
        }
      }
      pos = footerOff + 8
      continue
    }

    if (op === OP_S || op === OP_C) {
      // S: op u16, tc i32@2, index u16@6, data@8, ')'@8+size
      // c: op u16, channel u16@3 (>>3), tc i32@7, data@11, ')'@11+size
      let index: number
      let tc: number
      let dataOff: number
      if (op === OP_S) {
        if (pos + 8 > total) {
          pos++
          continue
        }
        tc = dv.getInt32(pos + 2, true)
        index = dv.getUint16(pos + 6, true)
        dataOff = pos + 8
      } else {
        if (pos + 11 > total) {
          pos++
          continue
        }
        index = dv.getUint16(pos + 3, true) >> 3
        tc = dv.getInt32(pos + 7, true)
        dataOff = pos + 11
      }
      const def = channels.get(index)
      if (!def || def.size <= 0) {
        pos++
        continue
      }
      const termOff = dataOff + def.size
      if (termOff + 1 > total || dv.getUint8(termOff) !== TERMINATOR) {
        pos++
        continue
      }
      pushSample(index, tc, dataOff)
      pos = termOff + 1
      continue
    }

    if (op === OP_M) {
      // op u16, tc i32@2, index u16@6, count u16@8, data@10, ')'@10+count*size
      if (pos + 10 > total) {
        pos++
        continue
      }
      const tc = dv.getInt32(pos + 2, true)
      const index = dv.getUint16(pos + 6, true)
      const count = dv.getUint16(pos + 8, true)
      const def = channels.get(index)
      if (!def || def.size <= 0 || count <= 0) {
        pos++
        continue
      }
      const dataOff = pos + 10
      const termOff = dataOff + count * def.size
      if (termOff + 1 > total || dv.getUint8(termOff) !== TERMINATOR) {
        pos++
        continue
      }
      const mms = mmsLookup(def.rateCode) ?? 1
      for (let i = 0; i < count; i++) {
        pushSample(index, tc + i * mms, dataOff + i * def.size)
      }
      pos = termOff + 1
      continue
    }

    if (op === OP_G) {
      // Group messages are unused in our samples; skip conservatively by 1 byte
      // (no group table available to compute the length).
      pos++
      continue
    }

    // Unknown opcode — bad byte, back up one.
    pos++
  }
  return { channels, samples, gps, laps, meta, track }
}

/** Decode one raw sample's bytes into a numeric value, per the decoder type. */
function decodeSample(dv: DataView, off: number, def: ChannelDef): number {
  switch (def.decoder) {
    case 0:
    case 3:
      return dv.getInt32(off, true) // master clock
    case 4:
    case 11:
      return dv.getInt16(off, true)
    case 12:
    case 24:
      return dv.getInt32(off, true)
    case 13:
      return dv.getUint8(off)
    case 15:
      return gearValue(def.size >= 4 ? dv.getUint32(off, true) : dv.getUint16(off, true))
    case 6:
      return dv.getFloat32(off, true)
    case 1:
    case 20:
      return float16ToFloat32(dv.getUint16(off, true))
    default:
      // Best-effort: treat 2-byte as float16, 4-byte as int32.
      if (def.size === 2) return float16ToFloat32(dv.getUint16(off, true))
      if (def.size >= 4) return dv.getInt32(off, true)
      return dv.getUint8(off)
  }
}

/** True if the channel carries useful per-sample telemetry (not a clock/odo). */
function isTelemetry(def: ChannelDef): boolean {
  // Drop the master clock and odometer-style time channels from output.
  if (def.shortName === 'MCLK' || def.longName === 'Master Clk') return false
  if (def.shortName === 'StrtRec') return false
  if (def.unitCode === 26) return false // odometer / time? special path
  return true
}

/**
 * Forward-fill / nearest-sample a channel's (tc, value) series onto the master
 * time axis. Two-pointer, O(n). For each axis time we take the latest sample at
 * or before it (step hold); before the first sample we emit NaN.
 */
function resampleOnto(
  axis: Int32Array,
  tcs: number[],
  vals: number[],
  out: Float32Array,
): void {
  let j = -1
  const n = tcs.length
  for (let i = 0; i < axis.length; i++) {
    const t = axis[i]
    while (j + 1 < n && tcs[j + 1] <= t) j++
    out[i] = j >= 0 ? vals[j] : NaN
  }
}

/** Parse a `.xrk` byte buffer into a LogSession with formatId 'xrk'. */
export function parseXrk(bytes: Uint8Array): LogSession {
  const scanned = scan(bytes)
  const { channels, samples, meta, track } = scanned
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (channels.size === 0) {
    throw new Error('XRK: no channel definitions (CNF/CHS) found — not a valid .xrk')
  }

  // --- time origin: min timecode across all sources (samples + GPS + laps) ---
  let timeOffset = Infinity
  for (const arr of samples.values()) {
    if (arr.length > 0) timeOffset = Math.min(timeOffset, arr[0].tc)
  }
  for (const g of scanned.gps) timeOffset = Math.min(timeOffset, g.tc)
  // Prefer a lap-derived origin when available (start of lap 1).
  if (scanned.laps.length > 0) {
    const l0 = scanned.laps[0]
    const lapStart = l0.endTimeMs - l0.durationMs
    if (Number.isFinite(lapStart)) timeOffset = Math.min(timeOffset, lapStart)
  }
  if (!Number.isFinite(timeOffset)) timeOffset = 0

  // --- master time axis: union of all sample timecodes (deduped, sorted) ---
  // This preserves every channel's true rate without inflating O(n²).
  const axisSet = new Set<number>()
  for (const arr of samples.values()) {
    for (const s of arr) axisSet.add(s.tc - timeOffset)
  }
  let axisArr = Array.from(axisSet)
  axisArr.sort((a, b) => a - b)
  // Keep only non-negative times (drop pre-session noise).
  axisArr = axisArr.filter((t) => t >= 0)
  if (axisArr.length === 0) axisArr = [0]
  const axis = Int32Array.from(axisArr)
  const rowCount = axis.length

  const out: Channel[] = []
  const used = new Set<string>()
  const uniqueName = (base: string): string => {
    let name = base.length > 0 ? base : 'ch'
    if (!used.has(name)) {
      used.add(name)
      return name
    }
    let i = 2
    while (used.has(`${name}_${i}`)) i++
    name = `${name}_${i}`
    used.add(name)
    return name
  }

  // --- Time channel (ms, from 0) ---
  const time = new Float32Array(rowCount)
  for (let i = 0; i < rowCount; i++) time[i] = axis[i]
  out.push({ name: uniqueName('Time'), rawName: 'Time', description: undefined, data: time })

  // --- telemetry channels ---
  // Sort by channel index for stable output order.
  const indices = Array.from(channels.keys()).sort((a, b) => a - b)
  for (const idx of indices) {
    const def = channels.get(idx)!
    if (!isTelemetry(def)) continue
    const arr = samples.get(idx)
    if (!arr || arr.length === 0) continue

    const tcs = new Array<number>(arr.length)
    const vals = new Array<number>(arr.length)
    for (let i = 0; i < arr.length; i++) {
      tcs[i] = arr[i].tc - timeOffset
      vals[i] = decodeSample(dv, arr[i].off, def)
    }
    const data = new Float32Array(rowCount)
    resampleOnto(axis, tcs, vals, data)

    const unit = UNIT_MAP[def.unitCode]
    const base = def.shortName || def.longName || `ch${idx}`
    const name = uniqueName(base)
    const description =
      [def.longName, unit && unit !== 'time?' ? unit : ''].filter(Boolean).join(' ') || undefined
    out.push({ name, rawName: def.shortName || base, description, data })
  }

  // --- GPS channels (resampled onto the master axis) ---
  if (scanned.gps.length > 0) {
    emitGps(scanned.gps, timeOffset, axis, rowCount, out, uniqueName)
  }

  // --- meta ---
  const createdDate = buildCreatedDate(meta)
  const headerInfo: Record<string, string> = {}
  if (meta.RCR) headerInfo.driver = meta.RCR
  if (meta.VEH) headerInfo.vehicle = meta.VEH
  if (meta.CMP) headerInfo.championship = meta.CMP
  if (meta.NTE) headerInfo.notes = meta.NTE
  if (track.name) headerInfo.trackName = track.name
  if (track.sfLat !== undefined) headerInfo.sfLat = String(track.sfLat)
  if (track.sfLon !== undefined) headerInfo.sfLon = String(track.sfLon)
  if (scanned.laps.length > 0) {
    headerInfo.lapCount = String(scanned.laps.length)
    headerInfo.lapTimes = scanned.laps.map((l) => l.durationMs).join(',')
  }

  const logMeta: LogMeta = { formatId: 'xrk', createdDate, headerInfo }
  return new LogSession(out, logMeta)
}

/** Convert GPS ECEF records to lat/lon/alt/speed channels on the master axis. */
function emitGps(
  gps: GpsRecord[],
  timeOffset: number,
  axis: Int32Array,
  rowCount: number,
  out: Channel[],
  uniqueName: (base: string) => string,
): void {
  // De-dup & sort GPS by timecode (replay tolerance).
  const sorted = [...gps].sort((a, b) => a.tc - b.tc)
  const tcs: number[] = []
  const lat: number[] = []
  const lon: number[] = []
  const alt: number[] = []
  const speed: number[] = []
  const course: number[] = []
  let lastTc = -Infinity
  for (const g of sorted) {
    if (g.tc <= lastTc) continue
    lastTc = g.tc
    const lla = ecefToLla(g.x / 100, g.y / 100, g.z / 100)
    tcs.push(g.tc - timeOffset)
    lat.push(lla.lat)
    lon.push(lla.lon)
    alt.push(lla.alt)
    // speed: cm/s magnitude → km/h (×0.036)
    speed.push(Math.sqrt(g.vx * g.vx + g.vy * g.vy + g.vz * g.vz) * 0.036)
    // course from horizontal velocity (degrees, 0..360, 0 = North).
    const c = (Math.atan2(g.vx, g.vy) * 180) / Math.PI
    course.push(c < 0 ? c + 360 : c)
  }
  const push = (name: string, vals: number[]): void => {
    const data = new Float32Array(rowCount)
    resampleOnto(axis, tcs, vals, data)
    out.push({ name: uniqueName(name), rawName: name, description: undefined, data })
  }
  push('GPS_Lat', lat)
  push('GPS_Lon', lon)
  push('GPS_Altitude', alt)
  push('GPS_Speed', speed)
  push('GPS_Course', course)
}

/** Build a Date from TMD (dd/mm/yyyy) + TMT (HH:MM:SS) metadata. */
function buildCreatedDate(meta: Record<string, string>): Date | null {
  const d = meta.TMD
  if (!d) return null
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  let hh = 0
  let mm = 0
  let ss = 0
  const t = meta.TMT
  if (t) {
    const tm = t.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/)
    if (tm) {
      hh = Number(tm[1])
      mm = Number(tm[2])
      ss = Number(tm[3])
    }
  }
  const date = new Date(year, month - 1, day, hh, mm, ss)
  return Number.isNaN(date.getTime()) ? null : date
}
