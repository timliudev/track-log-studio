import { describe, it, expect } from 'vitest'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { convertToCsv } from '@/domain/export/csv/CsvExporter'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

const META = { formatId: 'superX', createdDate: null, headerInfo: {} }

describe('convertToCsv', () => {
  it('produces the exact expected CSV for a small GPS + telemetry session (golden)', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100, 200]),
        channel('GPS_Lat', [24.5, 24.501, 24.502]),
        channel('GPS_Lon', [121.5, 121.501, 121.502]),
        channel('GPS_Speed', [0, 50.5, 100]),
        channel('RPM', [1000, 5000, 9000]),
        channel('TPS_Percent', [0, 50, 100]),
      ],
      META,
    )

    const artifacts = convertToCsv(session)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].suffix).toBe('')
    expect(artifacts[0].ext).toBe('csv')

    // GPS_Lat/GPS_Lon round-trip through Float32Array storage (~7 significant
    // digits), so the 7-decimal cells below reflect the actual stored value —
    // not the literal typed above — same as fmtCoord() would render it.
    const expected =
      'Time,GPS_Lat,GPS_Lon,GPS_Speed,RPM,TPS_Percent\n' +
      '0,24.5,121.5,0,1000,0\n' +
      '100,24.5009995,121.5009995,50.5,5000,50\n' +
      '200,24.5020008,121.5019989,100,9000,100\n'

    expect(artifacts[0].content).toBe(expected)
  })

  it('renders NaN / missing samples as empty cells, never 0', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100]),
        channel('GPS_Lat', [24.5, NaN]),
        channel('GPS_Lon', [121.5, NaN]),
        channel('GPS_Speed', [10, NaN]),
        channel('RPM', [NaN, 5000]),
      ],
      META,
    )

    const artifacts = convertToCsv(session)
    const expected =
      'Time,GPS_Lat,GPS_Lon,GPS_Speed,RPM\n' +
      '0,24.5,121.5,10,\n' +
      '100,,,,5000\n'

    expect(artifacts[0].content).toBe(expected)
  })

  it('keeps GPS_Lat/GPS_Lon/GPS_Speed columns present (empty) for a session with no GPS at all', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('RPM', [1000, 2000]), channel('TPS_Percent', [10, 20])],
      META,
    )

    const artifacts = convertToCsv(session)
    const expected =
      'Time,GPS_Lat,GPS_Lon,GPS_Speed,RPM,TPS_Percent\n' + '0,,,,1000,10\n' + '100,,,,2000,20\n'

    expect(artifacts[0].content).toBe(expected)
  })

  it('resolves the integer deg/min/mmmm + NS/EW GPS encoding to decimal degrees', () => {
    const session = new LogSession(
      [
        channel('Time', [0]),
        channel('GPS_Lat_deg', [24]),
        channel('GPS_Lat_min', [30]),
        channel('GPS_Lat_mmmm', [0]),
        channel('GPS_Lat_NS', ['N'.charCodeAt(0)]),
        channel('GPS_Lon_deg', [121]),
        channel('GPS_Lon_min', [30]),
        channel('GPS_Lon_mmmm', [0]),
        channel('GPS_Lon_EW', ['E'.charCodeAt(0)]),
        channel('GPS_Speed', [42]),
        channel('RPM', [3000]),
      ],
      META,
    )

    const artifacts = convertToCsv(session)
    // 24 + 30/60 = 24.5; 121 + 30/60 = 121.5. Raw deg/min/mmmm/NS/EW columns
    // themselves must NOT reappear as trailing channels (they're GPS dupes).
    const expected = 'Time,GPS_Lat,GPS_Lon,GPS_Speed,RPM\n' + '0,24.5,121.5,42,3000\n'

    expect(artifacts[0].content).toBe(expected)
  })

  it('orders trailing channels deterministically, matching session.channels order', () => {
    const session = new LogSession(
      [
        channel('Time', [0]),
        channel('Zeta', [1]),
        channel('Alpha', [2]),
        channel('Mu', [3]),
      ],
      META,
    )

    const header = convertToCsv(session)[0].content.split('\n')[0]
    expect(header).toBe('Time,GPS_Lat,GPS_Lon,GPS_Speed,Zeta,Alpha,Mu')
  })

  it('excludes GPS_CONSUMED raw-encoding channels and includes derived suspension channels', () => {
    const session = new LogSession(
      [
        channel('Time', [0]),
        channel('GPS_UTC_hh', [12]),
        channel('GPS_UTC_mm', [0]),
        channel('GPS_UTC_ss', [0]),
        channel('GPS_UTC_ms', [0]),
        channel('Front Suspension', [15.5]),
      ],
      META,
    )

    const header = convertToCsv(session)[0].content.split('\n')[0]
    expect(header).toBe('Time,GPS_Lat,GPS_Lon,GPS_Speed,Front Suspension')
  })

  it('uses LF-only line endings and no BOM', () => {
    const session = new LogSession([channel('Time', [0]), channel('RPM', [1000])], META)
    const content = convertToCsv(session)[0].content

    expect(content).not.toContain('\r\n')
    expect(content.charCodeAt(0)).not.toBe(0xfeff)
    expect(content.codePointAt(0)).toBe('T'.codePointAt(0))
  })

  // ---------------------------------------------------------------------
  // RaceStudio3 import-compatibility. This app has NO CSV *importer* (see
  // src/domain/import/registry.ts — only loga/nmea/vbo/rcz/rcnx/xrk) — the
  // generic `.csv` format is export-only, produced for external tools
  // (RS3 / Excel / Python) to import. So there is nothing here for RS3's
  // own metadata-preamble convention ("Format","AIM CSV File" / "Venue" /
  // "Beginning of data" rows before the header — RS3's *own* export/import
  // style) to be "tolerant" of on our *import* side, because we don't import
  // CSV at all. What actually matters for RS3 compatibility is the shape of
  // the file THIS app hands to RS3 on the way out: it must be a plain,
  // unambiguous header+data CSV that RS3's importer (which also accepts a
  // plain "CSV (Comma Separated Values)" style alongside its RS2Analysis/
  // SCCA/FastLap styles, per RS3's own export-format picker) can read without
  // needing any special preamble-skipping logic. These tests pin that shape:
  // no leading metadata/comment lines, a single header row, and RFC 4180
  // quoting that a naive line-based CSV reader parses correctly.
  // ---------------------------------------------------------------------
  describe('RaceStudio3 import compatibility (export-side; no CSV importer exists in this app)', () => {
    it('starts the file directly with the header row — no metadata/comment preamble', () => {
      const session = new LogSession([channel('Time', [0, 100]), channel('RPM', [1000, 2000])], META)
      const content = convertToCsv(session)[0].content
      const lines = content.split('\n')

      // First line must be the header itself, not a "Format","AIM CSV File"
      // style metadata row or a blank line.
      expect(lines[0]).toBe('Time,GPS_Lat,GPS_Lon,GPS_Speed,RPM')
      expect(lines[0].toLowerCase()).not.toContain('format')
      expect(lines[0].toLowerCase()).not.toContain('venue')
      expect(lines[0].toLowerCase()).not.toContain('beginning of data')
    })

    it('every data row has the same column count as the header (no ragged rows from an unskipped preamble)', () => {
      const session = new LogSession(
        [
          channel('Time', [0, 100, 200]),
          channel('GPS_Lat', [24.5, 24.501, 24.502]),
          channel('GPS_Lon', [121.5, 121.501, 121.502]),
          channel('GPS_Speed', [0, 50.5, 100]),
          channel('RPM', [1000, 5000, 9000]),
        ],
        META,
      )
      const content = convertToCsv(session)[0].content
      const lines = content.split('\n').filter((l) => l.length > 0)
      const headerCols = lines[0].split(',').length

      expect(lines.length).toBe(4) // header + 3 data rows
      for (const line of lines) {
        expect(line.split(',')).toHaveLength(headerCols)
      }
    })

    it('quotes a channel name containing a comma per RFC 4180, and it round-trips through a naive CSV split', () => {
      const session = new LogSession(
        [channel('Time', [0]), channel('Brake Temp, FL', [95.5])],
        META,
      )
      const content = convertToCsv(session)[0].content
      const header = content.split('\n')[0]

      // The comma-bearing name must be wrapped in quotes so a naive
      // split(',') on the *unquoted* commas still yields the right column
      // count (the leading GPS_Lat/GPS_Lon/GPS_Speed columns are always
      // present regardless of session content).
      expect(header).toBe('Time,GPS_Lat,GPS_Lon,GPS_Speed,"Brake Temp, FL"')

      // A minimal RFC-4180-aware split (respects quoted commas) recovers the
      // original five logical columns — the quoted field is not split on its
      // embedded comma.
      const cols = header.match(/(".*?"|[^,]+)(?=,|$)/g)
      expect(cols).toEqual(['Time', 'GPS_Lat', 'GPS_Lon', 'GPS_Speed', '"Brake Temp, FL"'])
    })

    it('produces no blank lines between the header and the last data row', () => {
      const session = new LogSession([channel('Time', [0, 100]), channel('RPM', [1000, 2000])], META)
      const content = convertToCsv(session)[0].content
      // Split on '\n'; the export ends with a single trailing '\n' (one
      // trailing empty element after split), so drop only that.
      const lines = content.split('\n')
      expect(lines[lines.length - 1]).toBe('')
      const bodyLines = lines.slice(0, -1)
      expect(bodyLines.every((l) => l.length > 0)).toBe(true)
    })
  })
})
