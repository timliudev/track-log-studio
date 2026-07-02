import { describe, it, expect } from 'vitest'
import { detectChannelExtrema, resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LogSession } from '@/domain/model/LogSession'

// Tests exercise the peak-separation ALGORITHM (both min and max modes) on
// synthetic, low-noise profiles with lenient explicit thresholds, mirroring
// cornerDetection.test.ts — the RELATIVE_PROMINENCE_FRACTION default is
// exercised separately below, since it's calibrated (8%) rather than an
// algorithmic property.
const LENIENT = { minProminence: 3, minSpacingM: 5 }

/** Build a straight-line GPS track (heading due east, stepM per sample) so
 *  cumulative distance is simply index * stepM — isolates the signal logic
 *  from any curvature concerns. */
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

/** A signal that is `base` everywhere except for a smooth triangular dip down
 *  to `apex` at `center`, linearly ramping back up to `base` over `halfWidth`
 *  samples on either side (clean, monotonic each side — no rounding
 *  artifacts that could register as spurious extra peaks). Use apex > base
 *  for a bump (maxima case) or apex < base for a dip (minima case). */
function withFeature(n: number, base: number, center: number, halfWidth: number, apex: number): Float64Array {
  const values = new Float64Array(n).fill(base)
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - center)
    if (d >= halfWidth) continue
    const t = 1 - d / halfWidth // 1 at center, 0 at the ramp edge
    values[i] = base - (base - apex) * t
  }
  return values
}

describe('detectChannelExtrema — mode: min (corner-apex-style dips)', () => {
  it('finds no minima on a flat (constant) signal', () => {
    const n = 100
    const track = straightTrack(n)
    const values = new Float64Array(n).fill(150)
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'min', ...LENIENT })
    expect(extrema).toHaveLength(0)
  })

  it('finds exactly one minimum for a single dip', () => {
    const n = 100
    const track = straightTrack(n)
    const values = withFeature(n, 150, 50, 30, 60)
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'min', ...LENIENT })
    expect(extrema).toHaveLength(1)
    expect(extrema[0].kind).toBe('min')
    expect(extrema[0].value).toBeCloseTo(60, 0)
  })

  it('separates a chicane (two dips) into two minima, ordered by distance', () => {
    const n = 160
    const track = straightTrack(n)
    let values = withFeature(n, 150, 50, 24, 70)
    const second = withFeature(n, 150, 110, 24, 55)
    values = values.map((v, i) => Math.min(v, second[i]))
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'min', ...LENIENT })
    expect(extrema).toHaveLength(2)
    expect(extrema[0].index).toBeLessThan(extrema[1].index)
    expect(extrema[0].value).toBeCloseTo(70, 0)
    expect(extrema[1].value).toBeCloseTo(55, 0)
  })

  it('rejects a shallow dip below the prominence threshold (noise)', () => {
    const n = 100
    const track = straightTrack(n)
    // A tiny 2-unit wobble, well under LENIENT's 3-unit prominence floor.
    const values = withFeature(n, 150, 50, 10, 148)
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'min', ...LENIENT })
    expect(extrema).toHaveLength(0)
  })

  it('merges noise-fragmented dips within minSpacingM into one minimum', () => {
    const n = 100
    const track = straightTrack(n, 1) // 1m/sample so index gaps map directly to metres
    let values = withFeature(n, 150, 48, 8, 60)
    const second = withFeature(n, 150, 52, 8, 65)
    values = values.map((v, i) => Math.min(v, second[i]))
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'min', ...LENIENT })
    expect(extrema).toHaveLength(1)
  })

  it('reports lapDistanceM relative to the lap start, not the session start', () => {
    const n = 200
    const track = straightTrack(n, 5)
    const values = withFeature(n, 150, 150, 30, 60) // dip at sample 150
    const startIdx = 100
    const extrema = detectChannelExtrema(track, values, startIdx, n, { mode: 'min', ...LENIENT })
    expect(extrema).toHaveLength(1)
    expect(extrema[0].lapDistanceM).toBeCloseTo((150 - startIdx) * 5, 0)
  })

  it('ignores samples outside [startIdx, endIdx)', () => {
    const n = 200
    const track = straightTrack(n, 5)
    const values = withFeature(n, 150, 20, 20, 40) // dip well before startIdx=100
    const extrema = detectChannelExtrema(track, values, 100, n, { mode: 'min', ...LENIENT })
    expect(extrema).toHaveLength(0)
  })

  it('skips invalid (no-fix) samples', () => {
    const n = 100
    const track = straightTrack(n)
    track.valid[50] = 0 // invalidate the exact minimum sample
    const values = withFeature(n, 150, 50, 30, 60)
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'min', ...LENIENT })
    for (const e of extrema) {
      expect(Number.isFinite(e.lat)).toBe(true)
      expect(Number.isFinite(e.lon)).toBe(true)
      expect(track.valid[e.index]).toBe(1)
    }
  })
})

