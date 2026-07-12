import { describe, expect, it } from 'vitest'
import { buildMultiSessionScatter } from '@/domain/analysis/multiSessionScatter'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function session(channels: Record<string, number[]>): LogSession {
  const list: Channel[] = Object.entries(channels).map(([name, values]) => ({
    name,
    rawName: name,
    description: undefined,
    data: new Float32Array(values),
  }))
  return new LogSession(list, { formatId: 'nmea', createdDate: null, headerInfo: {} })
}

describe('buildMultiSessionScatter', () => {
  it('builds one bounded, identity-coloured cloud per compatible session', () => {
    const result = buildMultiSessionScatter([
      { id: 1, name: 'A', color: '#a00', session: session({ X: [1, 2, 3], Y: [4, 5, 6] }) },
      { id: 2, name: 'B', color: '#0a0', session: session({ X: [7, 8, 9], Y: [1, 2, 3] }) },
      { id: 3, name: 'missing', color: '#00a', session: session({ X: [1] }) },
    ], 'X', 'Y', 2)

    expect(result.map(({ name, color }) => ({ name, color }))).toEqual([
      { name: 'A', color: '#a00' },
      { name: 'B', color: '#0a0' },
    ])
    expect(result.every((series) => series.points.length <= 2)).toBe(true)
  })

  // B25 — a distinct marker shape identifies each file, by its POSITION in
  // `sources` (matching FileBar/the comparison list's order), regardless of
  // whether an earlier source was skipped for a missing channel pair.
  it('assigns a stable marker shape per source position', () => {
    const result = buildMultiSessionScatter([
      { id: 5, name: 'A', color: '#a00', session: session({ X: [1], Y: [2] }) },
      { id: 9, name: 'missing', color: '#00a', session: session({ X: [1] }) },
      { id: 2, name: 'C', color: '#0a0', session: session({ X: [3], Y: [4] }) },
    ], 'X', 'Y')

    expect(result.map(({ name, symbol }) => ({ name, symbol }))).toEqual([
      { name: 'A', symbol: 'circle' },
      { name: 'C', symbol: 'rect' },
    ])
  })

  // B25 — once a colour-axis channel is picked, hue goes ENTIRELY to that
  // channel's gradient (colorValues) for every session, not just the tooltip;
  // file identity is then carried by `symbol` alone, not `color`.
  it('routes the third channel to the shared colour axis (not just the tooltip) when picked', () => {
    const result = buildMultiSessionScatter(
      [
        {
          id: 1,
          name: 'A',
          color: '#a00',
          session: session({ X: [1, 2], Y: [3, 4], RPM: [5000, 6000] }),
        },
        {
          id: 2,
          name: 'B',
          color: '#0a0',
          session: session({ X: [5, 6], Y: [7, 8], RPM: [7000, 8000] }),
        },
      ],
      'X',
      'Y',
      5000,
      'RPM',
    )

    expect(result).toEqual([
      { points: [[1, 3], [2, 4]], colorValues: [5000, 6000], color: '#a00', name: 'A', symbol: 'circle' },
      { points: [[5, 7], [6, 8]], colorValues: [7000, 8000], color: '#0a0', name: 'B', symbol: 'triangle' },
    ])
  })

  it('keeps a compatible session visible when it lacks the optional colour channel', () => {
    const result = buildMultiSessionScatter(
      [{ id: 1, name: 'A', color: '#a00', session: session({ X: [1], Y: [2] }) }],
      'X',
      'Y',
      5000,
      'RPM',
    )

    expect(result).toEqual([{ points: [[1, 2]], color: '#a00', name: 'A', symbol: 'circle' }])
  })
})
