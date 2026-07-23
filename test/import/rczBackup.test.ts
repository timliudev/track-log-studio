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

  it('populates headerInfo from session.json, and flags the un-decoded CAN/ECU device count', () => {
    const session = parseRczBackupSession(buildSyntheticBackup(), 'session_A')
    expect(session.meta.headerInfo.sessionKey).toBe('session_A')
    expect(session.meta.headerInfo.lapCount).toBe('2')
    expect(session.meta.headerInfo.bestLaptime).toBe('52314')
    expect(session.meta.headerInfo.trackId).toBe('42')
    // 1 CAN/ECU device (id 100, type 2) alongside the GPS device — not decoded in stage 1.
    expect(session.meta.headerInfo.otherDeviceCount).toBe('1')
    expect(session.meta.createdDate!.getTime()).toBe(1_782_000_000_000)
  })

  it('omits bestLaptime from headerInfo when it is still the Int64-max "unset" sentinel', () => {
    const session = parseRczBackupSession(buildSyntheticBackup(), 'session_B')
    expect(session.meta.headerInfo.bestLaptime).toBeUndefined()
    // Single-device session: no otherDeviceCount entry at all.
    expect(session.meta.headerInfo.otherDeviceCount).toBeUndefined()
  })

  it('throws a clear error for an unknown session key', () => {
    expect(() => parseRczBackupSession(buildSyntheticBackup(), 'session_missing')).toThrow(
      /no files found/,
    )
  })
})
