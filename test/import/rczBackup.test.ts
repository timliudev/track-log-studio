import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import { isRczBackup, listRczSessions, matchSessionMetaEntry } from '@/domain/import/rcz/listRczSessions'
import { parseRczBackupSession } from '@/domain/import/rcz/parseRczBackup'

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

/** GPS int32 lat/lon degrees → the RCZ int32-pair encoding (deg × 6_000_000). */
function latLon(lat: number, lon: number): [number, number] {
  return [Math.round(lat * 6_000_000), Math.round(lon * 6_000_000)]
}

describe('matchSessionMetaEntry — the non-OOM inflate-filter predicate', () => {
  it('matches only sessions/<key>/session.json and sessionfragment.json', () => {
    expect(matchSessionMetaEntry('sessions/session_A/session.json')).toEqual({
      key: 'session_A',
      kind: 'session',
    })
    expect(matchSessionMetaEntry('sessions/session_A/sessionfragment.json')).toEqual({
      key: 'session_A',
      kind: 'sessionfragment',
    })
  })

  it('never matches a channel_* file — the multi-MB payloads must stay uninflated', () => {
    expect(matchSessionMetaEntry('sessions/session_A/channel_1_200_0_1_1')).toBeNull()
    expect(matchSessionMetaEntry('sessions/session_A/channel2_1_100_0_10024_3')).toBeNull()
  })

  it('never matches a ROOT session.json (that shape is a single-session export, not a backup)', () => {
    expect(matchSessionMetaEntry('session.json')).toBeNull()
  })

  it('never matches a nested-deeper path', () => {
    expect(matchSessionMetaEntry('sessions/session_A/sub/session.json')).toBeNull()
  })
})

/** Build a synthetic device-backup `.rcz` with 2 sessions: A (complete metadata,
 * a GPS device + an unrelated CAN device) and B (sparse metadata, bestLaptime
 * still at the Int64-max "unset" sentinel). Channel payloads are tiny — this
 * fixture only needs to prove the LISTING/SELECTION logic, not decode fidelity
 * at scale. */
function buildSyntheticBackup(): Uint8Array {
  const baseA = 1_782_000_000_000
  const gpsTsA = [0, 1, 2, 3].map((i) => baseA + i * 100)
  const [latA, lonA] = latLon(24.897, 121.267)
  const latLonPairsA = gpsTsA.flatMap(() => [latA, lonA])
  const speedA = [0, 25000, 27000, 27500] // mm/s

  const baseB = 1_782_100_000_000
  const gpsTsB = [0, 1, 2].map((i) => baseB + i * 100)
  const [latB, lonB] = latLon(25.03, 121.56)
  const latLonPairsB = gpsTsB.flatMap(() => [latB, lonB])
  const speedB = [10000, 12000, 13000]

  const sessionA = {
    timeCreated: baseA,
    firstTimestamp: baseA,
    latestTimestamp: baseA + 300,
    lengthTime: 60_500,
    lengthDistance: 3_500_000, // mm → 3.5 km
    lapCount: 2,
    bestLaptime: 52_314,
    trackId: 42,
  }
  const fragmentA = {
    primaryGpsDeviceIndex: 0,
    devices: {
      items: [
        { id: 200, model: '101', type: 1 }, // GPS
        { id: 100, model: 'ECU', type: 2 }, // CAN/ECU — not decoded in stage 1
      ],
    },
  }

  const sessionB = {
    timeCreated: baseB,
    lengthTime: 20_100,
    lengthDistance: 900_000,
    lapCount: 0,
    bestLaptime: 9_223_372_036_854_775_807, // Int64-max sentinel: no completed lap
  }
  const fragmentB = {
    devices: { items: [{ id: 200, model: '101', type: 1 }] },
  }

  return zipSync({
    'sessions/session_A/session.json': new TextEncoder().encode(JSON.stringify(sessionA)),
    'sessions/session_A/sessionfragment.json': new TextEncoder().encode(JSON.stringify(fragmentA)),
    'sessions/session_A/channel_1_200_0_1_1': int64LE(gpsTsA),
    'sessions/session_A/channel_1_200_0_3_0': int32LE(latLonPairsA),
    'sessions/session_A/channel_1_200_0_4_0': int32LE(speedA),

    'sessions/session_B/session.json': new TextEncoder().encode(JSON.stringify(sessionB)),
    'sessions/session_B/sessionfragment.json': new TextEncoder().encode(JSON.stringify(fragmentB)),
    'sessions/session_B/channel_1_200_0_1_1': int64LE(gpsTsB),
    'sessions/session_B/channel_1_200_0_3_0': int32LE(latLonPairsB),
    'sessions/session_B/channel_1_200_0_4_0': int32LE(speedB),
  })
}

