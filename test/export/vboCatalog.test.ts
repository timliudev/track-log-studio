import { describe, it, expect } from 'vitest'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { buildVboCatalog, buildVboDisplayMap, convertToVbo } from '@/domain/export/vbo/VboExporter'

function channel(name: string, data: number[], unit?: string): Channel {
  return { name, rawName: name, description: undefined, unit, data: new Float32Array(data) }
}

const META = { formatId: 'rcz', createdDate: null, headerInfo: {} }

describe('buildVboCatalog — B124 all-NaN channels are dropped', () => {
  it('drops a channel whose raw data is entirely NaN, everywhere it could appear', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100, 200]),
        channel('RPM', [1000, 2000, 3000]),
        channel('rc_x_acc_dev300', [NaN, NaN, NaN]),
      ],
      META,
    )

    const { channels, skipped } = buildVboCatalog(session)
    expect(channels.map((c) => c.ctTitle)).toEqual(['RPM'])
    expect(skipped.map((s) => s.ctTitle)).toEqual(['rc_x_acc_dev300'])

    // Never appears in [header] / [channel units] / [column names] / [data].
    const artifacts = convertToVbo(session, 'test.rcz')
    for (const suffix of ['_ct', '_rc'] as const) {
      const content = artifacts.find((a) => a.suffix === suffix)!.content
      expect(content).not.toContain('rc_x_acc_dev300')

      const lines = content.split('\r\n')
      const headerStart = lines.indexOf('[header]') + 1
      const headerEnd = lines.indexOf('', headerStart)
      const header = lines.slice(headerStart, headerEnd)

      const unitsStart = lines.indexOf('[channel units]') + 1
      const unitsEnd = lines.indexOf('', unitsStart)
      const units = lines.slice(unitsStart, unitsEnd)

      const namesStart = lines.indexOf('[column names]') + 1
      const names = lines[namesStart].split(' ')

      const dataStart = lines.indexOf('[data]') + 1
      const firstRow = lines[dataStart].split(' ')

      // Header count = 7 fixed GPS + 1 remaining channel (RPM); units and
      // column-name tokens must have the exact same count, and every data
      // row must have exactly that many fields too.
      expect(header).toHaveLength(8)
      expect(units).toHaveLength(8)
      expect(names).toHaveLength(8)
      expect(firstRow).toHaveLength(8)
    }
  })

  it('shows the dropped channel as a skipped row in the display map', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('rc_analog_13', [NaN, NaN])],
      META,
    )
    const rows = buildVboDisplayMap(session)
    const skippedRow = rows.find((r) => r.ecu === 'rc_analog_13')
    expect(skippedRow).toBeDefined()
    expect(skippedRow!.kind).toBe('skipped')
  })

  it('does not crash on a zero-row session', () => {
    const session = new LogSession([channel('Time', []), channel('RPM', [])], META)
    expect(() => buildVboCatalog(session)).not.toThrow()
    expect(() => convertToVbo(session, 'empty.rcz')).not.toThrow()
    const { channels, skipped } = buildVboCatalog(session)
    expect(channels.map((c) => c.ctTitle)).toEqual(['RPM'])
    expect(skipped).toEqual([])
  })
})

describe('buildVboCatalog — B125 digital/analog classification', () => {
  it('does not classify a constant-0 channel with real data as digital', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200]), channel('AlwaysZero', [0, 0, 0])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'AlwaysZero')!
    expect(ch.kind).not.toBe('digital')
    expect(ch.unit).not.toBe('bool')
  })

  it('does not classify a constant-1 channel with real data as digital', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200]), channel('AlwaysOne', [1, 1, 1])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'AlwaysOne')!
    expect(ch.kind).not.toBe('digital')
  })

  it('still classifies a genuinely-toggling 0/1 channel as digital', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200, 300]), channel('PitSwitch', [0, 1, 0, 1])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'PitSwitch')!
    expect(ch.kind).toBe('digital')
    expect(ch.unit).toBe('bool')
  })

  it('does not classify a DOP-style float channel that happens to fall in {0,1} as digital when it has a source unit', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100, 200]),
        channel('GPS_AltitudePrecision', [0, 1, 0], 'DOP'),
      ],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'GPS_AltitudePrecision')!
    expect(ch.kind).not.toBe('digital')
  })

  it('ignores sporadic NaN samples as neither digital nor non-digital evidence', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200, 300]), channel('Bearing', [0, NaN, 1, 0])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'Bearing')!
    expect(ch.kind).toBe('digital')
  })
})

