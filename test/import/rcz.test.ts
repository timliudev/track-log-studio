import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { parseRcz, decodeRcChannelName } from '@/domain/import/rcz/parseRcz'

/** Encode a number[] as a bare little-endian int64 blob. */
function int64LE(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 8)
  const dv = new DataView(buf.buffer)
  values.forEach((v, i) => dv.setBigInt64(i * 8, BigInt(v), true))
  return buf
}

/** Encode a number[] as a bare little-endian int32 blob. */
function int32LE(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4)
  const dv = new DataView(buf.buffer)
  values.forEach((v, i) => dv.setInt32(i * 4, v, true))
  return buf
}

/** Encode a number[] as a bare little-endian float64 blob. */
function float64LE(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 8)
  const dv = new DataView(buf.buffer)
  values.forEach((v, i) => dv.setFloat64(i * 8, v, true))
  return buf
}

/** Build a small synthetic .rcz with 5 ECU samples and 5 GPS samples. */
function buildSyntheticRcz(): Uint8Array {
  const base = 1_782_059_124_000
  const step = 31
  const ecuTs = [0, 1, 2, 3, 4].map((i) => base + i * step)
  const gpsTs = [0, 1, 2, 3, 4].map((i) => base + i * step)

  const rpm = [2042, 5020, 7098, 9000, 11000]

  // lat ≈ 23.1, lon ≈ 120.2 → int = deg * 6_000_000
  const lat = Math.round(23.1 * 6_000_000)
  const lon = Math.round(120.2 * 6_000_000)
  const latlonPairs: number[] = []
  for (let i = 0; i < 5; i++) latlonPairs.push(lat, lon)

  // speed in mm/s → e.g. 10000 mm/s = 36 km/h
  const speed = [0, 5000, 10000, 15000, 20000]

  const session = {
    timeCreated: base,
    trackName: 'Synthetic Track',
    title: 'unit-test.rcz',
    bestLaptime: 50589,
    laps: [{ number: 1, startTimestamp: base, finishTimestamp: base + 124, isInvalid: false }],
  }

  return zipSync({
    'session.json': new TextEncoder().encode(JSON.stringify(session)),
    'channel_4_101_0_1_1': int64LE(ecuTs), // ECU timestamps (master)
    'channel_4_101_0_2_1': int64LE([0, 1, 2, 3, 4]), // counter (ignored)
    'channel2_4_101_0_10024_3': float64LE(rpm), // rc_rpm
    'channel_1_100_0_1_1': int64LE(gpsTs), // GPS timestamps
    'channel_1_100_0_3_1': int32LE(latlonPairs), // lat/lon pairs
    'channel_1_100_0_4_0': int32LE(speed), // velocity mm/s
  })
}

describe('parseRcz — synthetic sample', () => {
  it('parses a minimal synthetic .rcz into an rcz LogSession', () => {
    const session = parseRcz(buildSyntheticRcz())

    expect(session.meta.formatId).toBe('rcz')
    // rowCount tracks the ECU sample count.
    expect(session.rowCount).toBe(5)

    // ECU telemetry named via the id rule.
    const rpm = session.get('rc_rpm')
    expect(rpm).toBeDefined()
    expect(Array.from(rpm!.data)).toEqual([2042, 5020, 7098, 9000, 11000])

    // GPS lat/lon: positive E longitude, ~Taiwan.
    const lat = session.get('GPS_Lat')!
    const lon = session.get('GPS_Lon')!
    expect(lat.data[0]).toBeCloseTo(23.1, 4)
    expect(lon.data[0]).toBeCloseTo(120.2, 4)
    expect(lon.data[0]).toBeGreaterThan(0)

    // GPS speed in km/h: 10000 mm/s → 36 km/h.
    const speed = session.get('GPS_Speed')!
    expect(speed.data[2]).toBeCloseTo(36, 3)

    // Time channel starts at 0 and advances ~31 ms.
    const time = session.timeChannel!
    expect(time.data[0]).toBe(0)
    expect(time.data[1]).toBeCloseTo(31, 5)
  })

  it('uses session.json metadata', () => {
    const session = parseRcz(buildSyntheticRcz())
    expect(session.meta.createdDate).not.toBeNull()
    expect(session.meta.createdDate!.getTime()).toBe(1_782_059_124_000)
    expect(session.meta.headerInfo.trackName).toBe('Synthetic Track')
    expect(session.meta.headerInfo.title).toBe('unit-test.rcz')
  })
})

describe('decodeRcChannelName — channel-id decode', () => {
  it('maps analog/digital bank codes', () => {
    expect(decodeRcChannelName(5000)).toBe('rc_analog_0')
    expect(decodeRcChannelName(5001)).toBe('rc_digital_0')
    // k = id / 1048576
    expect(decodeRcChannelName(5000 + 1_048_576)).toBe('rc_analog_1')
    expect(decodeRcChannelName(5001 + 2 * 1_048_576)).toBe('rc_digital_2')
  })

  it('maps NAMED_LO codes and suffixes higher banks', () => {
    expect(decodeRcChannelName(10024)).toBe('rc_rpm')
    expect(decodeRcChannelName(1023)).toBe('rc_air_fuel_ratio')
    // lo = 1023 with k = 2 → suffixed _<k+1>
    expect(decodeRcChannelName(1023 + 2 * 1_048_576)).toBe('rc_air_fuel_ratio_3')
  })

  it('falls back to rc_channel_<id> for unknown codes', () => {
    expect(decodeRcChannelName(99999)).toBe('rc_channel_99999')
  })
})
