import { describe, it, expect } from 'vitest'
import { fitProjection } from '@/features/analyzer/projection'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

function makeTrack(lat: number[], lon: number[]): GpsTrack {
  return {
    lat: new Float64Array(lat),
    lon: new Float64Array(lon),
    valid: new Uint8Array(lat.length).fill(1),
  }
}

describe('fitProjection', () => {
  const W = 300
  const H = 200
  const PAD = 16

  it('returns null with fewer than two valid fixes', () => {
    const track = makeTrack([25.0], [121.0])
    expect(fitProjection(track, W, H, PAD)).toBeNull()
  })

  it('maps every valid fix within the canvas bounds', () => {
    // A small synthetic loop near Taipei.
    const lat = [25.0, 25.001, 25.0015, 25.001, 25.0]
    const lon = [121.0, 121.0005, 121.0, 120.9995, 121.0]
    const track = makeTrack(lat, lon)
    const proj = fitProjection(track, W, H, PAD)
    expect(proj).not.toBeNull()
    for (let i = 0; i < lat.length; i++) {
      const p = proj!.toPixel(lat[i], lon[i])
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(W)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(H)
    }
  })

  it('keeps the auto-seeded default line endpoints inside the canvas', () => {
    // The default start/finish line is centred on the first fix with a
    // half-length ~10% of the bbox diagonal, so its endpoints sit inside the
    // track bbox and must therefore project within the (padded) canvas.
    const lat = [25.0, 25.002, 25.004, 25.002, 25.0]
    const lon = [121.0, 121.001, 121.0, 120.999, 121.0]
    const track = makeTrack(lat, lon)
    const proj = fitProjection(track, W, H, PAD)
    expect(proj).not.toBeNull()

    // Two representative endpoints near the centre of the bbox (a default line
    // never extends past the bbox by construction).
    const midLat = (25.0 + 25.004) / 2
    const midLon = (120.999 + 121.001) / 2
    const endpoints = [
      { lat: midLat + 0.0002, lon: midLon + 0.0001 },
      { lat: midLat - 0.0002, lon: midLon - 0.0001 },
    ]
    for (const e of endpoints) {
      const p = proj!.toPixel(e.lat, e.lon)
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(W)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(H)
    }
  })

  it('round-trips toPixel/toGeo', () => {
    const track = makeTrack([25.0, 25.002, 25.004], [121.0, 121.001, 121.0])
    const proj = fitProjection(track, W, H, PAD)!
    const p = proj.toPixel(25.002, 121.001)
    const g = proj.toGeo(p.x, p.y)
    expect(g.lat).toBeCloseTo(25.002, 6)
    expect(g.lon).toBeCloseTo(121.001, 6)
  })
})
