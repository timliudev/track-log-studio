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

// ---------------------------------------------------------------------------
// B106 (A)-(G): sessionfragment.json-driven device roles + validated scales.
// ---------------------------------------------------------------------------

const INT32_MAX = 2147483647
const ACC_SCALE = 1 / 9806.65 // mm/s² → G

/**
 * Build a synthetic single-session `.rcz` where device roles are
 * DELIBERATELY inverted from the old hardcoded assumption (dev 100 = GPS,
 * dev 101 = ECU): GPS lives at id 300, the accelerometer at id 100. Six
 * devices, 8 identical-timestamp rows each (identity joins throughout, so
 * expected values are simple arithmetic) — GPS (300, type 1), accelerometer
 * (100, type 2), gyroscope (101, type 3), magnetometer (102, type 8), an RC3
 * data device (200, type 4, int32-encoded analog/digital bank), and an
 * OBD-style data device (400, type 4, float64-encoded — already physical,
 * must NOT be scaled). Also carries `session.json`'s official `laps[]`
 * table (RCZ-FORMAT-SPEC.md §3.1/§8 item D).
 */
function buildRoleDrivenRcz(): Uint8Array {
  const base = 1_800_000_000_000
  const rows = 8
  const ts = Array.from({ length: rows }, (_, i) => base + i * 100)

  const session = {
    timeCreated: base,
    trackName: 'Role-Driven Track',
    bestLaptime: 61_234,
    lapCount: 2,
    trackId: 777,
    lengthDistance: 3_500_000, // mm → 3.5 km (session-level summary)
    // title deliberately omitted — real single-session exports don't have one.
    laps: [
      { number: 1, startTimestamp: ts[1], finishTimestamp: ts[3], isInvalid: false },
      { number: 2, startTimestamp: ts[4], finishTimestamp: ts[6], isInvalid: false },
    ],
  }

  const fragment = {
    devices: {
      items: [
        { id: 300, model: 101, type: 1 }, // GPS — NOT id 100
        { id: 100, model: 400, type: 2 }, // accelerometer — NOT GPS, despite id 100
        { id: 101, model: 400, type: 3 }, // gyroscope
        { id: 102, model: 400, type: 8 }, // magnetometer
        { id: 200, model: 404, type: 4 }, // RC3 data device (int32)
        { id: 400, model: 502, type: 4 }, // OBD-style data device (float64)
      ],
    },
  }

  const latRaw = Math.round(23.5 * 6_000_000)
  const lonRaw = Math.round(121.2 * 6_000_000)
  const latLonPairs = Array.from({ length: rows }, () => [latRaw, lonRaw]).flat()
  const speedMmS = Array.from({ length: rows }, (_, i) => i * 1000) // 0..7000 mm/s
  const altitudeMm = Array.from({ length: rows }, () => 311_300) // constant 311.3 m after fix
  const bearingMilliDeg = [0, 45_000, 90_000, 135_000, 180_000, 225_000, 270_000, INT32_MAX]
  const distanceMm = Array.from({ length: rows }, (_, i) => i * 500_000) // 0..3.5e6 mm
  const satellites = [4, 5, 6, 7, 8, 9, 10, INT32_MAX]

  const xAccRaw = [9807, 19613, 29420, 39227, 49033, 58840, 68646, INT32_MAX]
  const yAccRaw = [-9807, -19613, -29420, -39227, -49033, -58840, -68646, INT32_MAX]
  const zAccRaw = [0, 9807, 19613, 29420, 39227, 49033, 58840, INT32_MAX]

  const xGyroRaw = [0, 1000, 2000, 3000, 4000, 5000, 6000, INT32_MAX]
  const yGyroRaw = [0, -1000, -2000, -3000, -4000, -5000, -6000, INT32_MAX]
  const zGyroRaw = Array.from({ length: rows }, (_, i) => i * 500)

  const xMagnRaw = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]
  const yMagnRaw = xMagnRaw.map((v) => -v)
  const zMagnRawAllSentinel = Array.from({ length: rows }, () => INT32_MAX) // whole channel unusable

  const digital1Raw = [2_042_000, 5_020_000, 7_098_000, 9_000_000, 11_000_000, 11_500_000, 11_800_000, 11_900_000]
  const analog1Raw = Array.from({ length: rows }, (_, i) => (i + 1) * 1000)
  const digital2Raw = Array.from({ length: rows }, (_, i) => (i + 1) * 500)
  const analog6Raw = Array.from({ length: rows }, (_, i) => (i + 1) * 100)
  const analog15RawAllSentinel = Array.from({ length: rows }, () => INT32_MAX) // unwired channel

  const obdRpm = [4200.5, 4300.2, 4400.9, 4500.1, 4600.7, 4700.3, 4800.6, 4900.4] // already physical (rpm)

  return zipSync({
    'session.json': new TextEncoder().encode(JSON.stringify(session)),
    'sessionfragment.json': new TextEncoder().encode(JSON.stringify(fragment)),

    // GPS (dev 300)
    'channel_1_300_0_1_1': int64LE(ts),
    'channel_1_300_0_3_1': int32LE(latLonPairs),
    'channel_1_300_0_4_0': int32LE(speedMmS),
    'channel_1_300_0_5_0': int32LE(altitudeMm),
    'channel_1_300_0_6_0': int32LE(bearingMilliDeg),
    'channel_1_300_0_2_1': int64LE(distanceMm),
    'channel_1_300_0_30002_0': int32LE(satellites),

    // Accelerometer (dev 100) — int32, mm/s²
    'channel_1_100_0_1_1': int64LE(ts),
    'channel_1_100_0_9_0': int32LE(xAccRaw),
    'channel_1_100_0_10_0': int32LE(yAccRaw),
    'channel_1_100_0_11_0': int32LE(zAccRaw),

    // Gyroscope (dev 101) — int32, millideg/s
    'channel_1_101_0_1_1': int64LE(ts),
    'channel_1_101_0_12_0': int32LE(xGyroRaw),
    'channel_1_101_0_13_0': int32LE(yGyroRaw),
    'channel_1_101_0_14_0': int32LE(zGyroRaw),

    // Magnetometer (dev 102) — int32, nT
    'channel_1_102_0_1_1': int64LE(ts),
    'channel_1_102_0_28_0': int32LE(xMagnRaw),
    'channel_1_102_0_29_0': int32LE(yMagnRaw),
    'channel_1_102_0_30_0': int32LE(zMagnRawAllSentinel),

    // RC3 data device (dev 200) — int32, 20000-space analog/digital bank
    'channel_1_200_0_1_1': int64LE(ts),
    'channel_1_200_0_20002_0': int32LE(digital1Raw),
    'channel_1_200_0_20003_0': int32LE(analog1Raw),
    'channel_1_200_0_20010_0': int32LE(digital2Raw),
    'channel_1_200_0_20011_0': int32LE(analog6Raw),
    'channel_1_200_0_20020_0': int32LE(analog15RawAllSentinel),

    // OBD-style data device (dev 400) — float64, already physical
    'channel_1_400_0_1_1': int64LE(ts),
    'channel2_1_400_0_10024_3': float64LE(obdRpm),
  })
}

