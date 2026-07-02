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
})
