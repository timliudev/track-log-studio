import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { Rc3NmeaExporter } from '@/domain/export/rc3Nmea/Rc3NmeaExporter'
import { parseNmea } from '@/domain/import/nmea/NmeaReader'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'
import { extractGpsTrack } from '@/domain/analysis/gpsTrack'
import { loadFixture } from '../fixtures'

describe('parseNmea', () => {
  it('round-trips GPS from our exporter (export → re-import)', () => {
    const session = parseLoga(loadFixture('super2.loga')) // has GPS + UTC
    const nmea = new Rc3NmeaExporter().export(session)
    const data = parseNmea(nmea)

    expect(data.fixes.length).toBeGreaterThan(0)

    const track = extractGpsTrack(session)
    const i = track.valid.indexOf(1)
    expect(data.fixes[0].lat).toBeCloseTo(track.lat[i], 4)
    expect(data.fixes[0].lon).toBeCloseTo(track.lon[i], 4)
  })

  it('skips sentences with a bad checksum', () => {
    const line = '$GPRMC,120000.000,A,2306.0000,N,12012.0000,E,0.0,0.0,010100,,,A*00\r\n'
    expect(parseNmea(line).fixes).toHaveLength(0)
  })
})

describe('nmeaToSession', () => {
  it('produces a LogSession with GPS channels', () => {
    const text = loadFixture('super2.expected.nmea')
    const session = nmeaToSession(text)
    expect(session.meta.formatId).toBe('nmea')
    expect(session.get('GPS_Lat')).toBeDefined()
    expect(session.get('GPS_Lon')).toBeDefined()
    expect(session.get('GPS_Speed')).toBeDefined()
    expect(session.get('Time')).toBeDefined()
    expect(session.get('Time')?.unit).toBe('ms')
    expect(session.get('GPS_Speed')?.unit).toBe('km/h')
    expect(session.rowCount).toBeGreaterThan(0)
  })

  it('Time channel starts from zero', () => {
    const text = loadFixture('super2.expected.nmea')
    const session = nmeaToSession(text)
    expect(session.get('Time')!.data[0]).toBe(0)
  })
})
