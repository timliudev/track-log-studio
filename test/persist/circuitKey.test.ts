import { describe, it, expect } from 'vitest'
import {
  circuitKey,
  circuitCentroid,
  circuitKeysMatch,
  parseCircuitKey,
  CIRCUIT_MATCH_TOLERANCE_DEG,
} from '@/domain/persist/circuitKey'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

function makeTrack(lat: number[], lon: number[], valid?: number[]): GpsTrack {
  return {
    lat: new Float64Array(lat),
    lon: new Float64Array(lon),
    valid: valid ? Uint8Array.from(valid) : new Uint8Array(lat.length).fill(1),
  }
}

describe('circuitKey', () => {
  it('returns null when the track has no valid fix', () => {
    const track = makeTrack([1, 2, 3], [1, 2, 3], [0, 0, 0])
    expect(circuitKey(track)).toBeNull()
    expect(circuitCentroid(track)).toBeNull()
  })

  it('produces the same key for two sessions at the same circuit despite GNSS drift', () => {
    // Session A: a small loop around (24.123, 121.456).
    const a = makeTrack(
      [24.1230, 24.1231, 24.1229, 24.1230],
      [121.4560, 121.4561, 121.4559, 121.4560],
    )
    // Session B: same circuit, slightly drifted fixes (a few metres), different sample count.
    const b = makeTrack(
      [24.12301, 24.12315, 24.12295, 24.12302, 24.12298],
      [121.45602, 121.45611, 121.45591, 121.45599, 121.45605],
    )
    const ka = circuitKey(a)
    const kb = circuitKey(b)
    expect(ka).not.toBeNull()
    expect(ka).toEqual(kb)
  })

  it('produces different keys for two circuits ~1 km apart', () => {
    const a = makeTrack([24.1230, 24.1231], [121.4560, 121.4561])
    const b = makeTrack([24.1330, 24.1331], [121.4660, 121.4661]) // ~1.5 km away
    expect(circuitKey(a)).not.toEqual(circuitKey(b))
  })

  it('ignores invalid fixes when computing the centroid', () => {
    const withNoise = makeTrack(
      [24.1230, 999, 24.1231, 24.1229, -999],
      [121.4560, 999, 121.4561, 121.4559, -999],
      [1, 0, 1, 1, 0],
    )
    const clean = makeTrack([24.1230, 24.1231, 24.1229], [121.4560, 121.4561, 121.4559])
    expect(circuitKey(withNoise)).toEqual(circuitKey(clean))
  })

  it('uses the median, robust to a single outlier fix', () => {
    const withOutlier = makeTrack(
      [24.1230, 24.1231, 24.1229, 24.1230, 50.0], // one wild outlier
      [121.4560, 121.4561, 121.4559, 121.4560, 90.0],
    )
    const clean = makeTrack(
      [24.1230, 24.1231, 24.1229, 24.1230],
      [121.4560, 121.4561, 121.4559, 121.4560],
    )
    expect(circuitKey(withOutlier)).toEqual(circuitKey(clean))
  })

  it('round-trips through parseCircuitKey', () => {
    const track = makeTrack([24.1230, 24.1231], [121.4560, 121.4561])
    const key = circuitKey(track)
    expect(key).not.toBeNull()
    const parsed = parseCircuitKey(key!)
    expect(parsed).not.toBeNull()
    expect(parsed!.lat).toBeCloseTo(24.123, 3)
    expect(parsed!.lon).toBeCloseTo(121.456, 3)
  })

  it('parseCircuitKey rejects malformed strings', () => {
    expect(parseCircuitKey('not-a-key')).toBeNull()
    expect(parseCircuitKey('1.23')).toBeNull()
    expect(parseCircuitKey('1.23,abc')).toBeNull()
  })

  it('circuitKeysMatch: identical strings always match', () => {
    expect(circuitKeysMatch('24.123,121.456', '24.123,121.456')).toBe(true)
  })

  it('circuitKeysMatch: within tolerance on both axes matches', () => {
    const a = '24.123,121.456'
    const b = `${(24.123 + CIRCUIT_MATCH_TOLERANCE_DEG).toFixed(3)},121.456`
    expect(circuitKeysMatch(a, b)).toBe(true)
  })

  it('circuitKeysMatch: beyond tolerance does not match', () => {
    const a = '24.123,121.456'
    const b = '24.200,121.456'
    expect(circuitKeysMatch(a, b)).toBe(false)
  })

  it('circuitKeysMatch: malformed key never matches', () => {
    expect(circuitKeysMatch('garbage', '24.123,121.456')).toBe(false)
  })

  it('circuitKeysMatch: Taiwan-latitude (~23.1°) regression — behaviour ~unchanged near equator', () => {
    // cos(23.1°) ≈ 0.9196, so the corrected tolerance (~0.001087°) is only
    // slightly looser than the plain equatorial one — a delta safely inside
    // the old tolerance still matches...
    const a = '23.100,120.500'
    const bInside = `23.100,${(120.5 + CIRCUIT_MATCH_TOLERANCE_DEG * 0.5).toFixed(4)}`
    expect(circuitKeysMatch(a, bInside)).toBe(true)
    // ...and a delta well beyond both the old and corrected tolerance still doesn't.
    const bOutside = '23.100,120.600'
    expect(circuitKeysMatch(a, bOutside)).toBe(false)
  })

  it('circuitKeysMatch: high latitude (60°) — cos(lat) correction widens longitude tolerance', () => {
    // At the equator a 0.0015° longitude delta is beyond CIRCUIT_MATCH_TOLERANCE_DEG
    // (0.001°) and would not match. At 60° latitude, 1° of longitude covers only
    // cos(60°) = 0.5 of the equatorial distance, so the same 0.0015° delta is only
    // ~75m — within the ~100m tolerance once corrected — and should now match.
    const a = '60.000,120.5000'
    const b = '60.000,120.5015'
    expect(circuitKeysMatch(a, b)).toBe(true)
  })

  it('circuitKeysMatch: high latitude (60°) — still rejects a delta beyond the corrected tolerance', () => {
    const a = '60.000,120.500'
    const b = '60.000,120.700'
    expect(circuitKeysMatch(a, b)).toBe(false)
  })

  it('circuitKeysMatch: latitude tolerance itself is unaffected by the longitude correction', () => {
    const a = '60.000,120.500'
    const b = `${(60 + CIRCUIT_MATCH_TOLERANCE_DEG * 2).toFixed(3)},120.500`
    expect(circuitKeysMatch(a, b)).toBe(false)
  })
})
