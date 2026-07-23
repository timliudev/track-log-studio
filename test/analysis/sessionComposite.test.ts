import { describe, it, expect } from 'vitest'
import { buildCompositeSession, DEFAULT_MONOTONIC_COUNTER_CHANNELS } from '@/domain/analysis/sessionComposite'
import { detectLapsByChannel } from '@/domain/analysis/laps'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, data: number[], unit?: string): Channel {
  return { name, rawName: name, description: undefined, unit, data: new Float32Array(data) }
}

/** An .rcnx-shaped segment: Time (ms, starts at 0), GPS_Speed, optional
 *  IR_LapNumber, with a wall-clock `createdDate` — same shape parseRcnx.ts
 *  produces. */
function makeSegment(opts: {
  timeMs: number[]
  speed: number[]
  lapNumber?: number[]
  createdDateMs?: number | null
  extra?: Channel[]
}): LogSession {
  const channels: Channel[] = [channel('Time', opts.timeMs, 'ms'), channel('GPS_Speed', opts.speed, 'km/h')]
  if (opts.lapNumber) channels.push(channel('IR_LapNumber', opts.lapNumber))
  if (opts.extra) channels.push(...opts.extra)
  return new LogSession(channels, {
    formatId: 'rcnx',
    createdDate: opts.createdDateMs === undefined ? new Date(0) : opts.createdDateMs === null ? null : new Date(opts.createdDateMs),
    headerInfo: {},
  })
}

