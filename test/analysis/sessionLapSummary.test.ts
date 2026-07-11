import { describe, expect, it } from 'vitest'
import {
  buildComparisonLapRows,
  buildSessionLapSummaries,
  fastestLapTime,
} from '@/domain/analysis/sessionLapSummary'
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

describe('comparison lap rows', () => {
  it('flags fastest/slowest and derives per-lap distance from the track', () => {
    // cum distance grows 100 m per sample; each lap spans 9 samples ⇒ 900 m.
    const cumDistM = Float64Array.from({ length: 30 }, (_v, i) => i * 100)
    const rows = buildComparisonLapRows(
      [lap(0, 62000), lap(1, 60000), lap(2, 64000)],
      { session: null, cumDistM },
    )
    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({ index: 1, isFastest: true, isSlowest: false })
    expect(rows[2]).toMatchObject({ index: 2, isFastest: false, isSlowest: true })
    expect(rows[0]).toMatchObject({ isFastest: false, isSlowest: false })
    expect(rows[0].distanceM).toBeCloseTo(900)
    expect(rows[0].cells).toEqual([])
  })

  it('suppresses the slowest marker when a single lap is both fastest and slowest', () => {
    const rows = buildComparisonLapRows([lap(0, 61000)], { session: null, cumDistM: null })
    expect(rows[0]).toMatchObject({ isFastest: true, isSlowest: false })
    expect(Number.isNaN(rows[0].distanceM)).toBe(true)
  })

  it('marks no lap when none has a valid time', () => {
    const rows = buildComparisonLapRows([lap(0, 0), lap(1, NaN)], { session: null, cumDistM: null })
    expect(rows.every((r) => !r.isFastest && !r.isSlowest)).toBe(true)
  })

  it('computes one cell per configured metric via computeMetric, aligned to the metrics list', () => {
    const cumDistM = Float64Array.from({ length: 20 }, (_v, i) => i * 100)
    const rows = buildComparisonLapRows(
      [lap(0, 62000), lap(1, 60000)],
      { session: null, cumDistM, bestLapTimeMs: 60000 },
      [{ kind: 'distance' }, { kind: 'delta' }, { kind: 'sectorTime', sector: 0 }],
    )
    // distance cell matches the row's own distanceM (same computeMetric path).
    expect(rows[0].cells[0]).toBeCloseTo(rows[0].distanceM)
    // delta cell: lap 0 is 2000ms slower than the 60000ms best.
    expect(rows[0].cells[1]).toBe(2000)
    expect(rows[1].cells[1]).toBe(0)
    // sectorTime cell: no sectorTimings supplied ⇒ NaN (degrades to '—' in the UI).
    expect(Number.isNaN(rows[0].cells[2])).toBe(true)
  })
})
