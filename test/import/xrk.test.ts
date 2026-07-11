import { describe, it, expect } from 'vitest'
import { zlibSync } from 'fflate'
import { parseXrk, float16ToFloat32, parseChsRecord } from '@/domain/import/xrk/parseXrk'
import { ecefToLla } from '@/domain/import/xrk/ecef'
import { isZlibMagic, inflateXrz } from '@/domain/import/xrk/inflateXrz'
import { xrkImporter } from '@/domain/import/xrk/XrkImporter'

// --- pure helper: float16 → float32 ---
describe('float16ToFloat32', () => {
  it('decodes representative half-precision values', () => {
    expect(float16ToFloat32(0x0000)).toBe(0)
    expect(float16ToFloat32(0x3c00)).toBeCloseTo(1, 6) // 1.0
    expect(float16ToFloat32(0xc000)).toBeCloseTo(-2, 6) // -2.0
    expect(float16ToFloat32(0x3555)).toBeCloseTo(0.333251953125, 6) // ~1/3
    expect(float16ToFloat32(0x7c00)).toBe(Infinity)
    expect(Number.isNaN(float16ToFloat32(0x7e00))).toBe(true)
  })
})

// --- pure helper: ECEF → WGS84 geodetic (round-trip the A.R.K. circuit) ---
describe('ecefToLla', () => {
  /** Forward WGS84 geodetic → ECEF (metres), for building a known test point. */
  function llaToEcef(latDeg: number, lonDeg: number, alt: number): [number, number, number] {
    const a = 6378137.0
    const f = 1 / 298.257223563
    const e2 = f * (2 - f)
    const lat = (latDeg * Math.PI) / 180
    const lon = (lonDeg * Math.PI) / 180
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2)
    const x = (n + alt) * Math.cos(lat) * Math.cos(lon)
    const y = (n + alt) * Math.cos(lat) * Math.sin(lon)
    const z = (n * (1 - e2) + alt) * Math.sin(lat)
    return [x, y, z]
  }

  it('round-trips the A.R.K. circuit point (23.104 N, 120.222 E)', () => {
    const [x, y, z] = llaToEcef(23.104, 120.222, 23.4)
    const lla = ecefToLla(x, y, z)
    expect(lla.lat).toBeCloseTo(23.104, 5)
    expect(lla.lon).toBeCloseTo(120.222, 5)
    expect(lla.lon).toBeGreaterThan(0) // positive E
    expect(lla.alt).toBeCloseTo(23.4, 2)
  })

  it('handles the southern/western hemisphere', () => {
    const [x, y, z] = llaToEcef(-33.45, -70.66, 520)
    const lla = ecefToLla(x, y, z)
    expect(lla.lat).toBeCloseTo(-33.45, 5)
    expect(lla.lon).toBeCloseTo(-70.66, 5)
  })
})

// --- pure helper: CHS record parse on a hand-built 112-byte buffer ---
describe('parseChsRecord', () => {
  it('decodes index/short/long/size/unit/decoder/rate from a 112-byte CHS', () => {
    const buf = new Uint8Array(112)
    const dv = new DataView(buf.buffer)
    dv.setUint16(0, 23, true) // index
    buf[12] = 15 // unit code → rpm
    buf[20] = 4 // decoder → int16
    buf[64] = 80 // rate code → 20 Hz
    dv.setUint8(72, 2) // size = 2 bytes
    const enc = new TextEncoder()
    buf.set(enc.encode('RPM'), 24) // short_name
    buf.set(enc.encode('RPM'), 32) // long_name
    const rec = parseChsRecord(buf)
    expect(rec.index).toBe(23)
    expect(rec.shortName).toBe('RPM')
    expect(rec.longName).toBe('RPM')
    expect(rec.size).toBe(2)
    expect(rec.unitCode).toBe(15)
    expect(rec.decoder).toBe(4)
    expect(rec.rateCode).toBe(80)
  })
})

// --- end-to-end framing: a hand-built minimal .xrk byte stream ---

/** Encode a 4-char token to its little-endian u32. */
function tok(s: string): number {
  let v = 0
  for (let i = s.length - 1; i >= 0; i--) v = v * 256 + s.charCodeAt(i)
  return v >>> 0
}

/** Build an H-message: 12B header + payload + 8B footer (with checksum). */
function hMessage(token: string, payload: Uint8Array, ver = 1): Uint8Array {
  const out = new Uint8Array(12 + payload.length + 8)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, 0x683c, true) // '<h'
  dv.setUint32(2, tok(token), true)
  dv.setInt32(6, payload.length, true)
  dv.setUint8(10, ver)
  dv.setUint8(11, 0x3e) // '>'
  out.set(payload, 12)
  let sum = 0
  for (let i = 0; i < payload.length; i++) sum = (sum + payload[i]) & 0xffff
  const f = 12 + payload.length
  dv.setUint8(f, 0x3c) // '<'
  dv.setUint32(f + 1, tok(token), true)
  dv.setUint16(f + 5, sum, true)
  dv.setUint8(f + 7, 0x3e) // '>'
  return out
}

/** Build a single CHS channel-definition payload (112 bytes). */
function chs(opts: {
  index: number
  short: string
  long: string
  size: number
  unit: number
  decoder: number
  rate: number
}): Uint8Array {
  const buf = new Uint8Array(112)
  const dv = new DataView(buf.buffer)
  dv.setUint16(0, opts.index, true)
  buf[12] = opts.unit
  buf[20] = opts.decoder
  buf[64] = opts.rate
  dv.setUint8(72, opts.size)
  const enc = new TextEncoder()
  buf.set(enc.encode(opts.short), 24)
  buf.set(enc.encode(opts.long), 32)
  return buf
}

