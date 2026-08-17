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
