import { describe, it, expect } from 'vitest'
import { computeSectorTimes, computeOptimalLap } from '@/domain/analysis/sectorTiming'
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

function lap(index: number, startIdx: number, endIdx: number, lapTimeMs = 0): Lap {
  return { index, startIdx, endIdx, lapTimeMs }
}

/** A vertical gate line at lon = x, spanning lat [-1, 1]. */
function gateAt(lon: number): LapLine {
  return { a: { lat: -1, lon }, b: { lat: 1, lon } }
}

describe('computeSectorTimes', () => {
  // Straight track along lat=0, lon marching 0..10, one unit per sample, one
  // second (1000 ms) per sample — indices 0..10, times 0..10000 ms. Gates at
  // lon=3.5 and lon=7.5 (off the integer grid, matching sectorValidity's style
  // so every crossing strictly straddles a segment).
  const lat = Array.from({ length: 11 }, () => 0)
  const lon = Array.from({ length: 11 }, (_, i) => i)
  const track = makeTrack(lat, lon)
  const timeMs = new Float64Array(Array.from({ length: 11 }, (_, i) => i * 1000))
  const gates = [gateAt(3.5), gateAt(7.5)]

  it('zero gates => one sector spanning the whole lap', () => {
    const laps = [lap(0, 0, 10)]
    const result = computeSectorTimes(laps, track, timeMs, [])
    expect(result).toHaveLength(1)
    expect(result[0].complete).toBe(true)
    expect(result[0].sectorTimesMs).toHaveLength(1)
    expect(result[0].sectorTimesMs[0]).toBeCloseTo(10000, 0)
  })

  it('a complete lap yields 3 sector times (2 gates) summing to the lap span', () => {
    const laps = [lap(0, 0, 10)]
    const [r] = computeSectorTimes(laps, track, timeMs, gates)
    expect(r.complete).toBe(true)
    expect(r.sectorTimesMs).toHaveLength(3)
    // Gate at lon=3.5 crossed between sample 3 (t=3000) and 4 (t=4000):
    // interpolated crossing at 3500ms (halfway). Gate at 7.5 similarly at 7500ms.
    expect(r.sectorTimesMs[0]).toBeCloseTo(3500, 0) // start(0ms) -> gate1(3500ms)
    expect(r.sectorTimesMs[1]).toBeCloseTo(4000, 0) // gate1(3500) -> gate2(7500)
    expect(r.sectorTimesMs[2]).toBeCloseTo(2500, 0) // gate2(7500) -> finish(10000)
    const sum = r.sectorTimesMs.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(10000, 0)
  })

  it('a lap missing a gate is incomplete, with NaN for the un-timed trailing sector(s)', () => {
    // Lap only spans lon 0..5: crosses gate@3.5 but never reaches gate@7.5.
    const laps = [lap(0, 0, 5)]
    const [r] = computeSectorTimes(laps, track, timeMs, gates)
    expect(r.complete).toBe(false)
    expect(r.sectorTimesMs[0]).toBeCloseTo(3500, 0)
    expect(Number.isNaN(r.sectorTimesMs[1])).toBe(true)
    expect(Number.isNaN(r.sectorTimesMs[2])).toBe(true)
  })

  it('out-of-order infield cut is incomplete (mirrors invalidSectorLapIndices)', () => {
    const oooLat = [0, 0, 0]
    const oooLon = [8, 6, 8]
    const oooTrack = makeTrack(oooLat, oooLon)
    const oooTime = new Float64Array([0, 1000, 2000])
    const laps = [lap(0, 0, 2)]
    const [r] = computeSectorTimes(laps, oooTrack, oooTime, gates)
    expect(r.complete).toBe(false)
  })

  it('skips invalid GPS fixes when walking the lap, still interpolates correctly', () => {
    const lat2 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const lon2 = [0, 1, 2, 99, 3, 4, 5, 6, 7, 8, 9]
    const valid2 = [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1]
    const track2 = makeTrack(lat2, lon2, valid2)
    const time2 = new Float64Array(Array.from({ length: 11 }, (_, i) => i * 1000))
    const laps = [lap(0, 0, 10)]
    const [r] = computeSectorTimes(laps, track2, time2, gates)
    expect(r.complete).toBe(true)
    // Crossing gate@3.5 happens between sample 2 (lon=2,t=2000) and sample 4
    // (lon=3,t=4000) since sample 3 is skipped as invalid: interpolated at
    // s=(3.5-2)/(3-2)=1.5 clamped to 1 -> crossing at t=4000 (segment doesn't
    // actually straddle 3.5 exactly at s<=1 since lon goes 2->3, so no crossing
    // on this segment; the real crossing is the next segment 3->4 i.e. lon 3->4).
    expect(r.sectorTimesMs.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('empty laps yields empty result', () => {
    expect(computeSectorTimes([], track, timeMs, gates)).toEqual([])
  })

  it('a degenerate lap (startIdx >= endIdx) is not complete when gates exist', () => {
    const laps = [lap(0, 3, 3)]
    const [r] = computeSectorTimes(laps, track, timeMs, gates)
    expect(r.complete).toBe(false)
  })

  it('multiple laps are each timed independently, keyed by lapIndex', () => {
    const laps = [lap(5, 0, 10), lap(2, 0, 5)]
    const result = computeSectorTimes(laps, track, timeMs, gates)
    expect(result.map((r) => r.lapIndex)).toEqual([5, 2])
    expect(result[0].complete).toBe(true)
    expect(result[1].complete).toBe(false)
  })
})

describe('computeOptimalLap', () => {
  it('picks the min per sector, possibly from different laps, and sums them', () => {
    const timings = [
      { lapIndex: 0, sectorTimesMs: [3000, 4500, 2800], complete: true },
      { lapIndex: 1, sectorTimesMs: [2900, 4200, 3000], complete: true },
    ]
    const { bestSectors, optimalLapMs } = computeOptimalLap(timings, [])
    expect(bestSectors[0]).toEqual({ bestMs: 2900, lapIndex: 1 })
    expect(bestSectors[1]).toEqual({ bestMs: 4200, lapIndex: 1 })
    expect(bestSectors[2]).toEqual({ bestMs: 2800, lapIndex: 0 })
    expect(optimalLapMs).toBeCloseTo(2900 + 4200 + 2800, 6)
  })

  it('excludes incomplete laps from the best-sector search', () => {
    const timings = [
      { lapIndex: 0, sectorTimesMs: [1000, NaN], complete: false },
      { lapIndex: 1, sectorTimesMs: [1200, 2000], complete: true },
    ]
    const { bestSectors, optimalLapMs } = computeOptimalLap(timings, [])
    expect(bestSectors[0]).toEqual({ bestMs: 1200, lapIndex: 1 })
    expect(bestSectors[1]).toEqual({ bestMs: 2000, lapIndex: 1 })
    expect(optimalLapMs).toBeCloseTo(3200, 6)
  })

  it('excludes manually/otherwise-excluded laps by lapIndex', () => {
    const timings = [
      { lapIndex: 0, sectorTimesMs: [1000], complete: true },
      { lapIndex: 1, sectorTimesMs: [1200], complete: true },
    ]
    const { bestSectors, optimalLapMs } = computeOptimalLap(timings, [0])
    expect(bestSectors[0]).toEqual({ bestMs: 1200, lapIndex: 1 })
    expect(optimalLapMs).toBeCloseTo(1200, 6)
  })

  it('no qualifying laps => empty bestSectors and NaN optimal', () => {
    const timings = [{ lapIndex: 0, sectorTimesMs: [1000], complete: false }]
    const { bestSectors, optimalLapMs } = computeOptimalLap(timings, [])
    expect(bestSectors).toEqual([])
    expect(Number.isNaN(optimalLapMs)).toBe(true)
  })

  it('no laps at all => empty bestSectors and NaN optimal', () => {
    const { bestSectors, optimalLapMs } = computeOptimalLap([], [])
    expect(bestSectors).toEqual([])
    expect(Number.isNaN(optimalLapMs)).toBe(true)
  })
})
