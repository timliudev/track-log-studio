import { describe, it, expect } from 'vitest'
import { mergeSessions, GPS_CHANNEL_NAMES } from '@/domain/analysis/sessionMerge'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, data: number[], description?: string): Channel {
  return { name, rawName: name, description, data: new Float32Array(data) }
}

/** Base "loga" session: Time + RPM, no (or broken) GPS. */
function makeBase(timeMs: number[], rpm: number[]): LogSession {
  return new LogSession([channel('Time', timeMs), channel('RPM', rpm)], {
    formatId: 'superX',
    createdDate: null,
    headerInfo: {},
  })
}

/** GPS "nmea" session: Time + GPS_Lat/Lon/Speed/Course. */
function makeGps(timeMs: number[], lat: number[], lon: number[], speed: number[], course: number[]): LogSession {
  return new LogSession(
    [
      channel('Time', timeMs),
      channel('GPS_Lat', lat),
      channel('GPS_Lon', lon),
      channel('GPS_Speed', speed),
      channel('GPS_Course', course),
    ],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

describe('mergeSessions', () => {
  it('aligns GPS onto base time axis with zero offset', () => {
    const base = makeBase([0, 1000, 2000, 3000], [1000, 2000, 3000, 4000])
    const gps = makeGps([0, 1000, 2000, 3000], [10, 11, 12, 13], [120, 121, 122, 123], [50, 60, 70, 80], [0, 5, 10, 15])

    const merged = mergeSessions(base, gps, { offsetMs: 0 })
    expect(merged).not.toBeNull()

    const byName = new Map(merged!.map((c) => [c.name, c]))
    expect([...byName.get('GPS_Lat')!.data]).toEqual([10, 11, 12, 13])
    expect([...byName.get('GPS_Speed')!.data]).toEqual([50, 60, 70, 80])
    // Base channels preserved untouched.
    expect([...byName.get('RPM')!.data]).toEqual([1000, 2000, 3000, 4000])
    expect([...byName.get('Time')!.data]).toEqual([0, 1000, 2000, 3000])
  })

  it('applies a positive offset (gps clock ahead of base) by shifting the sampled instant back', () => {
    // gps recorded values that at gps-time T correspond to base-time T - offsetMs (offsetMs added to gps to match base).
    // Use a simple linear ramp in gps so we can predict the interpolated value.
    const gpsTime = [0, 1000, 2000, 3000, 4000]
    const gpsLat = [0, 10, 20, 30, 40] // linear: lat = gpsTime / 100

    const base = makeBase([500, 1500, 2500], [1, 2, 3])
    const gps = makeGps(gpsTime, gpsLat, gpsLat, gpsLat, gpsLat)

    const offsetMs = 500 // gps is 500ms ahead; gpsInstant = baseTime - offsetMs
    const merged = mergeSessions(base, gps, { offsetMs })!
    const lat = merged.find((c) => c.name === 'GPS_Lat')!.data

    // base time 500 -> gpsInstant 0   -> lat 0
    // base time 1500 -> gpsInstant 1000 -> lat 10
    // base time 2500 -> gpsInstant 2000 -> lat 20
    expect(lat[0]).toBeCloseTo(0, 6)
    expect(lat[1]).toBeCloseTo(10, 6)
    expect(lat[2]).toBeCloseTo(20, 6)
  })

  it('produces NaN outside the gps session coverage after offset', () => {
    const base = makeBase([0, 1000, 5000, 9000], [1, 2, 3, 4])
    const gps = makeGps([0, 1000, 2000], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3])

    const merged = mergeSessions(base, gps, { offsetMs: 0 })!
    const lat = merged.find((c) => c.name === 'GPS_Lat')!.data
    expect(lat[0]).toBeCloseTo(1, 6)
    expect(lat[1]).toBeCloseTo(2, 6)
    expect(Number.isNaN(lat[2])).toBe(true) // t=5000 outside gps [0,2000]
    expect(Number.isNaN(lat[3])).toBe(true) // t=9000 outside gps [0,2000]
  })

  it('leaves base channels as the same untouched data (not copied/mutated)', () => {
    const base = makeBase([0, 1000, 2000], [1, 2, 3])
    const rpmChannelBefore = base.get('RPM')!
    const gps = makeGps([0, 1000, 2000], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3])

    const merged = mergeSessions(base, gps, { offsetMs: 0 })!
    const rpmChannelAfter = merged.find((c) => c.name === 'RPM')!
    expect(rpmChannelAfter).toBe(rpmChannelBefore) // same reference, not a copy
  })

  it('replaces an existing broken GPS channel in base rather than duplicating it', () => {
    const base = new LogSession(
      [channel('Time', [0, 1000, 2000]), channel('GPS_Lat', [NaN, NaN, NaN])],
      { formatId: 'superX', createdDate: null, headerInfo: {} },
    )
    const gps = makeGps([0, 1000, 2000], [10, 20, 30], [1, 2, 3], [1, 2, 3], [1, 2, 3])

    const merged = mergeSessions(base, gps, { offsetMs: 0 })!
    const latChannels = merged.filter((c) => c.name === 'GPS_Lat')
    expect(latChannels).toHaveLength(1)
    expect([...latChannels[0].data]).toEqual([10, 20, 30])
  })

  it('only merges channels present in the gps session (skips missing ones)', () => {
    const base = makeBase([0, 1000], [1, 2])
    const gpsPartial = new LogSession(
      [channel('Time', [0, 1000]), channel('GPS_Lat', [1, 2]), channel('GPS_Lon', [3, 4])],
      { formatId: 'nmea', createdDate: null, headerInfo: {} },
    )
    const merged = mergeSessions(base, gpsPartial, { offsetMs: 0 })!
    const names = merged.map((c) => c.name)
    expect(names).toContain('GPS_Lat')
    expect(names).toContain('GPS_Lon')
    expect(names).not.toContain('GPS_Speed')
    expect(names).not.toContain('GPS_Course')
  })

  it('respects a custom gpsChannelNames subset', () => {
    const base = makeBase([0, 1000], [1, 2])
    const gps = makeGps([0, 1000], [1, 2], [3, 4], [5, 6], [7, 8])
    const merged = mergeSessions(base, gps, { offsetMs: 0, gpsChannelNames: ['GPS_Speed'] })!
    const names = merged.map((c) => c.name)
    expect(names).toContain('GPS_Speed')
    expect(names).not.toContain('GPS_Lat')
  })

  it('returns null when base has no time channel', () => {
    const base = new LogSession([channel('RPM', [1, 2, 3])], { formatId: 'superX', createdDate: null, headerInfo: {} })
    const gps = makeGps([0, 1000, 2000], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3])
    expect(mergeSessions(base, gps, { offsetMs: 0 })).toBeNull()
  })

  it('returns null when gps has no time channel', () => {
    const base = makeBase([0, 1000], [1, 2])
    const gpsNoTime = new LogSession([channel('GPS_Lat', [1, 2])], { formatId: 'nmea', createdDate: null, headerInfo: {} })
    expect(mergeSessions(base, gpsNoTime, { offsetMs: 0 })).toBeNull()
  })

  it('returns null when base time channel is empty', () => {
    const base = new LogSession([channel('Time', []), channel('RPM', [])], {
      formatId: 'superX',
      createdDate: null,
      headerInfo: {},
    })
    const gps = makeGps([0, 1000], [1, 2], [1, 2], [1, 2], [1, 2])
    expect(mergeSessions(base, gps, { offsetMs: 0 })).toBeNull()
  })

  it('default gpsChannelNames matches the exported GPS_CHANNEL_NAMES constant', () => {
    expect(GPS_CHANNEL_NAMES).toEqual(['GPS_Lat', 'GPS_Lon', 'GPS_Speed', 'GPS_Course'])
  })
})
