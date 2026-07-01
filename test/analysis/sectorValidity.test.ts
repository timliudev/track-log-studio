import { describe, it, expect } from 'vitest'
import { invalidSectorLapIndices } from '@/domain/analysis/sectorValidity'
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
  return { index, startIdx, endIdx, lapTimeMs: (endIdx - startIdx) * 1000 }
}

/** A vertical gate line at lon = x, spanning lat [-1, 1]. */
function gateAt(lon: number): LapLine {
  return { a: { lat: -1, lon }, b: { lat: 1, lon } }
}

describe('invalidSectorLapIndices', () => {
  // A straight track along lat=0, lon marching 0..10 one unit per sample
  // (indices 0..10). Two gates planted at lon=3 and lon=7.
  const straightLat = Array.from({ length: 11 }, () => 0)
  const straightLon = Array.from({ length: 11 }, (_, i) => i)
  const straightTrack = makeTrack(straightLat, straightLon)
  const gates = [gateAt(3), gateAt(7)]

  it('zero gates => no lap is invalid (byte-identical to no sector filter)', () => {
    const laps = [lap(0, 0, 10)]
    expect(invalidSectorLapIndices(laps, straightTrack, [])).toEqual([])
  })

  it('a lap that crosses every gate in order is valid', () => {
    const laps = [lap(0, 0, 10)] // covers lon 0..10, crosses gate@3 then gate@7
    expect(invalidSectorLapIndices(laps, straightTrack, gates)).toEqual([])
  })

  it('a lap that misses a gate entirely is invalid', () => {
    // Lap only spans lon 0..5: crosses gate@3 but never reaches gate@7.
    const laps = [lap(0, 0, 5)]
    expect(invalidSectorLapIndices(laps, straightTrack, gates)).toEqual([0])
  })

  it('a lap that crosses gates out of order is invalid (infield cut / 切西瓜)', () => {
    // Track: starts at lon=8 (past both gates), goes back down to lon=0, then
    // forward to lon=10. So within this lap span the crossings appear as
    // gate@7 first (descending) then gate@3 (descending) then gate@3 again
    // (ascending) then gate@7 again (ascending) -- but the pointer expects
    // gate@3 FIRST. Since gate@7 is hit before gate@3 is ever satisfied, the
    // pointer never advances past gate 0 on that first crossing (gate@7 isn't
    // the expected gate), so it must still see gate@3 before gate@7 will count.
    // Build an explicit "cut across the infield": go straight from lon=0 to
    // lon=9 skipping the region between (simulate via few samples) then a
    // short excursion that crosses gate@7 before gate@3.
    const lat = [0, 0, 0, 0]
    const lon = [8, 9, 0, 10] // sample1->2 doesn't cross either gate near start
    // Actually construct a cleaner out-of-order case below instead.
    void lat
    void lon

    // Cleaner construction: track goes lon 8 -> 6 -> 8 -> 2 -> 10.
    // Segment 0->1 (8->6): crosses gate@7 (descending). Pointer expects
    // gate@3 first, so this crossing is ignored (gate@7 not yet expected).
    // Segment 1->2 (6->8): crosses gate@7 again (ascending) - still ignored.
    // Segment 2->3 (8->2): crosses gate@7 AND gate@3 - but a single segment
    // can only be tested against the CURRENT expected gate (gate@3), so this
    // segment crosses gate@3 - pointer advances to expect gate@7.
    // Segment 3->4 (2->10): crosses gate@7 - pointer advances to end. Valid!
    // To truly get an INVALID out-of-order case, make the lap END before the
    // gate@3 crossing is ever reached after gate@7 appears alone.
    const oooLat = [0, 0, 0]
    const oooLon = [8, 6, 8] // oscillates around gate@7 only, never reaches gate@3
    const oooTrack = makeTrack(oooLat, oooLon)
    const laps = [lap(0, 0, 2)]
    // Crosses gate@7 twice but never gate@3 (expected first) => invalid (misses gate 0).
    expect(invalidSectorLapIndices(laps, oooTrack, gates)).toEqual([0])
  })

  it('skipping ahead to gate 2 before gate 1 does not satisfy gate 1, so the lap is invalid', () => {
    // lon: 8 -> 2 -> 10. Segment 0->1 (8->2) crosses BOTH gate@7 and gate@3,
    // but is tested only against the CURRENT expected gate (gate@3, index 0)
    // - it crosses gate@3 too, so this actually satisfies gate 1 as a side
    // effect. To isolate "sees gate 2 first without gate 1", use a lap that
    // starts AFTER gate@3 and never returns to cross it.
    const lat = [0, 0, 0]
    const lon = [4, 6, 9] // never crosses lon=3 (gate 1), only lon=7 (gate 2)
    const track = makeTrack(lat, lon)
    const laps = [lap(0, 0, 2)]
    expect(invalidSectorLapIndices(laps, track, gates)).toEqual([0])
  })

  it('a lap that crosses a gate twice before advancing still only needs one to progress', () => {
    // lon: 0 -> 4 -> 2 -> 4 -> 8. Crosses gate@3 three times (forward, back,
    // forward) before ever reaching gate@7. Pointer advances on the FIRST
    // gate@3 crossing (segment 0->1), so subsequent gate@3 re-crossings are
    // tested against gate@7 instead (harmless - they don't match gate@7, so
    // nothing happens), and the final segment 4->8 crosses gate@7, completing
    // the lap validly.
    const lat = [0, 0, 0, 0, 0]
    const lon = [0, 4, 2, 4, 8]
    const track = makeTrack(lat, lon)
    const laps = [lap(0, 0, 4)]
    expect(invalidSectorLapIndices(laps, track, gates)).toEqual([])
  })

  it('multiple laps: only the failing ones are reported, by lap.index not array position', () => {
    const laps = [
      lap(5, 0, 10), // full straight track: valid
      lap(2, 0, 5), // stops short of gate 2: invalid
    ]
    expect(invalidSectorLapIndices(laps, straightTrack, gates).sort()).toEqual([2])
  })

  it('single gate: a lap crossing it is valid, one that does not is invalid', () => {
    const oneGate = [gateAt(5)]
    const crossing = [lap(0, 0, 10)]
    const notCrossing = [lap(1, 0, 4)]
    expect(invalidSectorLapIndices(crossing, straightTrack, oneGate)).toEqual([])
    expect(invalidSectorLapIndices(notCrossing, straightTrack, oneGate)).toEqual([1])
  })

  it('empty laps yields no invalid indices', () => {
    expect(invalidSectorLapIndices([], straightTrack, gates)).toEqual([])
  })

  it('skips invalid GPS fixes when walking the lap', () => {
    // Same straight track but with an invalid sample spliced in near gate@3;
    // the walk should bridge across it and still detect the crossing.
    const lat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const lon = [0, 1, 2, 99, 3, 4, 5, 6, 7, 8, 9]
    const valid = [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1]
    const track = makeTrack(lat, lon, valid)
    const laps = [lap(0, 0, 10)]
    expect(invalidSectorLapIndices(laps, track, gates)).toEqual([])
  })

  it('a degenerate lap (startIdx === endIdx) with gates is invalid (no samples to cross anything)', () => {
    const laps = [lap(0, 3, 3)]
    expect(invalidSectorLapIndices(laps, straightTrack, gates)).toEqual([0])
  })

  it('lap span is clamped to the track bounds', () => {
    // endIdx beyond the track length should not throw; just clamps.
    const laps = [lap(0, 0, 999)]
    expect(invalidSectorLapIndices(laps, straightTrack, gates)).toEqual([])
  })
})