describe('parseRcz — device roles from sessionfragment.json, not hardcoded ids (B106 A)', () => {
  it('resolves GPS at id 300 and the accelerometer at id 100 — the inverse of the old hardcoded assumption', () => {
    const session = parseRcz(buildRoleDrivenRcz())

    const lat = session.get('GPS_Lat')!
    const lon = session.get('GPS_Lon')!
    expect(lat).toBeDefined()
    expect(lat.data[0]).toBeCloseTo(23.5, 4)
    expect(lon.data[0]).toBeCloseTo(121.2, 4)

    // dev 100 (old code would have called this "GPS") is really the accelerometer.
    const xAcc = session.get('rc_x_acc')!
    expect(xAcc).toBeDefined()
    expect(xAcc.unit).toBe('G')
  })

  it('picks the master clock by device order on a tie (GPS, first in the device list, ties with everyone at 8 samples)', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    expect(session.meta.headerInfo.masterDeviceId).toBe('300')
    expect(session.rowCount).toBe(8)
  })
})

describe('parseRcz — validated int32 scales (B106 E)', () => {
  it('scales accelerometer x/y/z to G (raw mm/s² ÷ 9806.65)', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const xAcc = session.get('rc_x_acc')!
    const yAcc = session.get('rc_y_acc')!
    const zAcc = session.get('rc_z_acc')!
    expect(xAcc.unit).toBe('G')
    expect(yAcc.unit).toBe('G')
    expect(zAcc.unit).toBe('G')
    const rawX = [9807, 19613, 29420, 39227, 49033, 58840, 68646]
    for (let i = 0; i < rawX.length; i++) {
      expect(xAcc.data[i]).toBeCloseTo(rawX[i] * ACC_SCALE, 3)
    }
  })

  it('scales gyroscope x/y/z to deg/s (raw millideg/s ÷ 1000)', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const xGyro = session.get('rc_x_rate_of_rotation')!
    expect(xGyro.unit).toBe('deg/s')
    expect(Array.from(xGyro.data).slice(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('scales magnetometer x/y/z to µT (raw nT ÷ 1000)', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const xMagn = session.get('rc_x_magn')!
    expect(xMagn.unit).toBe('µT')
    expect(Array.from(xMagn.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('does NOT scale float64 channels — they are already the physical value', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const rpm = session.get('rc_rpm')!
    expect(rpm.unit).toBeUndefined()
    const expected = [4200.5, 4300.2, 4400.9, 4500.1, 4600.7, 4700.3, 4800.6, 4900.4]
    Array.from(rpm.data).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 3))
  })
})

describe('parseRcz — GPS altitude mm → m and INT32_MAX sentinel → NaN (B106 B, C)', () => {
  it('converts GPS altitude from raw millimetres to metres', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const alt = session.get('GPS_Altitude')!
    expect(alt.unit).toBe('m')
    // 311300 mm raw would previously have been emitted as "311300 m".
    expect(alt.data[0]).toBeCloseTo(311.3, 3)
  })

  it('maps INT32_MAX to NaN for GPS bearing, satellites, accelerometer, gyroscope', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    expect(session.get('GPS_Course')!.data[7]).toBeNaN()
    expect(session.get('Satellites')!.data[7]).toBeNaN()
    expect(session.get('rc_x_acc')!.data[7]).toBeNaN()
    expect(session.get('rc_x_rate_of_rotation')!.data[7]).toBeNaN()
  })

  it('maps an entirely-sentinel int32 channel to an all-NaN channel (magnetometer z, RC3 analog15)', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const zMagn = session.get('rc_z_magn')!
    expect(Array.from(zMagn.data).every((v) => Number.isNaN(v))).toBe(true)
    const analog15 = session.get('rc_analog_15')!
    expect(Array.from(analog15.data).every((v) => Number.isNaN(v))).toBe(true)
  })
})

