import { describe, expect, it } from 'vitest'
import {
  buildMultiSessionScatter,
  buildMultiSessionScatterLaps,
  resolveComparisonLapPicks,
} from '@/domain/analysis/multiSessionScatter'
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

// B57 — regression coverage for the "圈次表選了圈之後，散佈圖沒有跟著切圈"
// bug: multi-session comparison mode used to always plot the WHOLE session
// for every source, silently ignoring any lap selection (ScatterChart.vue's
// ggSeries called buildMultiSessionScatter unconditionally whenever
// comparisonSessions was non-empty). buildMultiSessionScatterLaps is the
// lap-aware replacement path.
describe('buildMultiSessionScatterLaps', () => {
  it('clips each source to its own selected lap range instead of the whole session', () => {
    const result = buildMultiSessionScatterLaps(
      [
        { id: 1, name: 'A', color: '#a00', session: session({ X: [1, 2, 3, 4], Y: [10, 20, 30, 40] }) },
        { id: 2, name: 'B', color: '#0a0', session: session({ X: [5, 6, 7, 8], Y: [50, 60, 70, 80] }) },
      ],
      [
        { sourceId: 1, index: 0, startIdx: 1, endIdx: 3 },
        { sourceId: 2, index: 2, startIdx: 0, endIdx: 2 },
      ],
      'X',
      'Y',
    )

    expect(result).toEqual([
      { points: [[2, 20], [3, 30]], color: '#a00', name: 'A · #1', symbol: 'circle' },
      { points: [[5, 50], [6, 60]], color: '#0a0', name: 'B · #3', symbol: 'triangle' },
    ])
  })

  it('draws one clipped series per lap when a source has multiple selected laps', () => {
    const result = buildMultiSessionScatterLaps(
      [{ id: 1, name: 'A', color: '#a00', session: session({ X: [1, 2, 3, 4, 5, 6], Y: [1, 2, 3, 4, 5, 6] }) }],
      [
        { sourceId: 1, index: 0, startIdx: 0, endIdx: 2 },
        { sourceId: 1, index: 1, startIdx: 3, endIdx: 6 },
      ],
      'X',
      'Y',
    )

    expect(result.map((s) => s.name)).toEqual(['A · #1', 'A · #2'])
    expect(result[0].points).toEqual([[1, 1], [2, 2]])
    expect(result[1].points).toEqual([[4, 4], [5, 5], [6, 6]])
    // Same session → same colour for both laps (hue stays file identity, not lap order).
    expect(result[0].color).toBe('#a00')
    expect(result[1].color).toBe('#a00')
  })

  it('omits a source entirely when it has no lap in the pick list (no whole-session fallback per source)', () => {
    const result = buildMultiSessionScatterLaps(
      [
        { id: 1, name: 'A', color: '#a00', session: session({ X: [1, 2], Y: [1, 2] }) },
        { id: 2, name: 'B', color: '#0a0', session: session({ X: [3, 4], Y: [3, 4] }) },
      ],
      [{ sourceId: 1, index: 0, startIdx: 0, endIdx: 2 }],
      'X',
      'Y',
    )

    expect(result.map((s) => s.name)).toEqual(['A · #1'])
  })

  it('routes the third channel to the colour axis within the clipped range', () => {
    const result = buildMultiSessionScatterLaps(
      [{ id: 1, name: 'A', color: '#a00', session: session({ X: [1, 2, 3], Y: [1, 2, 3], RPM: [100, 200, 300] }) }],
      [{ sourceId: 1, index: 0, startIdx: 1, endIdx: 3 }],
      'X',
      'Y',
      5000,
      'RPM',
    )

    expect(result).toEqual([
      { points: [[2, 2], [3, 3]], colorValues: [200, 300], color: '#a00', name: 'A · #1', symbol: 'circle' },
    ])
  })
})

describe('resolveComparisonLapPicks', () => {
  it('carries the primary laps through unchanged', () => {
    const picks = resolveComparisonLapPicks(
      1,
      [{ index: 0, startIdx: 10, endIdx: 20 }, { index: 2, startIdx: 40, endIdx: 60 }],
      [],
      [],
    )
    expect(picks).toEqual([
      { sourceId: 1, index: 0, startIdx: 10, endIdx: 20 },
      { sourceId: 1, index: 2, startIdx: 40, endIdx: 60 },
    ])
  })

  it('resolves a cross-session ref to that file’s own lap range', () => {
    const picks = resolveComparisonLapPicks(
      1,
      [],
      [{ fileId: 2, index: 1 }],
      [{ id: 2, laps: [{ index: 0, startIdx: 0, endIdx: 5 }, { index: 1, startIdx: 5, endIdx: 12 }] }],
    )
    expect(picks).toEqual([{ sourceId: 2, index: 1, startIdx: 5, endIdx: 12 }])
  })

  it('drops a stale cross-session ref whose file is no longer a comparison', () => {
    const picks = resolveComparisonLapPicks(1, [], [{ fileId: 9, index: 0 }], [
      { id: 2, laps: [{ index: 0, startIdx: 0, endIdx: 5 }] },
    ])
    expect(picks).toEqual([])
  })

  it('drops a stale cross-session ref whose lap index no longer exists on that file', () => {
    const picks = resolveComparisonLapPicks(1, [], [{ fileId: 2, index: 5 }], [
      { id: 2, laps: [{ index: 0, startIdx: 0, endIdx: 5 }] },
    ])
    expect(picks).toEqual([])
  })

  it('returns an empty list when nothing is selected anywhere — the caller\'s cue to fall back to whole-session plotting', () => {
    const picks = resolveComparisonLapPicks(1, [], [], [{ id: 2, laps: [] }])
    expect(picks).toEqual([])
  })

  it('merges primary and cross-session picks in order', () => {
    const picks = resolveComparisonLapPicks(
      1,
      [{ index: 0, startIdx: 0, endIdx: 10 }],
      [{ fileId: 2, index: 0 }],
      [{ id: 2, laps: [{ index: 0, startIdx: 0, endIdx: 8 }] }],
    )
    expect(picks).toEqual([
      { sourceId: 1, index: 0, startIdx: 0, endIdx: 10 },
      { sourceId: 2, index: 0, startIdx: 0, endIdx: 8 },
    ])
  })
})
