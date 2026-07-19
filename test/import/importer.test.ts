import { describe, it, expect } from 'vitest'
import {
  detectImporter,
  allImportExtensions,
} from '@/domain/import/registry'
import { IMPORT_FORMATS } from '@/domain/import/formatDefinitions'
import { logaImporter } from '@/domain/import/loga/LogaImporter'
import { nmeaImporter } from '@/domain/import/nmea/NmeaImporter'
import { csvImporter } from '@/domain/import/csv/CsvImporter'
import { vboImporter } from '@/domain/import/vbo/VboImporter'
import { rczImporter } from '@/domain/import/rcz/RczImporter'
import { rcnxImporter } from '@/domain/import/rcnx/RcnxImporter'
import { xrkImporter } from '@/domain/import/xrk/XrkImporter'
import { loadFixture } from '../fixtures'

/** Build an ImportCandidate from a filename + headText (headBytes derived). */
function candidate(fileName: string, headText: string) {
  return { fileName, headText, headBytes: new TextEncoder().encode(headText) }
}

describe('detectImporter', () => {
  it('picks logaImporter by .loga filename', () => {
    expect(detectImporter(candidate('run01.loga', ''))?.id).toBe(logaImporter.id)
  })

  it('picks logaImporter by known loga header content', () => {
    const headText = loadFixture('super2.loga').slice(0, 4096)
    expect(detectImporter(candidate('mystery.txt', headText))?.id).toBe(logaImporter.id)
  })

  it('picks nmeaImporter by .nmea filename', () => {
    expect(detectImporter(candidate('track.nmea', ''))?.id).toBe(nmeaImporter.id)
  })

  it('picks nmeaImporter by $GPRMC content', () => {
    const headText = '$GPRMC,095409.300,A,2450.5554,N,12112.0367,E,30.78,24.1,190921,,,A*54\n'
    expect(detectImporter(candidate('mystery.txt', headText))?.id).toBe(nmeaImporter.id)
  })

  it('picks csvImporter by .csv filename', () => {
    expect(detectImporter(candidate('telemetry.csv', 'Time,RPM\n0,1000\n'))?.id).toBe(csvImporter.id)
  })

  it('returns undefined for unrecognised files', () => {
    expect(detectImporter(candidate('notes.txt', 'hello'))).toBeUndefined()
  })
})

describe('lightweight format definitions', () => {
  const parserImporters = [
    logaImporter,
    nmeaImporter,
    vboImporter,
    csvImporter,
    rczImporter,
    rcnxImporter,
    xrkImporter,
  ]
  const candidates = [
    candidate('run.loga', ''),
    candidate('unknown.bin', loadFixture('super2.loga').slice(0, 4096)),
    candidate('track.nmea', ''),
    candidate('unknown.txt', '$GPRMC,095409.300,A,2450.5554,N,12112.0367,E,30.78,24.1,190921,,,A*54\n'),
    candidate('session.vbo', ''),
    candidate('unknown.txt', '[header]\n'),
    candidate('telemetry.csv', 'Time,RPM\n0,1000\n'),
    candidate('track.rcz', ''),
    candidate('track.rcnx', ''),
    candidate('session.xrk', ''),
    candidate('session.xrz', ''),
    { fileName: 'unknown.bin', headText: '', headBytes: new Uint8Array([0x3c, 0x68, 0x43, 0x4e, 0x46]) },
    { fileName: 'unknown.bin', headText: '', headBytes: new Uint8Array([0x78, 0x9c]) },
    candidate('notes.txt', 'nothing recognised'),
  ]

  it('keeps format id and extension order equal to parser implementations', () => {
    expect(IMPORT_FORMATS.map(({ id, extensions }) => ({ id, extensions }))).toEqual(
      parserImporters.map(({ id, extensions }) => ({ id, extensions })),
    )
  })

  it('has identical detection behaviour to each parser implementation', () => {
    for (const format of IMPORT_FORMATS) {
      const parser = parserImporters.find((item) => item.id === format.id)
      expect(parser, format.id).toBeDefined()
      for (const value of candidates) {
        expect(format.detect(value), `${format.id}: ${value.fileName}`).toBe(parser!.detect(value))
      }
    }
  })
})

describe('allImportExtensions', () => {
  it('lists every registered extension', () => {
    expect(allImportExtensions()).toEqual(['loga', 'nmea', 'vbo', 'csv', 'rcz', 'rcnx', 'xrk', 'xrz'])
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

  it('csvImporter parses a generic telemetry CSV', async () => {
    const session = await csvImporter.parse('Time,RPM\n0,1000\n')
    expect(session.meta.formatId).toBe('csv')
    expect(session.get('RPM')?.data[0]).toBe(1000)
  })
})
