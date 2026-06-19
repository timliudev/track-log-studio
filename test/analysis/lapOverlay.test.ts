import { describe, it, expect } from 'vitest'
import { buildLapOverlay } from '@/domain/analysis/lapOverlay'
import type { Lap } from '@/domain/model/Lap'

// x = 0,10,...,60 (works the same whether it's distance-m or time-ms)
const X = new Float64Array([0, 10, 20, 30, 40, 50, 60])
// value == sample index, so resampled values are easy to reason about
const CH = new Float64Array([0, 1, 2, 3, 4, 5, 6])

const lapA: Lap = { index: 0, startIdx: 0, endIdx: 2, lapTimeMs: 1 } // rel 0..20
const lapB: Lap = { index: 1, startIdx: 3, endIdx: 6, lapTimeMs: 1 } // rel 0..30

describe('buildLapOverlay', () => {
  it('shares one grid 0..maxRel across laps of different lengths', () => {
    const r = buildLapOverlay({
      xValues: X,
      channels: [{ name: 'v', data: CH }],
      laps: [lapA, lapB],
      gridPoints: 4,
    })
    // maxRel = lapB extent = 30; 4 even points
    expect(Array.from(r.x)).toEqual([0, 10, 20, 30])
    expect(r.series).toHaveLength(2) // 1 channel × 2 laps
  })

  it('re-bases each lap to X=0 and resamples its channel onto the grid', () => {
    const r = buildLapOverlay({
      xValues: X,
      channels: [{ name: 'v', data: CH }],
      laps: [lapA, lapB],
      gridPoints: 4,
    })
    const [a, b] = r.series
    expect(a.lapOrder).toBe(0)
    expect(a.channelIndex).toBe(0)
    // lapA covers rel 0..20 → values 0,1,2 then NaN past its own extent
    expect(a.y[0]).toBe(0)
    expect(a.y[1]).toBe(1)
    expect(a.y[2]).toBe(2)
    expect(Number.isNaN(a.y[3])).toBe(true)
    // lapB (idx 3..6) re-based: 3,4,5,6 across the full grid
    expect(Array.from(b.y)).toEqual([3, 4, 5, 6])
  })

  it('linearly interpolates between samples at off-grid distances', () => {
    const r = buildLapOverlay({
      xValues: X,
      channels: [{ name: 'v', data: CH }],
      laps: [lapA],
      gridPoints: 5, // maxRel = lapA extent 20 → grid 0,5,10,15,20
    })
    const y = r.series[0].y
    expect(y[0]).toBeCloseTo(0) // rel 0 → v0
    expect(y[1]).toBeCloseTo(0.5) // rel 5, halfway between v=0 and v=1
    expect(y[2]).toBeCloseTo(1) // rel 10 → v1
    expect(y[3]).toBeCloseTo(1.5) // rel 15, halfway between v=1 and v=2
    expect(y[4]).toBeCloseTo(2) // rel 20 → v2 (lap end)
  })

  it('skips non-finite source samples and interpolates across the gap', () => {
    const gappy = new Float64Array([0, NaN, 2, 0, 0, 0, 0])
    const r = buildLapOverlay({
      xValues: X,
      channels: [{ name: 'v', data: gappy }],
      laps: [lapA],
      gridPoints: 3, // grid 0,10,20
    })
    const y = r.series[0].y
    // sample at rel10 is NaN → interpolated between rel0(v0=0) and rel20(v2=2)
    expect(y[0]).toBe(0)
    expect(y[1]).toBeCloseTo(1)
    expect(y[2]).toBe(2)
  })

  it('produces one series per (channel, lap), lap-outer / channel-inner', () => {
    const r = buildLapOverlay({
      xValues: X,
      channels: [
        { name: 'a', data: CH },
        { name: 'b', data: CH },
      ],
      laps: [lapA, lapB],
      gridPoints: 4,
    })
    expect(r.series).toHaveLength(4)
    expect(r.series.map((s) => [s.lapOrder, s.channelIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ])
  })

  it('returns an empty result for no laps or no channels', () => {
    expect(buildLapOverlay({ xValues: X, channels: [{ name: 'v', data: CH }], laps: [] })).toEqual({
      x: new Float64Array(0),
      series: [],
    })
    expect(buildLapOverlay({ xValues: X, channels: [], laps: [lapA] })).toEqual({
      x: new Float64Array(0),
      series: [],
    })
  })
})