describe('buildVboCatalog — B120 identifier passthrough', () => {
  it('passes rc_analog_5 through unchanged and never lets a generic channel steal that name', () => {
    // 5 generic (unnamed-identifier) analog channels BEFORE the real
    // rc_analog_5 — naive sequential allocation would hand the 5th one
    // exactly "rc_analog_5", colliding with the source channel of the same
    // name that appears later in channel order.
    const session = new LogSession(
      [
        channel('Time', [0, 100, 200]),
        channel('Custom1', [1.1, 1.2, 1.3]),
        channel('Custom2', [2.1, 2.2, 2.3]),
        channel('Custom3', [3.1, 3.2, 3.3]),
        channel('Custom4', [4.1, 4.2, 4.3]),
        channel('Custom5', [5.1, 5.2, 5.3]),
        channel('rc_analog_5', [13.1, 13.2, 13.4]),
      ],
      META,
    )

    const { channels } = buildVboCatalog(session)
    const passthrough = channels.find((c) => c.ctTitle === 'rc_analog_5')!
    expect(passthrough.rcName).toBe('rc_analog_5')
    expect(passthrough.kind).toBe('passthrough')

    // No duplicate rc_ names anywhere in the output header.
    const names = channels.map((c) => c.rcName)
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((n) => n === 'rc_analog_5')).toHaveLength(1)
  })

  it('passes rc_digital_2 through unchanged (user-assignable slot, not RPM)', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('rc_digital_2', [0, 51])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'rc_digital_2')!
    expect(ch.rcName).toBe('rc_digital_2')
    expect(ch.kind).toBe('passthrough')
    expect(ch.unit).not.toBe('bool')
  })

  it('passes rc_x_acc / rc_y_rate_of_rotation / rc_z_magn through unchanged', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100]),
        channel('rc_x_acc', [0.1, 0.2]),
        channel('rc_y_rate_of_rotation', [1, 2]),
        channel('rc_z_magn', [10, 20]),
      ],
      META,
    )
    const { channels } = buildVboCatalog(session)
    for (const name of ['rc_x_acc', 'rc_y_rate_of_rotation', 'rc_z_magn']) {
      const ch = channels.find((c) => c.ctTitle === name)!
      expect(ch.rcName).toBe(name)
      expect(ch.kind).toBe('passthrough')
    }
  })

  it('does NOT pass through a _devN-suffixed collision name — still generically allocated', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('rc_x_acc_dev300', [0.1, 0.2])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'rc_x_acc_dev300')!
    expect(ch.rcName).not.toBe('rc_x_acc_dev300')
    expect(ch.kind).not.toBe('passthrough')
  })
})

