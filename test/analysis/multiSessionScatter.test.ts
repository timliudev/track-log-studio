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
})
