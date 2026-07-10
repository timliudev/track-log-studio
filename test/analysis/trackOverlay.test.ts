import { describe, it, expect } from 'vitest'
import { decimateGpsTrack, OVERLAY_MAX_POINTS } from '@/domain/analysis/trackOverlay'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

function makeTrack(n: number): GpsTrack {
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lat[i] = 25 + i * 0.0001
    lon[i] = 121 + i * 0.0001
    valid[i] = 1
  }
  return { lat, lon, valid }
}

describe('decimateGpsTrack', () => {
  it('is a no-op when the track already fits within maxPoints', () => {
    const track = makeTrack(50)
    expect(decimateGpsTrack(track, 100)).toBe(track)
    expect(decimateGpsTrack(track, 50)).toBe(track)
  })

  it('reduces to exactly maxPoints when over budget', () => {
    const track = makeTrack(5000)
    const out = decimateGpsTrack(track, 500)
    expect(out.lat.length).toBe(500)
    expect(out.lon.length).toBe(500)
    expect(out.valid.length).toBe(500)
  })

  it('always keeps the first and last sample', () => {
    const track = makeTrack(5000)
    const out = decimateGpsTrack(track, 200)
    expect(out.lat[0]).toBe(track.lat[0])
    expect(out.lon[0]).toBe(track.lon[0])
    expect(out.lat[out.lat.length - 1]).toBe(track.lat[track.lat.length - 1])
    expect(out.lon[out.lon.length - 1]).toBe(track.lon[track.lon.length - 1])
  })

  it('keeps valid flags in lockstep with the sampled lat/lon', () => {
    const n = 1000
    const track = makeTrack(n)
    // Punch a gap of invalid fixes in the middle.
    for (let i = 400; i < 420; i++) track.valid[i] = 0
    const out = decimateGpsTrack(track, 100)
    for (let i = 0; i < out.lat.length; i++) {
      // Re-derive which source index this output sample came from and check
      // its valid flag matches (same stride math as the implementation).
      const stride = (n - 1) / (out.lat.length - 1)
      const idx = i === out.lat.length - 1 ? n - 1 : Math.round(i * stride)
      expect(out.valid[i]).toBe(track.valid[idx])
    }
  })

  it('is a no-op for a degenerate maxPoints (< 2)', () => {
    const track = makeTrack(50)
    expect(decimateGpsTrack(track, 1)).toBe(track)
    expect(decimateGpsTrack(track, 0)).toBe(track)
  })

  it('OVERLAY_MAX_POINTS is a sane, generous default', () => {
    expect(OVERLAY_MAX_POINTS).toBeGreaterThan(100)
  })
})
