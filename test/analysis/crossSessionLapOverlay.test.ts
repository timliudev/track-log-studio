import { describe, expect, it } from 'vitest'
import { buildCrossSessionLapOverlay } from '@/domain/analysis/crossSessionLapOverlay'

describe('buildCrossSessionLapOverlay', () => {
  it('rebases laps from separate session axes and preserves session identity', () => {
    const result = buildCrossSessionLapOverlay([
      {
        fileId: 1, sessionName: 'A', color: '#a00', xValues: [10, 11, 12],
        channels: [{ name: 'RPM', data: [100, 200, 300] }],
        lap: { index: 0, startIdx: 0, endIdx: 2, lapTimeMs: 2000 },
      },
      {
        fileId: 2, sessionName: 'B', color: '#0a0', xValues: [30, 31, 32],
        channels: [{ name: 'RPM', data: [400, 500, 600] }],
        lap: { index: 3, startIdx: 0, endIdx: 2, lapTimeMs: 2000 },
      },
    ], 3)
    expect(Array.from(result.x)).toEqual([0, 1, 2])
    expect(result.series.map((series) => [series.fileId, series.lap.index, Array.from(series.y)])).toEqual([
      [1, 0, [100, 200, 300]],
      [2, 3, [400, 500, 600]],
    ])
  })
})
