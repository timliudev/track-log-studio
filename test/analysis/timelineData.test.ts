import { describe, expect, it } from 'vitest'
import { buildTimelineData, nearestXIndex, type TimelineSource } from '@/domain/analysis/timelineData'

function source(
  id: number,
  x: number[],
  channels: Record<string, number[]>,
  primary = false,
): TimelineSource {
  return {
    id,
    label: `session-${id}`,
    color: `color-${id}`,
    primary,
    xValues: x,
    channels: new Map(Object.entries(channels)),
  }
}

describe('buildTimelineData', () => {
  it('joins independent session axes and leaves missing samples as uPlot gaps', () => {
    const result = buildTimelineData([
      source(1, [0, 1, 2], { RPM: [10, 20, 30] }, true),
      source(2, [0.5, 1.5], { RPM: [15, 25] }),
    ], ['RPM'], null, 100)

    expect(result.data).toEqual([
      [0, 0.5, 1, 1.5, 2],
      [10, null, 20, null, 30],
      [null, 15, null, 25, null],
    ])
    expect(result.series.map((entry) => [entry.sourceId, entry.channel, entry.sourceOrder])).toEqual([
      [1, 'RPM', 0],
      [2, 'RPM', 1],
    ])
  })

  it('silently skips a channel absent from one comparison session', () => {
    const result = buildTimelineData([
      source(1, [0, 1], { RPM: [1, 2], TPS: [3, 4] }, true),
      source(2, [0, 1], { RPM: [5, 6] }),
    ], ['RPM', 'TPS'], null, 100)
    expect(result.series.map((entry) => `${entry.sourceId}:${entry.channel}`)).toEqual([
      '1:RPM', '1:TPS', '2:RPM',
    ])
  })

  it('crops to the visible range before bounding every raw series with LTTB', () => {
    const x = Array.from({ length: 10_000 }, (_, i) => i)
    const y = x.map((value) => Math.sin(value / 10))
    const result = buildTimelineData([
      source(1, x, { RPM: y }, true),
      source(2, x, { RPM: y }),
    ], ['RPM'], { min: 2000, max: 8000 }, 400)

    expect(result.data[1].filter((value) => value != null)).toHaveLength(400)
    expect(result.data[2].filter((value) => value != null)).toHaveLength(400)
    expect(result.data[0][0]).toBeGreaterThanOrEqual(1999)
    expect(result.data[0].at(-1)).toBeLessThanOrEqual(8001)
  })

  it('converts non-finite telemetry samples to gaps', () => {
    const result = buildTimelineData([
      source(1, [0, 1, 2], { RPM: [1, Number.NaN, 3] }, true),
    ], ['RPM'], null, 100)
    expect(result.data[1]).toEqual([1, null, 3])
  })
})

describe('nearestXIndex', () => {
  it('finds the closest full-resolution sample around either edge', () => {
    expect(nearestXIndex([0, 2, 4], -1)).toBe(0)
    expect(nearestXIndex([0, 2, 4], 3.4)).toBe(2)
    expect(nearestXIndex([0, 2, 4], 10)).toBe(2)
    expect(nearestXIndex([], 1)).toBeNull()
  })
})
