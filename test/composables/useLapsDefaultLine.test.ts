import { describe, it, expect } from 'vitest'
import { defaultLine } from '@/composables/useLaps'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

const LAT0 = 25
const LON0 = 121
const M_PER_DEG_LAT = 111_195
const COS = Math.cos((LAT0 * Math.PI) / 180)

/** Build a track from east/north metre offsets relative to (LAT0, LON0). */
function trackFromMeters(pts: Array<[number, number]>): GpsTrack {
  const n = pts.length
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const valid = new Uint8Array(n).fill(1)
  pts.forEach(([e, nn], i) => {
    lat[i] = LAT0 + nn / M_PER_DEG_LAT
    lon[i] = LON0 + e / (M_PER_DEG_LAT * COS)
  })
  return { lat, lon, valid }
}

/** Direction of the line in degrees (0..180) in the east/north plane. */
function lineDirDeg(l: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }) {
  const e = (l.a.lon - l.b.lon) * COS
  const n = l.a.lat - l.b.lat
  return (((Math.atan2(n, e) * 180) / Math.PI) + 180) % 180
}

function angDiff(a: number, b: number) {
  const d = Math.abs(a - b) % 180
  return Math.min(d, 180 - d)
}

describe('defaultLine direction (B130)', () => {
  it('ignores sub-10 m jitter at a stationary start and uses true heading', () => {
    // Jitter (~1 m, wrong directions), then driving due east.
    const pts: Array<[number, number]> = [
      [0, 0],
      [0.3, -0.9],
      [-0.8, 0.4],
      [0.5, 0.7],
      [-0.2, -0.6],
    ]
    for (let k = 1; k <= 20; k++) pts.push([k * 5, 0])
    const line = defaultLine(trackFromMeters(pts))!
    // Heading east -> line should run north/south (90 deg).
    expect(angDiff(lineDirDeg(line), 90)).toBeLessThan(10)
  })

  it('falls back to the next valid fix when no fix is >= 10 m away', () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [0, 2], // heading north -> line east/west (0 deg)
      [3, 4],
      [-2, 1],
    ]
    const line = defaultLine(trackFromMeters(pts))!
    expect(angDiff(lineDirDeg(line), 0)).toBeLessThan(1)
  })

  it('returns null with fewer than two valid fixes', () => {
    expect(defaultLine(trackFromMeters([[0, 0]]))).toBeNull()
  })
})