/** A plain single-session `.rcz` export (root `session.json`, no `sessions/` prefix). */
function buildSingleSessionRcz(): Uint8Array {
  return zipSync({
    'session.json': new TextEncoder().encode(JSON.stringify({ timeCreated: 1_700_000_000_000 })),
    'channel_4_101_0_1_1': int64LE([0, 1, 2]),
  })
}

describe('isRczBackup', () => {
  it('is true for a device backup (nested sessions/<key>/session.json)', () => {
    expect(isRczBackup(buildSyntheticBackup())).toBe(true)
  })

  it('is false for a plain single-session export (root session.json)', () => {
    expect(isRczBackup(buildSingleSessionRcz())).toBe(false)
  })
})

describe('listRczSessions', () => {
  it('enumerates every session with metadata read only from session.json/sessionfragment.json', () => {
    const sessions = listRczSessions(buildSyntheticBackup())
    expect(sessions).toHaveLength(2)

    const a = sessions.find((s) => s.key === 'session_A')!
    expect(a).toBeDefined()
    expect(a.date).not.toBeNull()
    expect(a.date!.getTime()).toBe(1_782_000_000_000)
    expect(a.durationMs).toBe(60_500)
    expect(a.distanceKm).toBeCloseTo(3.5, 6)
    expect(a.lapCount).toBe(2)
    expect(a.bestLaptimeMs).toBe(52_314)
    expect(a.deviceCount).toBe(2)
    expect(a.gpsDeviceId).toBe(200)

    const b = sessions.find((s) => s.key === 'session_B')!
    expect(b).toBeDefined()
    expect(b.durationMs).toBe(20_100)
    expect(b.distanceKm).toBeCloseTo(0.9, 6)
    expect(b.lapCount).toBe(0)
    // Int64-max sentinel → treated as "no best lap yet", not a huge number.
    expect(b.bestLaptimeMs).toBeNull()
    expect(b.deviceCount).toBe(1)
    expect(b.gpsDeviceId).toBe(200)
  })

  it('returns an empty list for a plain single-session export', () => {
    expect(listRczSessions(buildSingleSessionRcz())).toEqual([])
  })
})

