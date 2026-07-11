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

  it('keeps third-channel values aligned for hover without replacing session colours', () => {
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
      { points: [[1, 3], [2, 4]], tooltipValues: [5000, 6000], color: '#a00', name: 'A' },
      { points: [[5, 7], [6, 8]], tooltipValues: [7000, 8000], color: '#0a0', name: 'B' },
    ])
  })

  it('keeps a compatible session visible when it lacks the optional hover channel', () => {
    const result = buildMultiSessionScatter(
      [{ id: 1, name: 'A', color: '#a00', session: session({ X: [1], Y: [2] }) }],
      'X',
      'Y',
      5000,
      'RPM',
    )

    expect(result).toEqual([{ points: [[1, 2]], color: '#a00', name: 'A' }])
  })
})
