import { describe, it, expect } from 'vitest'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { Rc3NmeaExporter } from '@/domain/export/rc3Nmea/Rc3NmeaExporter'
import { parseNmea, NmeaParseError } from '@/domain/import/nmea/NmeaReader'
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

  // M9 P2 — this legacy text importer previously had no upper bound on input
  // size at all (unlike CSV's MAX_PLAIN_CSV_CELLS / VBO's MAX_GRID_CELLS).
  // `maxTextChars` lets the test exercise the cap at a tiny scale instead of
  // building a 200-million-character string.
  it('rejects an oversized file before parsing any sentence (file-size cap)', () => {
    const text = 'x'.repeat(1000)
    expect(() => parseNmea(text, 100)).toThrow(NmeaParseError)
    expect(() => parseNmea(text, 100)).toThrow(/refusing a 1,000-character file/)
  })

  it('still accepts a well-formed file at the same reduced cap', () => {
    const line = '$GPRMC,095409.300,A,2450.5554,N,12112.0367,E,30.78,24.1,190921,,,A*54\r\n'
    expect(parseNmea(line, 1000).fixes).toHaveLength(1)
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
