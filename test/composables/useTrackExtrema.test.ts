import { describe, it, expect } from 'vitest'
import { ref, computed } from 'vue'
import { useTrackExtrema } from '@/composables/useTrackExtrema'
import { LogSession } from '@/domain/model/LogSession'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Channel, LogMeta } from '@/domain/model/types'
import type { Lap } from '@/domain/model/Lap'

const META = {} as LogMeta

function session(channels: Array<{ name: string; data: number[] }>): LogSession {
  const chans: Channel[] = channels.map((c) => ({
    name: c.name,
    rawName: c.name,
    description: undefined,
    data: new Float32Array(c.data),
  }))
  return new LogSession(chans, META)
}

/** Straight-line GPS track (heading due east, stepM per sample) so cumulative
 *  distance is simply index * stepM — mirrors cornerSpeed.test.ts's helper. */
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

/** A signal that is `base` everywhere except for a smooth triangular feature
 *  reaching `apex` at `center` — mirrors cornerSpeed.test.ts's helper. */
function withFeature(n: number, base: number, center: number, halfWidth: number, apex: number): Float32Array {
  const values = new Float32Array(n).fill(base)
  for (let i = 0; i < n; i++) {
    const d = Math.abs(i - center)
    if (d >= halfWidth) continue
    const t = 1 - d / halfWidth
    values[i] = base - (base - apex) * t
  }
  return values
}

const lap = (startIdx: number, endIdx: number): Lap => ({ index: 0, startIdx, endIdx, lapTimeMs: 60000 })

describe('useTrackExtrema', () => {
  it('trackChannelData / trackChannelChosen are null/false when no channel is picked', () => {
    const s = session([{ name: 'RPM', data: [1, 2, 3] }])
    const { trackChannelData, trackChannelChosen } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(3)),
      ref(null),
      ref(null),
      ref(true),
      ref(true),
    )
    expect(trackChannelData.value).toBeNull()
    expect(trackChannelChosen.value).toBe(false)
  })

  it('trackChannelChosen is true once a resolvable channel name is set', () => {
    const s = session([{ name: 'RPM', data: [1, 2, 3] }])
    const { trackChannelData, trackChannelChosen } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(3)),
      ref('RPM'),
      ref(null),
      ref(true),
      ref(true),
    )
    expect(trackChannelData.value?.data).toBeInstanceOf(Float32Array)
    expect(trackChannelChosen.value).toBe(true)
  })

  it('trackExtrema is null when neither markMinima nor markMaxima is enabled', () => {
    const n = 100
    const s = session([{ name: 'RPM', data: Array.from(withFeature(n, 4000, 50, 30, 8000)) }])
    const { trackExtrema } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(lap(0, n)),
      ref(false),
      ref(false),
    )
    expect(trackExtrema.value).toBeNull()
  })

  it('trackExtrema is null when no single lap is focused', () => {
    const n = 100
    const s = session([{ name: 'RPM', data: Array.from(withFeature(n, 4000, 50, 30, 8000)) }])
    const { trackExtrema } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(null), // 0 or 2+ laps selected -> focusedLap resolves to null upstream
      ref(true),
      ref(true),
    )
    expect(trackExtrema.value).toBeNull()
  })

  it('finds a maximum within the focused lap when markMaxima is on', () => {
    const n = 100
    const s = session([{ name: 'RPM', data: Array.from(withFeature(n, 4000, 50, 30, 8000)) }])
    const { trackExtrema } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(lap(0, n)),
      ref(false),
      ref(true),
    )
    expect(trackExtrema.value).toHaveLength(1)
    expect(trackExtrema.value?.[0].kind).toBe('max')
    expect(trackExtrema.value?.[0].value).toBeCloseTo(8000, 0)
  })

  it('finds a minimum within the focused lap when markMinima is on', () => {
    const n = 100
    const s = session([{ name: 'RPM', data: Array.from(withFeature(n, 4000, 50, 30, 1000)) }])
    const { trackExtrema } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(lap(0, n)),
      ref(true),
      ref(false),
    )
    expect(trackExtrema.value).toHaveLength(1)
    expect(trackExtrema.value?.[0].kind).toBe('min')
  })

  it('combines both min and max, sorted by lapDistanceM', () => {
    const n = 160
    const dip = withFeature(n, 4000, 40, 20, 1000) // dip early
    const bump = withFeature(n, 4000, 120, 20, 8000) // peak later
    // Both features are offsets from the same 4000 baseline in disjoint
    // windows, so picking whichever differs more from baseline at each index
    // preserves both features without one flattening the other.
    const data = dip.map((v, i) => (Math.abs(bump[i] - 4000) > Math.abs(v - 4000) ? bump[i] : v))
    const s = session([{ name: 'RPM', data: Array.from(data) }])
    const { trackExtrema } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(lap(0, n)),
      ref(true),
      ref(true),
    )
    expect(trackExtrema.value).toHaveLength(2)
    expect(trackExtrema.value?.[0].kind).toBe('min')
    expect(trackExtrema.value?.[1].kind).toBe('max')
    expect(trackExtrema.value?.[0].lapDistanceM).toBeLessThan(trackExtrema.value?.[1].lapDistanceM ?? Infinity)
  })

  it('mapExtremaMarkers is empty when trackExtrema is null or empty', () => {
    const n = 100
    const s = session([{ name: 'RPM', data: Array.from(new Float32Array(n).fill(4000)) }])
    const { mapExtremaMarkers } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(lap(0, n)),
      ref(true),
      ref(true),
    )
    expect(mapExtremaMarkers.value).toEqual([])
  })

  it('mapExtremaMarkers normalises valueFrac 0..1 within THIS lap\'s own extrema set', () => {
    const n = 160
    const dip = withFeature(n, 4000, 40, 20, 1000) // min value ~1000
    const bump = withFeature(n, 4000, 120, 20, 8000) // max value ~8000
    const data = dip.map((v, i) => (Math.abs(bump[i] - 4000) > Math.abs(v - 4000) ? bump[i] : v))
    const s = session([{ name: 'RPM', data: Array.from(data) }])
    const { mapExtremaMarkers } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(lap(0, n)),
      ref(true),
      ref(true),
    )
    expect(mapExtremaMarkers.value).toHaveLength(2)
    const fracs = mapExtremaMarkers.value.map((m) => m.valueFrac)
    expect(Math.min(...fracs)).toBeCloseTo(0, 1)
    expect(Math.max(...fracs)).toBeCloseTo(1, 1)
    for (const m of mapExtremaMarkers.value) {
      expect(Number.isFinite(m.lat)).toBe(true)
      expect(Number.isFinite(m.lon)).toBe(true)
    }
  })

  it('mapExtremaMarkers gives valueFrac 1 for a degenerate (single-value) extrema set', () => {
    // A single extremum -> span is 0 -> valueFrac falls back to 1 (not NaN).
    const n = 100
    const s = session([{ name: 'RPM', data: Array.from(withFeature(n, 4000, 50, 30, 8000)) }])
    const { mapExtremaMarkers } = useTrackExtrema(
      computed<LogSession | null>(() => s),
      ref(straightTrack(n)),
      ref('RPM'),
      ref(lap(0, n)),
      ref(false),
      ref(true),
    )
    expect(mapExtremaMarkers.value).toHaveLength(1)
    expect(mapExtremaMarkers.value[0].valueFrac).toBe(1)
  })
})