describe('detectChannelExtrema — mode: max (e.g. RPM/G peaks)', () => {
  it('finds no maxima on a flat (constant) signal', () => {
    const n = 100
    const track = straightTrack(n)
    const values = new Float64Array(n).fill(4200)
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'max', ...LENIENT })
    expect(extrema).toHaveLength(0)
  })

  it('finds exactly one maximum for a single bump', () => {
    const n = 100
    const track = straightTrack(n)
    const values = withFeature(n, 4000, 50, 30, 8500) // bump up to 8500 RPM
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'max', ...LENIENT })
    expect(extrema).toHaveLength(1)
    expect(extrema[0].kind).toBe('max')
    expect(extrema[0].value).toBeCloseTo(8500, 0)
  })

  it('separates two bumps into two maxima, ordered by distance', () => {
    const n = 160
    const track = straightTrack(n)
    let values = withFeature(n, 4000, 50, 24, 8000)
    const second = withFeature(n, 4000, 110, 24, 9000)
    values = values.map((v, i) => Math.max(v, second[i]))
    const extrema = detectChannelExtrema(track, values, 0, n, { mode: 'max', ...LENIENT })
    expect(extrema).toHaveLength(2)
    expect(extrema[0].index).toBeLessThan(extrema[1].index)
    expect(extrema[0].value).toBeCloseTo(8000, 0)
    expect(extrema[1].value).toBeCloseTo(9000, 0)
  })
})

describe('detectChannelExtrema — relative default prominence (no explicit minProminence)', () => {
  it('scales with the channel range: same relative bump size detects on a 0-1 G channel and a 0-10000 RPM channel', () => {
    const n = 100
    const gTrack = straightTrack(n)
    const rpmTrack = straightTrack(n)
    // Both bumps are 20% of their own baseline-anchored range.
    const gValues = withFeature(n, 0.5, 50, 20, 0.7) // range ~0.5-0.7 -> baseline+0.2
    const rpmValues = withFeature(n, 5000, 50, 20, 7000) // range ~5000-7000 -> baseline+2000

    const gExtrema = detectChannelExtrema(gTrack, gValues, 0, n, { mode: 'max' })
    const rpmExtrema = detectChannelExtrema(rpmTrack, rpmValues, 0, n, { mode: 'max' })

    expect(gExtrema).toHaveLength(1)
    expect(rpmExtrema).toHaveLength(1)
  })

  it('rejects a bump under ~8% of the range but accepts one further above it', () => {
    const n = 100
    const track = straightTrack(n)
    // A big reference feature establishes the 0-100 range; a tiny secondary
    // bump elsewhere is well under 8% (=8) of that range and should be
    // filtered, while a larger secondary bump should register.
    const baseline = withFeature(n, 0, 20, 10, 100)

    const tiny = new Float64Array(baseline)
    for (let i = 65; i < 75; i++) {
      const t = 1 - Math.abs(i - 70) / 5
      tiny[i] += 3 * Math.max(0, t) // amplitude 3, under the ~8 floor
    }
    const extremaTiny = detectChannelExtrema(track, tiny, 0, n, { mode: 'max' })
    expect(extremaTiny.map((e) => e.index)).toEqual([20])

    const bigger = new Float64Array(baseline)
    for (let i = 65; i < 75; i++) {
      const t = 1 - Math.abs(i - 70) / 5
      bigger[i] += 20 * Math.max(0, t) // amplitude 20, clears the floor
    }
    const extremaBigger = detectChannelExtrema(track, bigger, 0, n, { mode: 'max' })
    expect(extremaBigger.map((e) => e.index)).toEqual([20, 70])
  })

  it('an explicit minProminence override replaces the relative default', () => {
    const n = 100
    const track = straightTrack(n)
    const values = withFeature(n, 0, 50, 10, 5) // small 5-unit bump on a ~5 range
    expect(detectChannelExtrema(track, values, 0, n, { mode: 'max' })).toHaveLength(1)
    expect(detectChannelExtrema(track, values, 0, n, { mode: 'max', minProminence: 100 })).toHaveLength(0)
  })
})

describe('resolveSpeedChannel', () => {
  function fakeSession(channels: string[]): LogSession {
    return { has: (name: string) => channels.includes(name) } as unknown as LogSession
  }

  it('prefers GPS_Speed over Vehicle_Speed', () => {
    expect(resolveSpeedChannel(fakeSession(['GPS_Speed', 'Vehicle_Speed']))).toBe('GPS_Speed')
  })

  it('falls back to Vehicle_Speed', () => {
    expect(resolveSpeedChannel(fakeSession(['Vehicle_Speed']))).toBe('Vehicle_Speed')
  })

  it('returns null when neither is present', () => {
    expect(resolveSpeedChannel(fakeSession([]))).toBeNull()
  })
})
