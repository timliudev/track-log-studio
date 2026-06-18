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
  it('computes distance and top speed for a straight constant-speed track', () => {
    // A straight eastbound run along the equator. Each step is one constant
    // longitude increment per second, so distance is the sum of steps and the
    // peak speed equals the constant per-step speed.
    const n = 6
    const lat = new Array(n).fill(0)
    const lon = Array.from({ length: n }, (_, i) => i * 0.001) // ~111 m steps
    const track = makeTrack(lat, lon)
    const timeMs = new Float64Array(Array.from({ length: n }, (_, i) => i * 1000))
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const lap: Lap = { index: 0, startIdx: 0, endIdx: n - 1, lapTimeMs: (n - 1) * 1000 }

    const stats = lapStats(track, timeMs, cum, lap)

    const expectedDistance = cum[n - 1] - cum[0]
    expect(stats.distanceM).toBeCloseTo(expectedDistance, 6)
    // Each ~111 m step over 1 s → ~111 m/s → ~400 km/h; uniform, so top == step.
    const stepM = expectedDistance / (n - 1)
    const expectedKmh = stepM * 3.6
    expect(stats.topSpeedKmh).toBeCloseTo(expectedKmh, 3)
  })

  it('returns zeros for a zero-length lap', () => {
    const track = makeTrack([0, 0], [0, 0.001])
    const timeMs = new Float64Array([0, 1000])
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const lap: Lap = { index: 0, startIdx: 1, endIdx: 1, lapTimeMs: 0 }

    const stats = lapStats(track, timeMs, cum, lap)
    expect(stats.distanceM).toBe(0)
    expect(stats.topSpeedKmh).toBe(0)
  })

  it('ignores invalid fixes and guards non-positive time steps', () => {
    // Middle sample invalid; the speed step bridges valid fixes 0 and 2.
    const track = makeTrack([0, 0, 0], [0, 0.5, 0.001], [1, 0, 1])
    const timeMs = new Float64Array([0, 500, 2000])
    const cum = cumulativeDistanceM(track.lat, track.lon, track.valid)
    const lap: Lap = { index: 0, startIdx: 0, endIdx: 2, lapTimeMs: 2000 }

    const stats = lapStats(track, timeMs, cum, lap)
    expect(stats.topSpeedKmh).toBeGreaterThan(0)
    expect(Number.isFinite(stats.topSpeedKmh)).toBe(true)
  })
})