/** Build an M-message (batch of int16 samples) for a channel. */
function mMessage(index: number, tc: number, size: number, samples: number[]): Uint8Array {
  const out = new Uint8Array(10 + samples.length * size + 1)
  const dv = new DataView(out.buffer)
  dv.setUint16(0, 0x4d28, true) // '(M'
  dv.setInt32(2, tc, true)
  dv.setUint16(6, index, true)
  dv.setUint16(8, samples.length, true)
  samples.forEach((v, i) => dv.setInt16(10 + i * size, v, true))
  dv.setUint8(10 + samples.length * size, 0x29) // ')'
  return out
}

/** Concatenate byte chunks. */
function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

describe('parseXrk — synthetic message stream', () => {
  function buildSyntheticXrk(): Uint8Array {
    // CNF payload contains two nested CHS records: MCLK (dropped) and RPM.
    const cnfPayload = concat(
      hMessage('CHS', chs({ index: 0, short: 'MCLK', long: 'Master Clk', size: 4, unit: 18, decoder: 0, rate: 32 })),
      hMessage('CHS', chs({ index: 23, short: 'RPM', long: 'RPM', size: 2, unit: 15, decoder: 4, rate: 80 })),
    )
    const cnf = hMessage('CNF', cnfPayload)
    // RPM samples: rate 80 → 50 ms/sample. Batch starts at tc=1000.
    const rpm = mMessage(23, 1000, 2, [2500, 2520, 2540, 2560, 2580])
    const tmd = hMessage('TMD', new TextEncoder().encode('04/06/2024\0'))
    const tmt = hMessage('TMT', new TextEncoder().encode('17:10:21\0'))
    const rcr = hMessage('RCR', new TextEncoder().encode('CHENG\0'))
    return concat(cnf, rpm, tmd, tmt, rcr)
  }

  it('parses the channel table, samples, and metadata', () => {
    const session = parseXrk(buildSyntheticXrk())
    expect(session.meta.formatId).toBe('xrk')

    // Time axis present, starts at 0.
    const time = session.timeChannel!
    expect(time).toBeDefined()
    expect(time.data[0]).toBe(0)

    // RPM channel decoded (int16), MCLK dropped.
    const rpm = session.get('RPM')!
    expect(rpm).toBeDefined()
    expect(session.get('MCLK')).toBeUndefined()
    // First sample value ~2500.
    expect(rpm.data[0]).toBeCloseTo(2500, 0)
    expect(rpm.data[rpm.data.length - 1]).toBeCloseTo(2580, 0)

    // Five samples → five rows on the axis.
    expect(session.rowCount).toBe(5)

    // Metadata.
    expect(session.meta.headerInfo.driver).toBe('CHENG')
    expect(session.meta.createdDate).not.toBeNull()
    expect(session.meta.createdDate!.getFullYear()).toBe(2024)
  })

  it('throws a clear error when no channel table is present', () => {
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
    expect(() => parseXrk(garbage)).toThrow(/no channel definitions/)
  })

  it('transparently inflates a zlib-wrapped .xrz stream (same result as raw .xrk)', () => {
    const raw = buildSyntheticXrk()
    const zrx = zlibSync(raw)
    expect(isZlibMagic(zrx)).toBe(true)
    expect(isZlibMagic(raw)).toBe(false) // '<h' magic (0x3c) is not a zlib CMF byte

    const session = parseXrk(zrx)
    expect(session.get('RPM')!.data[0]).toBeCloseTo(2500, 0)
    expect(session.meta.headerInfo.driver).toBe('CHENG')
  })
})

// --- zlib magic sniffing + inflate bomb guard ---
describe('isZlibMagic / inflateXrz', () => {
  it('recognises common zlib header byte pairs, rejects non-zlib data', () => {
    expect(isZlibMagic(new Uint8Array([0x78, 0x9c]))).toBe(true) // default compression
    expect(isZlibMagic(new Uint8Array([0x78, 0x01]))).toBe(true) // no/low compression
    expect(isZlibMagic(new Uint8Array([0x78, 0xda]))).toBe(true) // best compression
    expect(isZlibMagic(new Uint8Array([0x3c, 0x68]))).toBe(false) // '<h' xrk magic
    expect(isZlibMagic(new Uint8Array([0x50, 0x4b]))).toBe(false) // 'PK' zip magic
    expect(isZlibMagic(new Uint8Array([0x78]))).toBe(false) // too short
  })

  it('rejects a stream whose inflated size exceeds the safety cap', () => {
    const bomb = zlibSync(new Uint8Array(1024 * 1024).fill(0x41)) // highly compressible
    expect(() => inflateXrz(bomb, 1024)).toThrow(/decompression bomb/)
  })
})

// --- importer registration: extension + magic detection, .xrz included ---
describe('xrkImporter.detect', () => {
  const headBytes = (bytes: number[]): Uint8Array => Uint8Array.from(bytes)

  it('matches by .xrk / .xrz extension regardless of content', () => {
    expect(
      xrkImporter.detect({ fileName: 'run.xrk', headText: '', headBytes: headBytes([0, 0]) }),
    ).toBe(true)
    expect(
      xrkImporter.detect({ fileName: 'run.xrz', headText: '', headBytes: headBytes([0, 0]) }),
    ).toBe(true)
  })

  it('matches an unrecognised-extension file by zlib magic', () => {
    expect(
      xrkImporter.detect({
        fileName: 'run.bin',
        headText: '',
        headBytes: headBytes([0x78, 0x9c, 0, 0, 0]),
      }),
    ).toBe(true)
  })

  it('does not match unrelated content', () => {
    expect(
      xrkImporter.detect({
        fileName: 'run.bin',
        headText: '',
        headBytes: headBytes([0x50, 0x4b, 0x03, 0x04, 0]),
      }),
    ).toBe(false)
  })
})