describe('buildCompositeSession', () => {
  it('returns null for an empty segment list', () => {
    expect(buildCompositeSession([])).toBeNull()
  })

  it('returns null if a segment has no time channel or zero rows', () => {
    const noTime = new LogSession([channel('GPS_Speed', [1, 2])], { formatId: 'rcnx', createdDate: null, headerInfo: {} })
    const ok = makeSegment({ timeMs: [0, 1000], speed: [1, 2] })
    expect(buildCompositeSession([noTime, ok])).toBeNull()

    const emptyTime = new LogSession([channel('Time', []), channel('GPS_Speed', [])], {
      formatId: 'rcnx',
      createdDate: null,
      headerInfo: {},
    })
    expect(buildCompositeSession([ok, emptyTime])).toBeNull()
  })

  it('concatenates channel lengths (union+concat, no resampling)', () => {
    const a = makeSegment({ timeMs: [0, 1000, 2000], speed: [10, 20, 30], createdDateMs: 1_000_000 })
    const b = makeSegment({ timeMs: [0, 1000], speed: [40, 50], createdDateMs: 1_010_000 })

    const result = buildCompositeSession([a, b])!
    expect(result).not.toBeNull()
    expect(result.segmentRowCounts).toEqual([3, 2])

    const byName = new Map(result.channels.map((c) => [c.name, c]))
    expect(byName.get('Time')!.data.length).toBe(5)
    expect(byName.get('GPS_Speed')!.data.length).toBe(5)
    expect([...byName.get('GPS_Speed')!.data]).toEqual([10, 20, 30, 40, 50])
  })

  it('preserves the real wall-clock gap between segments (not naive concatenation)', () => {
    // Segment A: 3s long, starting at t=0 wall-clock ms.
    // Segment B starts 10s after segment A's wall-clock start (a real gap,
    // e.g. a pit stop between two recorded sessions), lasting 2s.
    const a = makeSegment({ timeMs: [0, 1000, 3000], speed: [1, 2, 3], createdDateMs: 0 })
    const b = makeSegment({ timeMs: [0, 2000], speed: [4, 5], createdDateMs: 10_000 })

    const result = buildCompositeSession([a, b])!
    const time = [...result.channels.find((c) => c.name === 'Time')!.data]

    // Segment A unchanged (anchored at its own start = composite start).
    expect(time.slice(0, 3)).toEqual([0, 1000, 3000])
    // Segment B starts exactly at its wall-clock offset (10_000 ms), not
    // immediately after A's last sample (3000 ms) — the 7s gap survives.
    expect(time[3]).toBe(10_000)
    expect(time[4]).toBe(12_000)
  })

  it('falls back to zero-gap append when a segment has no wall-clock metadata', () => {
    const a = makeSegment({ timeMs: [0, 1000], speed: [1, 2], createdDateMs: null })
    const b = makeSegment({ timeMs: [0, 500, 1500], speed: [3, 4, 5], createdDateMs: null })

    const result = buildCompositeSession([a, b])!
    const time = [...result.channels.find((c) => c.name === 'Time')!.data]
    // a unchanged, b appended immediately after a's last sample (1000).
    expect(time).toEqual([0, 1000, 1000, 1500, 2500])
  })

  it('pads a channel missing from one segment with NaN rather than intersecting it away', () => {
    const a = makeSegment({
      timeMs: [0, 1000],
      speed: [1, 2],
      createdDateMs: 0,
      extra: [channel('GPS_Altitude', [100, 101], 'm')],
    })
    const b = makeSegment({ timeMs: [0, 1000], speed: [3, 4], createdDateMs: 5000 })

    const result = buildCompositeSession([a, b])!
    const alt = result.channels.find((c) => c.name === 'GPS_Altitude')!
    expect([...alt.data].slice(0, 2)).toEqual([100, 101])
    expect(Number.isNaN(alt.data[2])).toBe(true)
    expect(Number.isNaN(alt.data[3])).toBe(true)
    // GPS_Speed present in both, no NaN padding needed.
    expect([...result.channels.find((c) => c.name === 'GPS_Speed')!.data]).toEqual([1, 2, 3, 4])
  })

  it('offsets IR_LapNumber by a running total so the counter keeps climbing across the seam', () => {
    // Segment A: 2 laps + trailing out-lap plateau (parseRcnx's own convention
    // — see buildLapNumberChannel doc): 0,1,1,2,2,3 (lap0 prelap, lap1, lap2,
    // out-lap=3).
    const a = makeSegment({ timeMs: [0, 100, 200, 300, 400, 500], speed: [1, 2, 3, 4, 5, 6], lapNumber: [0, 1, 1, 2, 2, 3], createdDateMs: 0 })
    // Segment B restarts its OWN counter from 0 (a fresh parse of the next
    // session): 0,1,1,2 (prelap, lap1, out-lap=2).
    const b = makeSegment({ timeMs: [0, 100, 200, 300], speed: [7, 8, 9, 10], lapNumber: [0, 1, 1, 2], createdDateMs: 10_000 })

    const result = buildCompositeSession([a, b])!
    const lap = [...result.channels.find((c) => c.name === 'IR_LapNumber')!.data]

    // A's own values pass through unchanged (running offset starts at 0).
    expect(lap.slice(0, 6)).toEqual([0, 1, 1, 2, 2, 3])
    // B's values are offset by A's max (3): 0+3, 1+3, 1+3, 2+3.
    expect(lap.slice(6)).toEqual([3, 4, 4, 5])

    // Never decreases across the seam (the property detectLapsByChannel relies on).
    for (let i = 1; i < lap.length; i++) expect(lap[i]).toBeGreaterThanOrEqual(lap[i - 1])
  })

  it('carries the lap-counter offset forward across a middle segment with no lap data', () => {
    const a = makeSegment({ timeMs: [0, 100, 200], speed: [1, 2, 3], lapNumber: [0, 1, 2], createdDateMs: 0 })
    // No lap data at all in the middle segment.
    const middle = makeSegment({ timeMs: [0, 100], speed: [4, 5], createdDateMs: 1000 })
    const c = makeSegment({ timeMs: [0, 100, 200], speed: [6, 7, 8], lapNumber: [0, 1, 2], createdDateMs: 2000 })

    const result = buildCompositeSession([a, middle, c])!
    const lap = [...result.channels.find((c) => c.name === 'IR_LapNumber')!.data]

    expect(lap.slice(0, 3)).toEqual([0, 1, 2])
    expect(Number.isNaN(lap[3])).toBe(true)
    expect(Number.isNaN(lap[4])).toBe(true)
    // c's counter continues from a's max (2), NOT reset to 0 — the gap in the
    // middle must not erase the running offset.
    expect(lap.slice(5)).toEqual([2, 3, 4])
  })

  it('detectLapsByChannel recovers laps from BOTH segments across the composite seam', () => {
    // Segment A: 2 complete laps (finish at idx 3 and 5) + trailing out-lap.
    const a = makeSegment({
      timeMs: [0, 100, 200, 300, 400, 500],
      speed: [1, 2, 3, 4, 5, 6],
      lapNumber: [0, 1, 1, 2, 2, 3],
      createdDateMs: 0,
    })
    // Segment B: 1 complete lap (finish at idx 2, own indices) + trailing out-lap.
    const b = makeSegment({
      timeMs: [0, 100, 200, 300],
      speed: [7, 8, 9, 10],
      lapNumber: [0, 1, 1, 2],
      createdDateMs: 100_000,
    })

    const result = buildCompositeSession([a, b])!
    const composite = new LogSession(result.channels, { formatId: 'rcnx', createdDate: null, headerInfo: {} })
    const timeMs = new Float64Array(composite.timeChannel!.data)

    const laps = detectLapsByChannel(composite, timeMs)
    // A's 2 real laps + B's 1 real lap are ALL recovered (nothing lost at the
    // seam, the property this module guarantees) — PLUS one harmless
    // "connector" interval spanning the seam itself (see module doc: pairing
    // consecutive boundaries is inherent to detectLapsByChannel and has no
    // concept of segments, so segment A's own trailing out-lap boundary pairs
    // with segment B's own first lap-start boundary into one extra interval).
    expect(laps).toHaveLength(4)
    expect(laps[0]).toMatchObject({ startIdx: 1, endIdx: 3 }) // A's lap 1
    expect(laps[1]).toMatchObject({ startIdx: 3, endIdx: 5 }) // A's lap 2
    // The connector straddles the segment seam (A occupies rows [0,6)).
    expect(laps[2].startIdx).toBeLessThan(result.segmentRowCounts[0])
    expect(laps[2].endIdx).toBeGreaterThanOrEqual(result.segmentRowCounts[0])
    expect(laps[3]).toMatchObject({ startIdx: 7, endIdx: 9 }) // B's lap 1, translated into composite indices
  })

  it('default monotonicCounterChannels is exactly IR_LapNumber', () => {
    expect(DEFAULT_MONOTONIC_COUNTER_CHANNELS).toEqual(['IR_LapNumber'])
  })

  it('respects a custom monotonicCounterChannels list', () => {
    const a = makeSegment({ timeMs: [0, 100], speed: [1, 2], createdDateMs: 0, extra: [channel('MyCounter', [0, 1])] })
    const b = makeSegment({ timeMs: [0, 100], speed: [3, 4], createdDateMs: 1000, extra: [channel('MyCounter', [0, 1])] })

    const result = buildCompositeSession([a, b], { monotonicCounterChannels: ['MyCounter'] })!
    const counter = [...result.channels.find((c) => c.name === 'MyCounter')!.data]
    expect(counter).toEqual([0, 1, 1, 2])
  })
})