describe('buildVboCatalog — B121 RC3 digital1 = fixed RPM slot', () => {
  it('maps rc_digital_1 to rc_rpm with unit rpm', () => {
    const session = new LogSession(
      [channel('Time', [0, 100, 200]), channel('rc_digital_1', [1732, 1833, 1925])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'rc_digital_1')!
    expect(ch.rcName).toBe('rc_rpm')
    expect(ch.unit).toBe('rpm')
    expect(ch.kind).toBe('semantic')
  })
})

describe('buildVboCatalog — B123 units', () => {
  it('preserves the source unit on a generic analog channel', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('GPS_AltitudePrecision', [1.2, 2.4], 'DOP')],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'GPS_AltitudePrecision')!
    expect(ch.kind).toBe('analog')
    expect(ch.unit).toBe('DOP')
  })

  it('falls back to raw when the source has no unit', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('SomeCustomChannel', [1, 2])],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'SomeCustomChannel')!
    expect(ch.unit).toBe('raw')
  })

  it('preserves the source unit on a passthrough identifier channel', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('rc_x_acc', [0.1, 0.2], 'G')],
      META,
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'rc_x_acc')!
    expect(ch.unit).toBe('G')
  })

  it('keeps unit bool only for a channel actually classified digital, never overwriting a real unit', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100, 200, 300]),
        channel('PitSwitch', [0, 1, 0, 1]), // no unit -> classified digital, unit=bool
        channel('GPS_AltitudePrecision', [0, 1, 0, 1], 'DOP'), // has unit -> never bool
      ],
      META,
    )
    const { channels } = buildVboCatalog(session)
    expect(channels.find((c) => c.ctTitle === 'PitSwitch')!.unit).toBe('bool')
    const dop = channels.find((c) => c.ctTitle === 'GPS_AltitudePrecision')!
    expect(dop.unit).toBe('DOP')
    expect(dop.unit).not.toBe('bool')
  })

  it('keeps SEMANTIC-mapped .loga channels on their declared SI unit + scale, unaffected by B123', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('TC_Xforce', [1000, 2000])],
      { formatId: 'superX', createdDate: null, headerInfo: {} },
    )
    const { channels } = buildVboCatalog(session)
    const ch = channels.find((c) => c.ctTitle === 'TC_Xforce')!
    expect(ch.unit).toBe('g')
    expect(ch.scale).toBe(0.001)
    expect(ch.kind).toBe('semantic')
  })
})

describe('convertToVbo — B122 standard GPS columns', () => {
  /** Split a .vbo [data] section's first row into fields. */
  function firstDataRow(content: string): string[] {
    const lines = content.split('\r\n')
    return lines[lines.indexOf('[data]') + 1].split(' ')
  }
  /** [header] section as a plain array. */
  function header(content: string): string[] {
    const lines = content.split('\r\n')
    const start = lines.indexOf('[header]') + 1
    const end = lines.indexOf('', start)
    return lines.slice(start, end)
  }

  it('height/sats carry real GPS_Altitude/Satellites values, not the historical constants', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100]),
        channel('GPS_Lat', [24.897, 24.898]),
        channel('GPS_Lon', [121.267, 121.268]),
        channel('GPS_Altitude', [201.5, 202.1]),
        channel('Satellites', [5, 6]),
      ],
      META,
    )
    const ct = convertToVbo(session, 'test.rcz').find((a) => a.suffix === '_ct')!.content
    const row = firstDataRow(ct)
    // sats(0), time(1), lat(2), long(3), velocity(4), heading(5), height(6)
    expect(row[0]).toBe('005')
    expect(Number(row[6])).toBeCloseTo(201.5, 1)
  })

  it('falls back to the historical constants when the source has no GPS_Altitude/Satellites', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100]),
        channel('GPS_Lat', [24.897, 24.898]),
        channel('GPS_Lon', [121.267, 121.268]),
      ],
      META,
    )
    const ct = convertToVbo(session, 'test.rcz').find((a) => a.suffix === '_ct')!.content
    const row = firstDataRow(ct)
    expect(row[0]).toBe('012')
    expect(row[6]).toBe('+00000.00')
  })

  it('GPS_Lat/GPS_Lon are not duplicated as generic channels once consumed for lat/long', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100]),
        channel('GPS_Lat', [24.897, 24.898]),
        channel('GPS_Lon', [121.267, 121.268]),
        channel('RPM', [1000, 2000]),
      ],
      META,
    )
    const ct = convertToVbo(session, 'test.rcz').find((a) => a.suffix === '_ct')!.content
    const h = header(ct)
    // Exactly the 7 standard columns (which already include 'latitude'/
    // 'longitude') + RPM — no extra GPS_Lat/GPS_Lon entries.
    expect(h.filter((x) => x === 'GPS_Lat' || x === 'GPS_Lon')).toEqual([])
    expect(h).toHaveLength(8)
  })

  it('heading is still the smoothed lat/lon-derived course, and GPS_Course (when present) stays a separate channel', () => {
    const session = new LogSession(
      [
        channel('Time', [0, 100, 200]),
        channel('GPS_Lat', [24.897, 24.898, 24.899]),
        channel('GPS_Lon', [121.267, 121.268, 121.269]),
        channel('GPS_Course', [10, 20, 30]),
      ],
      META,
    )
    const { channels } = buildVboCatalog(session)
    expect(channels.map((c) => c.ctTitle)).toContain('GPS_Course')
  })
})

