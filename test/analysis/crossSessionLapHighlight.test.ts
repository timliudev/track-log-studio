import { describe, expect, it } from 'vitest'
import {
  buildComparisonLapHighlights,
  type ComparisonLapHighlightSource,
} from '@/domain/analysis/crossSessionLapHighlight'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

function track(n: number): GpsTrack {
  return {
    lat: Float64Array.from({ length: n }, (_v, i) => i),
    lon: Float64Array.from({ length: n }, (_v, i) => i),
    valid: Uint8Array.from({ length: n }, () => 1),
  }
}

describe('buildComparisonLapHighlights', () => {
  const sessionA: ComparisonLapHighlightSource = {
    id: 2,
    color: '#f00',
    track: track(30),
    laps: [
      { index: 0, startIdx: 0, endIdx: 9 },
      { index: 1, startIdx: 10, endIdx: 19 },
    ],
    offset: { x: 1.5, y: -2 },
  }
  const sessionB: ComparisonLapHighlightSource = {
    id: 3,
    color: '#0f0',
    track: track(15),
    laps: [{ index: 0, startIdx: 0, endIdx: 14 }],
  }

  it('resolves each cross-file ref to its own session track, span, color and offset', () => {
    const out = buildComparisonLapHighlights(
      [
        { fileId: 2, index: 1 },
        { fileId: 3, index: 0 },
      ],
      [sessionA, sessionB],
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ startIdx: 10, endIdx: 19, color: '#f00', offset: { x: 1.5, y: -2 } })
    expect(out[0].track).toBe(sessionA.track)
    expect(out[1]).toMatchObject({ startIdx: 0, endIdx: 14, color: '#0f0' })
    expect(out[1].offset).toBeUndefined()
  })

  it('preserves selection order (so highlight order is stable, not resorted by fileId)', () => {
    const out = buildComparisonLapHighlights(
      [
        { fileId: 3, index: 0 },
        { fileId: 2, index: 0 },
      ],
      [sessionA, sessionB],
    )
    expect(out.map((h) => h.color)).toEqual(['#0f0', '#f00'])
  })

  it('drops a ref whose session is not currently a comparison source', () => {
    const out = buildComparisonLapHighlights([{ fileId: 99, index: 0 }], [sessionA, sessionB])
    expect(out).toEqual([])
  })

  it('drops a ref whose lap index no longer exists in that session (removed / re-detected laps)', () => {
    const out = buildComparisonLapHighlights([{ fileId: 2, index: 5 }], [sessionA, sessionB])
    expect(out).toEqual([])
  })

  it('returns an empty array for an empty selection', () => {
    expect(buildComparisonLapHighlights([], [sessionA, sessionB])).toEqual([])
  })
})
