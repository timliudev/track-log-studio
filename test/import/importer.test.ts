import { describe, it, expect } from 'vitest'
import {
  detectImporter,
  allImportExtensions,
} from '@/domain/import/registry'
import { logaImporter } from '@/domain/import/loga/LogaImporter'
import { nmeaImporter } from '@/domain/import/nmea/NmeaImporter'
import { loadFixture } from '../fixtures'

/** Build an ImportCandidate from a filename + headText (headBytes derived). */
function candidate(fileName: string, headText: string) {
  return { fileName, headText, headBytes: new TextEncoder().encode(headText) }
}

describe('detectImporter', () => {
  it('picks logaImporter by .loga filename', () => {
    expect(detectImporter(candidate('run01.loga', ''))).toBe(logaImporter)
  })

  it('picks logaImporter by known loga header content', () => {
    const headText = loadFixture('super2.loga').slice(0, 4096)
    expect(detectImporter(candidate('mystery.txt', headText))).toBe(logaImporter)
  })

  it('picks nmeaImporter by .nmea filename', () => {
    expect(detectImporter(candidate('track.nmea', ''))).toBe(nmeaImporter)
  })

  it('picks nmeaImporter by $GPRMC content', () => {
    const headText = '$GPRMC,095409.300,A,2450.5554,N,12112.0367,E,30.78,24.1,190921,,,A*54\n'
    expect(detectImporter(candidate('mystery.txt', headText))).toBe(nmeaImporter)
  })

  it('returns undefined for unrecognised files', () => {
    expect(detectImporter(candidate('notes.txt', 'hello'))).toBeUndefined()
  })
})

describe('allImportExtensions', () => {
  it('lists every registered extension', () => {
    expect(allImportExtensions()).toEqual(['loga', 'nmea', 'vbo', 'rcz', 'rcnx', 'xrk'])
  })
})

describe('importer.parse', () => {
  it('logaImporter parses a fixture into a LogSession with a loga formatId', async () => {
    const session = await logaImporter.parse(loadFixture('super2.loga'))
    expect(session.meta.formatId).toBe('super2')
    expect(session.has('RPM')).toBe(true)
    expect(session.rowCount).toBeGreaterThan(0)
  })

  it('nmeaImporter parses a fixture into an nmea LogSession', async () => {
    const session = await nmeaImporter.parse(loadFixture('super2.expected.nmea'))
    expect(session.meta.formatId).toBe('nmea')
    expect(session.has('GPS_Lat')).toBe(true)
    expect(session.rowCount).toBeGreaterThan(0)
  })
})