describe('convertToVbo — B126 time-of-day anchors on the first-sample epoch, not createdDate', () => {
  /** First data row's time field (HHMMSS.sss) from a _ct.vbo. */
  function firstTime(content: string): string {
    const lines = content.split('\r\n')
    return lines[lines.indexOf('[data]') + 1].split(' ')[1]
  }
  const pad = (v: number) => String(v).padStart(2, '0')
  const hms = (d: Date) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

  // Real-world B126 scenario: session.json's timeCreated (createdDate) is
  // ~6.5s BEFORE firstTimestamp (firstSampleEpochMs) — the moment RaceChrono
  // opened the session vs. the moment the first sample was actually taken.
  const createdEpochMs = Date.UTC(2025, 7, 17, 8, 21, 5, 518)
  const firstSampleEpochMs = Date.UTC(2025, 7, 17, 8, 21, 12, 23)

  it('uses firstSampleEpochMs, not createdDate, for the time-of-day base when they differ', () => {
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('RPM', [1000, 2000])],
      {
        formatId: 'rcz',
        createdDate: new Date(createdEpochMs),
        headerInfo: {},
        firstSampleEpochMs,
      },
    )
    const ct = convertToVbo(session, 'test.rcz').find((a) => a.suffix === '_ct')!.content
    expect(firstTime(ct).startsWith(hms(new Date(firstSampleEpochMs)))).toBe(true)
    // Sanity: the pre-fix (createdDate-anchored) value must NOT appear —
    // otherwise this test would pass even with the bug still present.
    expect(firstTime(ct).startsWith(hms(new Date(createdEpochMs)))).toBe(false)
  })

  it('does not change the createdDate-derived "File created on …" stamp line', () => {
    const created = new Date(createdEpochMs)
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('RPM', [1000, 2000])],
      { formatId: 'rcz', createdDate: created, headerInfo: {}, firstSampleEpochMs },
    )
    const ct = convertToVbo(session, 'test.rcz').find((a) => a.suffix === '_ct')!.content
    const stampLine = ct.split('\r\n')[0]
    expect(stampLine).toBe(
      `File created on ${pad(created.getDate())}/${pad(created.getMonth() + 1)}/` +
        `${created.getFullYear()} at ${hms(created).replace(/(\d\d)(\d\d)(\d\d)/, '$1:$2:$3')}`,
    )
  })

  it('falls back to createdDate when firstSampleEpochMs is absent (non-.rcz formats unaffected)', () => {
    const created = new Date(2026, 5, 21, 16, 25, 24)
    const session = new LogSession(
      [channel('Time', [0, 100]), channel('RPM', [1000, 2000])],
      { formatId: 'superX', createdDate: created, headerInfo: {} },
    )
    const ct = convertToVbo(session, 'test.loga').find((a) => a.suffix === '_ct')!.content
    expect(firstTime(ct).startsWith(hms(created))).toBe(true)
  })
})
