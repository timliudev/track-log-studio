import { describe, expect, it } from 'vitest'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { convertToCsv } from '@/domain/export/csv/CsvExporter'
import { exportMetadataHeader } from '@/domain/export/metadata'
import { PlainCsvParseError, parsePlainCsv } from '@/domain/import/csv/parsePlainCsv'

describe('parsePlainCsv', () => {
  it('accepts UTF-8 BOM, blank leading rows and CRLF while canonicalizing Time', () => {
    const session = parsePlainCsv('\ufeff\r\n\r\nRPM,tImE,TPS\r\n1000,0,\r\ninvalid,100,50\r\n')
    expect(session.meta.formatId).toBe('csv')
    expect(session.channels.map((channel) => channel.name)).toEqual(['RPM', 'Time', 'TPS'])
    expect(session.get('Time')?.data).toEqual(new Float32Array([0, 100]))
    expect(Number.isNaN(session.get('RPM')!.data[1])).toBe(true)
    expect(Number.isNaN(session.get('TPS')!.data[0])).toBe(true)
  })

  it('handles RFC 4180 quoted commas, escaped quotes and embedded newlines', () => {
    const session = parsePlainCsv([
      '"RPM, main",Timer,"quoted ""channel"""',
      '1000,0,"12',
      '3"',
    ].join('\r\n'))
    expect(session.channels.map((channel) => channel.name)).toEqual(['RPM, main', 'Timer', 'quoted "channel"'])
    expect(session.get('RPM, main')?.data[0]).toBe(1000)
    expect(session.get('Timer')?.data[0]).toBe(0)
    expect(Number.isNaN(session.get('quoted "channel"')!.data[0])).toBe(true)
  })

  it('extracts TLS metadata without creating a telemetry channel', () => {
    const metadata = exportMetadataHeader({ cvtNotes: [{ label: 'Roller', value: '10 g' }] })!
    const session = parsePlainCsv(`Time,RPM,${metadata}\n0,1000,\n`)
    expect(session.has(metadata)).toBe(false)
    expect(session.meta.exportMetadata?.cvtNotes).toEqual([{ label: 'Roller', value: '10 g' }])
  })

  it('round-trips the generic CSV exporter and its metadata column', () => {
    const channel = (name: string, values: number[]): Channel => ({
      name, rawName: name, description: undefined, data: new Float32Array(values),
    })
    const source = new LogSession([
      channel('Time', [0, 100]),
      channel('GPS_Lat', [24.5, 24.6]),
      channel('GPS_Lon', [121.5, 121.6]),
      channel('GPS_Speed', [30, 40]),
      channel('RPM', [1000, 2000]),
    ], { formatId: 'test', createdDate: null, headerInfo: {} })
    const text = convertToCsv(source, { cvtNotes: [{ label: 'Spring', value: '8 kg' }] })[0].content
    const parsed = parsePlainCsv(text)
    expect(parsed.rowCount).toBe(2)
    expect(parsed.get('RPM')?.data).toEqual(new Float32Array([1000, 2000]))
    expect(parsed.meta.exportMetadata?.cvtNotes).toEqual([{ label: 'Spring', value: '8 kg' }])
  })

  it.each([
    ['missing time', 'RPM,TPS\n1000,50\n'],
    ['ambiguous time', 'Time,Timer\n0,0\n'],
    ['duplicate headers', 'Time,RPM,rpm\n0,1,2\n'],
    ['no data', 'Time,RPM\n\n'],
    ['extra cell', 'Time,RPM\n0,1000,50\n'],
    ['missing cell', 'Time,RPM\n0\n'],
    ['unterminated quote', 'Time,RPM\n0,"1000\n'],
    ['text after closing quote', 'Time,RPM\n0,"1000"oops\n'],
  ])('rejects %s', (_label, text) => {
    expect(() => parsePlainCsv(text)).toThrow(PlainCsvParseError)
  })

  // Security regression: the cell cap must be enforced PER FIELD, not only
  // once a row completes at a newline. Before this fix, a single line with
  // no newline at all (a malicious header, or a data row that never
  // terminates) fully materialized as an in-memory array before any cap
  // check ever ran — a crafted file could exhaust memory despite the
  // documented MAX_PLAIN_CSV_CELLS protection. `maxCells` lets the test
  // exercise this at a tiny scale instead of building a 50-million-cell string.
  it('rejects an over-wide header row even with no trailing newline (cap bypass via one long line)', () => {
    const hugeHeader = ['Time', ...Array.from({ length: 10 }, (_, i) => `Ch${i}`)].join(',')
    expect(() => parsePlainCsv(hugeHeader, 5)).toThrow(PlainCsvParseError)
    expect(() => parsePlainCsv(hugeHeader, 5)).toThrow(/refusing more than 5 cells/)
  })

  it('rejects an over-wide unterminated data row before finishing that row', () => {
    const text = `Time,RPM\n${Array.from({ length: 10 }, (_, i) => i).join(',')}`
    expect(() => parsePlainCsv(text, 6)).toThrow(PlainCsvParseError)
    expect(() => parsePlainCsv(text, 6)).toThrow(/refusing more than 6 cells/)
  })

  it('still accepts a well-formed file at the same reduced cap', () => {
    // 6 total fields: 2-column header + two 2-column data rows.
    const session = parsePlainCsv('Time,RPM\n0,1000\n1,1100\n', 6)
    expect(session.get('RPM')?.data).toEqual(new Float32Array([1000, 1100]))
  })
})
