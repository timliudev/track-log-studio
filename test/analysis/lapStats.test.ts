import { describe, it, expect } from 'vitest'
import { lapStats } from '@/domain/analysis/lapStats'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'

function makeTrack(lat: number[], lon: number[], valid?: number[]): GpsTrack {
  return {
    lat: new Float64Array(lat),
    lon: new Float64Array(lon),
    valid: valid ? Uint8Array.from(valid) : new Uint8Array(lat.length).fill(1),
  }
}

describe('lapStats', () => {
  it('computes distance and takes top speed as the max of the speed channel', () => {
    const n = 6
    const lat = new Array(n).fill(0)
    const lon = Array.from({ length: n }, (_, i) => i * 0.001) // ~111 m steps
    const track = makeTrack(lat, lon)
    const timeMs = new Float64Array(Array.from({ length: n }, (_, i) => i * 1000))
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    // Real speed channel in km/h; top speed must be the max over the span.
    const speed = new Float32Array([40, 55, 80, 120, 95, 60])
    const lap: Lap = { index: 0, startIdx: 0, endIdx: n - 1, lapTimeMs: (n - 1) * 1000 }

    const stats = lapStats(track, timeMs, cum, speed, lap)

    expect(stats.distanceM).toBeCloseTo(cum[n - 1] - cum[0], 6)
    expect(stats.topSpeedKmh).toBe(120)
  })

  it('restricts top speed to the lap span and ignores NaN samples', () => {
    const track = makeTrack([0, 0, 0, 0, 0], [0, 0.001, 0.002, 0.003, 0.004])
    const timeMs = new Float64Array([0, 1000, 2000, 3000, 4000])
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    // The 150 outside [1,3] must be excluded; the NaN inside the span is skipped.
    const speed = new Float32Array([150, 60, NaN, 90, 150])
    const lap: Lap = { index: 0, startIdx: 1, endIdx: 3, lapTimeMs: 2000 }

    const stats = lapStats(track, timeMs, cum, speed, lap)
    expect(stats.topSpeedKmh).toBe(90)
  })

  it('returns NaN top speed when no speed channel is available', () => {
    const track = makeTrack([0, 0], [0, 0.001])
    const timeMs = new Float64Array([0, 1000])
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const lap: Lap = { index: 0, startIdx: 0, endIdx: 1, lapTimeMs: 1000 }

    const stats = lapStats(track, timeMs, cum, null, lap)
    expect(Number.isNaN(stats.topSpeedKmh)).toBe(true)
  })

  it('still reports cumulative distance for a single-sample lap', () => {
    const track = makeTrack([0, 0], [0, 0.001])
    const timeMs = new Float64Array([0, 1000])
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const speed = new Float32Array([10, 20])
    const lap: Lap = { index: 0, startIdx: 1, endIdx: 1, lapTimeMs: 0 }

    const stats = lapStats(track, timeMs, cum, speed, lap)
    expect(stats.distanceM).toBe(0)
    // Single index span [1,1] -> just sample 1's speed.
    expect(stats.topSpeedKmh).toBe(20)
  })
})