describe('parseRczBackupSession', () => {
  it('decodes only the chosen session\'s GPS channels (lat/lon/speed/time), auto-detecting the GPS device via type===1', () => {
    const bytes = buildSyntheticBackup()
    const session = parseRczBackupSession(bytes, 'session_A')

    expect(session.meta.formatId).toBe('rcz')
    expect(session.rowCount).toBe(4)

    const lat = session.get('GPS_Lat')!
    const lon = session.get('GPS_Lon')!
    expect(lat.data[0]).toBeCloseTo(24.897, 4)
    expect(lon.data[0]).toBeCloseTo(121.267, 4)
    expect(lon.data[0]).toBeGreaterThan(0)

    const speed = session.get('GPS_Speed')!
    expect(speed.data[1]).toBeCloseTo(25000 * 0.0036, 3) // mm/s → km/h

    const time = session.timeChannel!
    expect(time.data[0]).toBe(0)
    expect(time.data[1]).toBeCloseTo(100, 5)
  })

  it('scopes extraction to ONLY the chosen session — session B values never leak into session A', () => {
    const bytes = buildSyntheticBackup()
    const sessionA = parseRczBackupSession(bytes, 'session_A')
    const sessionB = parseRczBackupSession(bytes, 'session_B')

    expect(sessionA.rowCount).toBe(4)
    expect(sessionB.rowCount).toBe(3)
    expect(sessionA.get('GPS_Lat')!.data[0]).toBeCloseTo(24.897, 4)
    expect(sessionB.get('GPS_Lat')!.data[0]).toBeCloseTo(25.03, 4)
  })

  it('populates headerInfo from session.json, and reports the un-decoded CAN/ECU device (no ts stream in this fixture)', () => {
    const session = parseRczBackupSession(buildSyntheticBackup(), 'session_A')
    expect(session.meta.headerInfo.sessionKey).toBe('session_A')
    expect(session.meta.headerInfo.lapCount).toBe('2')
    expect(session.meta.headerInfo.bestLaptime).toBe('52314')
    expect(session.meta.headerInfo.trackId).toBe('42')
    expect(session.meta.headerInfo.deviceCount).toBe('2')
    // The CAN device (id 100, type 2) in this fixture has no timestamp stream
    // of its own, so it cannot be joined onto any master clock — it is
    // reported as undecoded rather than silently absent.
    expect(session.meta.headerInfo.undecodedDeviceCount).toBe('1')
    expect(session.meta.headerInfo.masterDeviceId).toBe('200') // only decodable device: GPS
    expect(session.meta.createdDate!.getTime()).toBe(1_782_000_000_000)
  })

  it('omits bestLaptime from headerInfo when it is still the Int64-max "unset" sentinel', () => {
    const session = parseRczBackupSession(buildSyntheticBackup(), 'session_B')
    expect(session.meta.headerInfo.bestLaptime).toBeUndefined()
    // Single-device session: no undecoded devices at all.
    expect(session.meta.headerInfo.undecodedDeviceCount).toBeUndefined()
  })

  it('throws a clear error for an unknown session key', () => {
    expect(() => parseRczBackupSession(buildSyntheticBackup(), 'session_missing')).toThrow(
      /no files found/,
    )
  })
})

// ---------------------------------------------------------------------------
// F3 stage 2: CAN/ECU decode, master-clock selection, distance channel.
// ---------------------------------------------------------------------------

/**
 * Build a synthetic device-backup `.rcz` with one multi-device session ("C":
 * GPS @ ~3 samples + 2 CAN devices with their OWN timestamp streams, one of
 * them — CAN1 — sampled far more densely, so it becomes the master clock) and
 * one unrelated sibling session ("D") carrying a uniquely-identifiable CAN
 * channel id that must never leak into session C's decode.
 */