describe('parseRcz — distance channel, mm → km (B106)', () => {
  it('decodes the id-2 cumulative-distance channel in km', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const distance = session.get('distance')!
    expect(distance.unit).toBe('km')
    const expectedKm = Array.from({ length: 8 }, (_, i) => (i * 500_000) / 1_000_000)
    Array.from(distance.data).forEach((v, i) => expect(v).toBeCloseTo(expectedKm[i], 6))
  })
})

describe('parseRcz — RC3 20000-space analog/digital naming (B106 F)', () => {
  it('names 20002/20010 as rc_digital_1/2 and 20003/20011 as rc_analog_1/6, all ÷1000', () => {
    const session = parseRcz(buildRoleDrivenRcz())

    const digital1 = session.get('rc_digital_1')!
    expect(digital1).toBeDefined()
    expect(Array.from(digital1.data)).toEqual([2042, 5020, 7098, 9000, 11000, 11500, 11800, 11900])

    const analog1 = session.get('rc_analog_1')!
    expect(analog1).toBeDefined()
    expect(Array.from(analog1.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])

    const digital2 = session.get('rc_digital_2')!
    expect(digital2).toBeDefined()
    expect(Array.from(digital2.data)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])

    const analog6 = session.get('rc_analog_6')!
    expect(analog6).toBeDefined()
    const expectedAnalog6 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
    Array.from(analog6.data).forEach((v, i) => expect(v).toBeCloseTo(expectedAnalog6[i], 5))
  })
})

describe('parseRcz — headerInfo aligned with the backup path (B106 G)', () => {
  it('carries lapCount/trackId/distanceKm/deviceCount/masterDeviceId/masterSampleRateHz + per-device diagnostics', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const h = session.meta.headerInfo
    expect(h.trackName).toBe('Role-Driven Track')
    expect(h.title).toBeUndefined() // tolerates a session.json with no `title` field
    expect(h.bestLaptime).toBe('61234')
    expect(h.lapCount).toBe('2')
    expect(h.trackId).toBe('777')
    expect(h.distanceKm).toBe('3.5')
    expect(h.deviceCount).toBe('6')
    expect(h.masterDeviceId).toBe('300')
    expect(Number(h.masterSampleRateHz)).toBeCloseTo(10, 1)
    expect(h.device_300_type).toBe('1')
    expect(h.device_100_type).toBe('2')
    expect(h.device_200_type).toBe('4')
  })
})

describe('parseRcz — session.json laps[] → IR_LapNumber channel (B106 D)', () => {
  it('builds a rising lap-counter channel from the official laps table, picked up by the existing lap detector', () => {
    const session = parseRcz(buildRoleDrivenRcz())
    const lapCh = session.get('IR_LapNumber')
    expect(lapCh).toBeDefined()
    // row0 = pre-lap (0); lap1 fills rows 1-3; lap2 fills rows 4-6; row7 = trailing out-lap (3).
    expect(Array.from(lapCh!.data)).toEqual([0, 1, 1, 1, 2, 2, 2, 3])
  })
})
