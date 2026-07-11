import { describe, expect, it } from 'vitest'
import { buildSessionLapSummaries, fastestLapTime } from '@/domain/analysis/sessionLapSummary'
import type { Lap } from '@/domain/model/Lap'

const lap = (index: number, lapTimeMs: number): Lap => ({ index, lapTimeMs, startIdx: index * 10, endIdx: index * 10 + 9 })

describe('session lap summaries', () => {
  it('honours primary exclusions and computes signed deltas', () => {
    const primary = [lap(0, 60000), lap(1, 61000)]
    const result = buildSessionLapSummaries(primary, [0], [
      { id: 2, name: 'faster', color: '#f00', laps: [lap(0, 60500), lap(1, 62000)] },
      { id: 3, name: 'empty', color: '#0f0', laps: [] },
    ])
    expect(fastestLapTime(primary, [0])).toBe(61000)
    expect(result[0]).toMatchObject({ fastestMs: 60500, deltaMs: -500, lapCount: 2 })
    expect(result[1]).toMatchObject({ fastestMs: null, deltaMs: null, lapCount: 0 })
  })
})