function buildMultiDeviceBackup(): Uint8Array {
  const base = 1_800_000_000_000

  // GPS (id 200, type 1): 3 samples, ~50 ms apart — the SPARSEST device.
  const gpsTs = [0, 50, 100].map((d) => base + d)
  const [lat, lon] = latLon(24.9, 121.3)
  const latLonPairs = gpsTs.flatMap(() => [lat, lon])
  const distanceMm = [0, 2794, 5378] // cumulative, GPS-rate, mm (id 2, int64)

  // CAN1 (id 100, type 2): 6 samples, 20 ms apart — the DENSEST device, so it
  // must be chosen as the master clock even though GPS is device-list order 0.
  const can1Ts = [0, 20, 40, 60, 80, 100].map((d) => base + d)
  const accX = [-3219, -3000, -2800, -2600, -2400, -2200] // raw int32, unscaled
  const accY = [-245, -300, -350, -400, -450, -500]
  const accZ = [9800, 9750, 9700, 9650, 9600, 9550]

  // CAN2 (id 101, type 3): 5 samples, ~20-25 ms apart.
  const can2Ts = [0, 25, 45, 65, 90].map((d) => base + d)
  const gyroX = [19409, 15000, 10000, 5000, -35400] // raw int32, unscaled
  // Deliberate collision: CAN2 ALSO exposes id 9 (rc_x_acc), same as CAN1.
  const can2AccX = [111, 222, 333, 444, 555]
  const unknownIdValues = [7, 8, 9, 10, 11] // id 9999 has no NAMED_LO entry

  const sessionC = {
    timeCreated: base,
    firstTimestamp: base,
    lengthTime: 100,
    lengthDistance: 5_378,
    lapCount: 1,
  }
  const fragmentC = {
    devices: {
      items: [
        { id: 200, model: '101', type: 1 }, // GPS — device-list order 0, but NOT the densest
        { id: 100, model: 'CAN', type: 2 }, // densest: master clock
        { id: 101, model: 'CAN', type: 3 },
      ],
    },
  }

  // Sibling session D: unrelated CAN device carrying a uniquely-identifiable
  // channel id (12345) that must never surface when decoding session C.
  const dTs = [0, 10, 20].map((d) => base + 500_000 + d)
  const sessionD = { timeCreated: base + 500_000, lengthTime: 20, lapCount: 0 }
  const fragmentD = { devices: { items: [{ id: 300, model: 'CAN', type: 2 }] } }

  return zipSync({
    'sessions/session_C/session.json': new TextEncoder().encode(JSON.stringify(sessionC)),
    'sessions/session_C/sessionfragment.json': new TextEncoder().encode(JSON.stringify(fragmentC)),
    'sessions/session_C/channel_1_200_0_1_1': int64LE(gpsTs),
    'sessions/session_C/channel_1_200_0_3_0': int32LE(latLonPairs),
    'sessions/session_C/channel_1_200_0_2_1': int64LE(distanceMm),
    'sessions/session_C/channel_1_100_0_1_1': int64LE(can1Ts),
    'sessions/session_C/channel_1_100_0_9_0': int32LE(accX),
    'sessions/session_C/channel_1_100_0_10_0': int32LE(accY),
    'sessions/session_C/channel_1_100_0_11_0': int32LE(accZ),
    'sessions/session_C/channel_1_101_0_1_1': int64LE(can2Ts),
    'sessions/session_C/channel_1_101_0_12_0': int32LE(gyroX),
    'sessions/session_C/channel_1_101_0_9_0': int32LE(can2AccX),
    'sessions/session_C/channel_1_101_0_9999_0': int32LE(unknownIdValues),

    'sessions/session_D/session.json': new TextEncoder().encode(JSON.stringify(sessionD)),
    'sessions/session_D/sessionfragment.json': new TextEncoder().encode(JSON.stringify(fragmentD)),
    'sessions/session_D/channel_1_300_0_1_1': int64LE(dTs),
    'sessions/session_D/channel_1_300_0_12345_0': int32LE([1, 2, 3]),
  })
}

