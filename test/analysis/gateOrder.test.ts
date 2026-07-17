import { describe, it, expect } from 'vitest'
import { gatePositionOnLap, sortGatesByPosition } from '@/domain/analysis/gateOrder'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'
import type { Lap } from '@/domain/model/Lap'

/** Build a GpsTrack from lat/lon arrays, marking every sample valid by default. */
function makeTrack(lat: number[], lon: number[], valid?: number[]): GpsTrack {
  return {
    lat: new Float64Array(lat),
    lon: new Float64Array(lon),
    valid: valid ? Uint8Array.from(valid) : new Uint8Array(lat.length).fill(1),
  }
}

function lap(index: number, startIdx: number, endIdx: number): Lap {
  return { index, startIdx, endIdx, lapTimeMs: 0 }
}

/** A vertical gate line at lon = x, spanning lat [-1, 1] — crosses the
 *  horizontal straight track used below. */
function gateAt(lon: number): LapLine {
  return { a: { lat: -1, lon }, b: { lat: 1, lon } }
}

describe('gatePositionOnLap', () => {
  // Straight track along lat=0, lon marching 0..10, one (roughly-degree, but
  // haversineM treats these as real lat/lon so distances aren't exactly 1m
  // apart — that's fine, this test only cares about relative ORDER/position).
  const lat = Array.from({ length: 11 }, () => 0)
  const lon = Array.from({ length: 11 }, (_, i) => i)
  const track = makeTrack(lat, lon)
  const theLap = lap(0, 0, 10)

  it('returns the interpolated crossing distance for a gate the track crosses', () => {
    const posEarly = gatePositionOnLap(track, theLap, gateAt(3.5))
    const posLate = gatePositionOnLap(track, theLap, gateAt(7.5))
    expect(posEarly).not.toBeNull()
    expect(posLate).not.toBeNull()
    // Later gate must report a larger lap-relative distance.
    expect(posLate!).toBeGreaterThan(posEarly!)
  })

  it('positions a gate at the middle sample when the track crosses through it', () => {
    const sampledTrack = makeTrack([0, 0, 0], [-1, 0, 2])
    const sampledLap = lap(0, 0, 2)
    const atSample = gatePositionOnLap(sampledTrack, sampledLap, gateAt(0))
    const beforeSample = gatePositionOnLap(sampledTrack, sampledLap, gateAt(-0.5))
    const afterSample = gatePositionOnLap(sampledTrack, sampledLap, gateAt(0.5))
    expect(atSample).not.toBeNull()
    expect(atSample!).toBeGreaterThan(beforeSample!)
    expect(atSample!).toBeLessThan(afterSample!)
  })

  it('position increases monotonically with the gate along the direction of travel', () => {
    const stops = [1.5, 3.5, 5.5, 7.5, 9.5].map((x) => gatePositionOnLap(track, theLap, gateAt(x)))
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!).toBeGreaterThan(stops[i - 1]!)
    }
  })

  it('falls back to nearest-point distance for a gate that does not cross the track', () => {
    // A gate parallel to and offset from the track (never straddled) near lon=5.
    const offGate: LapLine = { a: { lat: 5, lon: 5 }, b: { lat: 6, lon: 5 } }
    const pos = gatePositionOnLap(track, theLap, offGate)
    expect(pos).not.toBeNull()
    // Nearest sample is index 5 (lon=5); should be roughly mid-lap.
    const posStart = gatePositionOnLap(track, theLap, gateAt(0.5))!
    const posEnd = gatePositionOnLap(track, theLap, gateAt(9.5))!
    expect(pos!).toBeGreaterThan(posStart)
    expect(pos!).toBeLessThan(posEnd)
  })

  it('returns null when the lap has fewer than two valid fixes', () => {
    const emptyLap = lap(0, 0, 0)
    expect(gatePositionOnLap(track, emptyLap, gateAt(3.5))).toBeNull()
  })
})

describe('sortGatesByPosition', () => {
  const lat = Array.from({ length: 11 }, () => 0)
  const lon = Array.from({ length: 11 }, (_, i) => i)
  const track = makeTrack(lat, lon)
  const theLap = lap(0, 0, 10)

  it('reorders gates ascending by lap-relative position regardless of input order', () => {
    const late = gateAt(7.5)
    const early = gateAt(1.5)
    const mid = gateAt(4.5)
    const sorted = sortGatesByPosition(track, theLap, [late, early, mid], (g) => g)
    expect(sorted).toEqual([early, mid, late])
  })

  it('is a no-op (order-wise) for an already-sorted list', () => {
    const gates = [gateAt(1.5), gateAt(4.5), gateAt(7.5)]
    const sorted = sortGatesByPosition(track, theLap, gates, (g) => g)
    expect(sorted).toEqual(gates)
  })

  it('works with a richer wrapper type via the lineOf accessor', () => {
    const wrapped = [
      { id: 'b', line: gateAt(7.5) },
      { id: 'a', line: gateAt(1.5) },
    ]
    const sorted = sortGatesByPosition(track, theLap, wrapped, (w) => w.line)
    expect(sorted.map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('keeps un-positionable gates last, in original relative order', () => {
    const emptyLap = lap(0, 0, 0)
    const g1 = gateAt(1.5)
    const g2 = gateAt(4.5)
    const sorted = sortGatesByPosition(track, emptyLap, [g1, g2], (g) => g)
    // Neither gate is positionable on an empty lap; original order preserved.
    expect(sorted).toEqual([g1, g2])
  })
})
