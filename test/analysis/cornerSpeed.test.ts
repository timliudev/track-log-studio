import { describe, it, expect } from 'vitest'
import { detectCornerApexes } from '@/domain/analysis/cornerSpeed'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

// Tests exercise the peak-separation ALGORITHM on synthetic, low-noise speed
// profiles with lenient explicit thresholds, mirroring cornerDetection.test.ts
// — CORNER_SPEED_DEFAULTS is calibrated separately against real GPS data.
const LENIENT = { minProminenceKmh: 3, minSpacingM: 5 }

/** Build a straight-line GPS track (heading due east, stepM per sample) so
 *  cumulative distance is simply index * stepM — isolates the speed-signal
 *  logic from any curvature concerns. */
function straightTrack(n: number, stepM = 5, lat0 = 23, lon0 = 120): GpsTrack {
  const R = 6371000
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180)
  for (let i = 0; i < n; i++) {
    lat[i] = lat0
    lon[i] = lon0 + ((i * stepM) / (R * cosLat0)) * (180 / Math.PI)
  }
  return { lat, lon, valid: new Uint8Array(n).fill(1) }
}

/** A speed profile that is `base` everywhere except for a smooth triangular
 *  dip down to `apex` at `center`, linearly ramping back up to `base` over
 *  `halfWidth` samples on either side (clean, monotonic each side — no
 *  rounding artifacts that could register as spurious extra peaks). */
function withDip(n: number, base: number, center: number, halfWidth: number, apex: number): Float64Array {
  const speed = new Float64Array(n).fill(base)
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - center)
    if (d >= halfWidth) continue
    const t = 1 - d / halfWidth // 1 at center, 0 at the ramp edge
    speed[i] = base - (base - apex) * t
  }
  return speed
}

describe('detectCornerApexes', () => {
  it('finds no apexes on a flat (constant-speed) straight', () => {
    const n = 100
    const track = straightTrack(n)
    const speed = new Float64Array(n).fill(150)
    const apexes = detectCornerApexes(track, speed, 0, n, LENIENT)
    expect(apexes).toHaveLength(0)
  })

  it('finds exactly one apex for a single braking dip', () => {
    const n = 100
    const track = straightTrack(n)
    const speed = withDip(n, 150, 50, 30, 60)
    const apexes = detectCornerApexes(track, speed, 0, n, LENIENT)
    expect(apexes).toHaveLength(1)
    expect(apexes[0].speedKmh).toBeCloseTo(60, 0)
  })

  it('separates a chicane (two dips) into two apexes', () => {
    const n = 160
    const track = straightTrack(n)
    let speed = withDip(n, 150, 50, 24, 70)
    // Overlay a second dip further down the straight onto the same array.
    const second = withDip(n, 150, 110, 24, 55)
    speed = speed.map((v, i) => Math.min(v, second[i]))
    const apexes = detectCornerApexes(track, speed, 0, n, LENIENT)
    expect(apexes).toHaveLength(2)
    // Ordered by distance (ascending sample index).
    expect(apexes[0].index).toBeLessThan(apexes[1].index)
    expect(apexes[0].speedKmh).toBeCloseTo(70, 0)
    expect(apexes[1].speedKmh).toBeCloseTo(55, 0)
  })

  it('rejects a shallow dip below the prominence threshold (noise)', () => {
    const n = 100
    const track = straightTrack(n)
    // A tiny 2 km/h wobble, well under LENIENT's 3 km/h prominence floor.
    const speed = withDip(n, 150, 50, 10, 148)
    const apexes = detectCornerApexes(track, speed, 0, n, LENIENT)
    expect(apexes).toHaveLength(0)
  })

  it('merges GPS-noise-fragmented dips within minSpacingM into one apex', () => {
    const n = 100
    const track = straightTrack(n, 1) // 1m/sample so index gaps map directly to metres
    // Two adjacent dips just a few samples (metres) apart — closer than
    // LENIENT's minSpacingM (5m) — should merge into the more prominent one.
    let speed = withDip(n, 150, 48, 8, 60)
    const second = withDip(n, 150, 52, 8, 65)
    speed = speed.map((v, i) => Math.min(v, second[i]))
    const apexes = detectCornerApexes(track, speed, 0, n, LENIENT)
    expect(apexes).toHaveLength(1)
  })

  it('reports lapDistanceM relative to the lap start, not the session start', () => {
    const n = 200
    const track = straightTrack(n, 5)
    const speed = withDip(n, 150, 150, 30, 60) // dip at sample 150
    const startIdx = 100
    const apexes = detectCornerApexes(track, speed, startIdx, n, LENIENT)
    expect(apexes).toHaveLength(1)
    // Apex sample is ~50 samples after startIdx, 5m/sample => ~250m.
    expect(apexes[0].lapDistanceM).toBeCloseTo((150 - startIdx) * 5, 0)
  })

  it('ignores samples outside [startIdx, endIdx)', () => {
    const n = 200
    const track = straightTrack(n, 5)
    const speed = withDip(n, 150, 20, 20, 40) // dip well before startIdx=100
    const apexes = detectCornerApexes(track, speed, 100, n, LENIENT)
    expect(apexes).toHaveLength(0)
  })

  it('skips invalid (no-fix) samples', () => {
    const n = 100
    const track = straightTrack(n)
    track.valid[50] = 0 // invalidate the exact apex sample
    const speed = withDip(n, 150, 50, 30, 60)
    const apexes = detectCornerApexes(track, speed, 0, n, LENIENT)
    // The apex may shift to an adjacent valid sample, but distance/lat/lon
    // must still resolve to a valid fix (finite, non-NaN).
    for (const a of apexes) {
      expect(Number.isFinite(a.lat)).toBe(true)
      expect(Number.isFinite(a.lon)).toBe(true)
      expect(track.valid[a.index]).toBe(1)
    }
  })
})
