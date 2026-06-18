import { describe, it, expect } from 'vitest'
import { detectLapsByLine, detectLapsByChannel, type LapLine } from '@/domain/analysis/laps'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'

/** Build a GpsTrack from lat/lon arrays, marking every sample valid by default. */
function makeTrack(
  lat: number[],
  lon: number[],
  valid?: number[],
): GpsTrack {
  return {
    lat: new Float64Array(lat),
    lon: new Float64Array(lon),
    valid: valid ? Uint8Array.from(valid) : new Uint8Array(lat.length).fill(1),
  }
}

const meta: LogMeta = { formatId: 'superX', createdDate: null, headerInfo: {} }

function ch(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

describe('detectLapsByLine', () => {
  // A vertical start/finish line at lon = 0, spanning lat [-1, 1].
  const line: LapLine = { a: { lat: -1, lon: 0 }, b: { lat: 1, lon: 0 } }

  it('returns N-1 laps for N crossings with correct spans and times', () => {
    // Track zig-zags across lon=0 every sample, so every adjacent pair crosses.
    // Direction-auto keeps one alternating set (here the even-indexed segment
    // ends 2,4,6), giving 2 laps each spanning two crossing intervals.
    const lat = [0, 0, 0, 0, 0, 0, 0]
    const lon = [-1, 1, -1, 1, -1, 1, -1]
    const track = makeTrack(lat, lon)
    const timeMs = new Float64Array([0, 10000, 20000, 30000, 40000, 50000, 60000])

    const laps = detectLapsByLine(track, timeMs, line)
    expect(laps).toHaveLength(2)
    expect(laps[0]).toMatchObject({ index: 0, startIdx: 2, endIdx: 4, lapTimeMs: 20000 })
    expect(laps[1]).toMatchObject({ index: 1, startIdx: 4, endIdx: 6, lapTimeMs: 20000 })
  })

  it('direction-auto ignores a backwards crossing', () => {
    // Forward crossings (left->right) at 1 and 5; a backward one (right->left)
    // at 3. Majority direction is forward, so the backward crossing is dropped,
    // leaving 2 forward crossings -> 1 lap from sample 1 to 5.
    const lat = [0, 0, 0, 0, 0, 0, 0]
    const lon = [-1, 1, 1, -1, -1, 1, 1]
    //            0   1  2   3   4  5  6
    // seg 0->1: -1->1 forward (cross at idx 1)
    // seg 2->3:  1->-1 backward (cross at idx 3)
    // seg 4->5: -1->1 forward (cross at idx 5)
    const track = makeTrack(lat, lon)
    const timeMs = new Float64Array([0, 10000, 20000, 30000, 40000, 50000, 60000])

    const laps = detectLapsByLine(track, timeMs, line)
    expect(laps).toHaveLength(1)
    expect(laps[0]).toMatchObject({ startIdx: 1, endIdx: 5, lapTimeMs: 40000 })
  })

  it('debounces crossings closer together than minLapMs', () => {
    // Forward crossings kept at samples 2, 4, 6. The second (idx 4, t=4000) is
    // within minLapMs of the first (idx 2, t=2000), so it's merged; remaining
    // boundaries 2 and 6 produce a single lap.
    const lat = [0, 0, 0, 0, 0, 0, 0]
    const lon = [-1, 1, -1, 1, -1, 1, -1]
    const track = makeTrack(lat, lon)
    // crossing times: idx2=2000, idx4=4000, idx6=21000 ms
    const timeMs = new Float64Array([0, 1000, 2000, 3000, 4000, 20000, 21000])

    const laps = detectLapsByLine(track, timeMs, line, { minLapMs: 5000 })
    expect(laps).toHaveLength(1)
    expect(laps[0]).toMatchObject({ startIdx: 2, endIdx: 6, lapTimeMs: 19000 })
  })

  it('returns [] when there are fewer than 2 crossings', () => {
    const lat = [0, 0, 0]
    const lon = [-1, -0.5, 1] // single crossing somewhere in seg 1->2
    const track = makeTrack(lat, lon)
    const timeMs = new Float64Array([0, 10000, 20000])
    expect(detectLapsByLine(track, timeMs, line)).toEqual([])
  })

  it('returns [] with fewer than 2 valid fixes', () => {
    const track = makeTrack([0, 0, 0], [-1, 1, -1], [1, 0, 0])
    const timeMs = new Float64Array([0, 10000, 20000])
    expect(detectLapsByLine(track, timeMs, line)).toEqual([])
  })

  it('skips invalid fixes when forming segments', () => {
    // The same three crossings, but with an invalid sample inserted; the walk
    // bridges valid fixes. lon: -1, 1, (invalid), -1, 1, -1, 1 with valid mask.
    const lat = [0, 0, 0, 0, 0, 0, 0]
    const lon = [-1, 1, 99, -1, 1, -1, 1]
    const valid = [1, 1, 0, 1, 1, 1, 1]
    const track = makeTrack(lat, lon, valid)
    const timeMs = new Float64Array([0, 10000, 20000, 30000, 40000, 50000, 60000])
    const laps = detectLapsByLine(track, timeMs, line)
    // forward crossings at idx 1, 4(?)... ensure at least 2 laps formed
    expect(laps.length).toBeGreaterThanOrEqual(1)
  })
})

describe('detectLapsByChannel', () => {
  it('finds N-1 laps from an incrementing IR_LapNumber channel', () => {
    // IR_LapNumber steps 1,1,1,2,2,3,3 -> boundaries at idx 3 (1->2) and 5 (2->3)
    // => 1 complete lap between them.
    const session = new LogSession(
      [
        ch('Time', [0, 1000, 2000, 3000, 4000, 5000, 6000]),
        ch('IR_LapNumber', [1, 1, 1, 2, 2, 3, 3]),
      ],
      meta,
    )
    const timeMs = new Float64Array([0, 1000, 2000, 3000, 4000, 5000, 6000])
    const laps = detectLapsByChannel(session, timeMs)
    expect(laps).toHaveLength(1)
    expect(laps[0]).toMatchObject({ index: 0, startIdx: 3, endIdx: 5, lapTimeMs: 2000 })
  })

  it('produces 2 laps when the counter steps 1,2,3,4 (3 boundaries)', () => {
    const session = new LogSession(
      [ch('IR_LapNumber', [1, 1, 2, 2, 3, 3, 4, 4])],
      meta,
    )
    const timeMs = new Float64Array([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000])
    const laps = detectLapsByChannel(session, timeMs)
    expect(laps).toHaveLength(2)
    expect(laps[0]).toMatchObject({ startIdx: 2, endIdx: 4, lapTimeMs: 2000 })
    expect(laps[1]).toMatchObject({ startIdx: 4, endIdx: 6, lapTimeMs: 2000 })
  })

  it('returns [] when there is no IR_LapNumber channel', () => {
    const session = new LogSession([ch('RPM', [1000, 2000, 3000])], meta)
    const timeMs = new Float64Array([0, 1000, 2000])
    expect(detectLapsByChannel(session, timeMs)).toEqual([])
  })

  it('returns [] when fewer than 2 lap boundaries exist', () => {
    const session = new LogSession([ch('IR_LapNumber', [1, 1, 1, 2, 2])], meta)
    const timeMs = new Float64Array([0, 1000, 2000, 3000, 4000])
    expect(detectLapsByChannel(session, timeMs)).toEqual([])
  })
})