describe('parseRczBackupSession — F3 stage 2 CAN/ECU decode', () => {
  it('chooses the DENSEST device (CAN1, 6 samples) as master clock, not the device-list-first GPS (3 samples)', () => {
    const session = parseRczBackupSession(buildMultiDeviceBackup(), 'session_C')
    expect(session.rowCount).toBe(6)
    expect(session.meta.headerInfo.masterDeviceId).toBe('100')
    const time = session.timeChannel!
    expect(time.data[0]).toBe(0)
    expect(time.data[5]).toBeCloseTo(100, 5)
    expect(time.data[1]).toBeCloseTo(20, 5)
  })

  it('decodes CAN accel channels via decodeRcChannelName, fully UNSCALED (raw int, no unit)', () => {
    const session = parseRczBackupSession(buildMultiDeviceBackup(), 'session_C')
    const accX = session.get('rc_x_acc')!
    expect(accX.unit).toBeUndefined()
    // Master device itself: identity join, raw values pass straight through.
    expect(Array.from(accX.data)).toEqual([-3219, -3000, -2800, -2600, -2400, -2200])
  })

  it('disambiguates a channel-name collision across devices (both CAN1 and CAN2 expose id 9 → rc_x_acc)', () => {
    const session = parseRczBackupSession(buildMultiDeviceBackup(), 'session_C')
    expect(session.get('rc_x_acc')).toBeDefined() // CAN1 (master, first-seen) keeps the plain name
    const collided = session.get('rc_x_acc_dev101')! // CAN2 disambiguated by device id
    expect(collided).toBeDefined()
    expect(collided.unit).toBeUndefined()
    // CAN2 (5 samples) joined onto the 6-row master clock by nearest timestamp.
    expect(Array.from(collided.data)).toEqual([111, 222, 333, 444, 555, 555])
  })

  it('joins a non-master device (CAN2 gyro, 5 samples) onto the 6-row master clock by nearest timestamp', () => {
    const session = parseRczBackupSession(buildMultiDeviceBackup(), 'session_C')
    const gyroX = session.get('rc_x_rate_of_rotation')!
    expect(gyroX.unit).toBeUndefined()
    expect(Array.from(gyroX.data)).toEqual([19409, 15000, 10000, 5000, -35400, -35400])
  })

  it('falls through unknown ids (no NAMED_LO entry) to rc_channel_<id>', () => {
    const session = parseRczBackupSession(buildMultiDeviceBackup(), 'session_C')
    const unknown = session.get('rc_channel_9999')!
    expect(unknown).toBeDefined()
    expect(unknown.unit).toBeUndefined()
    expect(Array.from(unknown.data)).toEqual([7, 8, 9, 10, 11, 11])
  })

  it('decodes the id-2 cumulative-distance channel in km, joined from GPS rate onto the master clock', () => {
    const session = parseRczBackupSession(buildMultiDeviceBackup(), 'session_C')
    const distance = session.get('distance')!
    expect(distance.unit).toBe('km')
    // GPS (3 samples, mm: 0/2794/5378) nearest-joined onto the 6-row master clock.
    const expectedKm = [0, 0, 2794, 2794, 5378, 5378].map((mm) => mm / 1_000_000)
    Array.from(distance.data).forEach((v, i) => expect(v).toBeCloseTo(expectedKm[i], 9))
  })

  it('reports per-device diagnostics in headerInfo (device count, per-device channel count, sample rates)', () => {
    const session = parseRczBackupSession(buildMultiDeviceBackup(), 'session_C')
    expect(session.meta.headerInfo.deviceCount).toBe('3')
    expect(session.meta.headerInfo.undecodedDeviceCount).toBeUndefined() // all 3 devices had ts streams
    expect(session.meta.headerInfo.device_100_type).toBe('2')
    expect(session.meta.headerInfo.device_100_channels).toBe('3') // accX, accY, accZ
    expect(session.meta.headerInfo.device_101_channels).toBe('3') // gyroX, collided accX, unknown id
    expect(Number(session.meta.headerInfo.masterSampleRateHz)).toBeCloseTo(50, 0)
  })

  it('never inflates a non-selected session\'s channel blobs — session D\'s unique channel id never leaks into session C', () => {
    const bytes = buildMultiDeviceBackup()
    const sessionC = parseRczBackupSession(bytes, 'session_C')
    expect(sessionC.get('rc_channel_12345')).toBeUndefined()

    // Sanity: session D decodes independently and DOES have that channel.
    const sessionD = parseRczBackupSession(bytes, 'session_D')
    expect(sessionD.get('rc_channel_12345')).toBeDefined()
    expect(sessionD.rowCount).toBe(3)
  })
})
