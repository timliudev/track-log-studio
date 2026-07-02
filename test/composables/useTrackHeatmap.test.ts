import { describe, it, expect } from 'vitest'
import { ref, computed } from 'vue'
import { useTrackHeatmap } from '@/composables/useTrackHeatmap'
import { LogSession } from '@/domain/model/LogSession'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Channel, LogMeta } from '@/domain/model/types'
import type { ColormapId } from '@/domain/analysis/colormap'

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

function track(valid: number[]): GpsTrack {
  return {
    lat: new Float64Array(valid.length),
    lon: new Float64Array(valid.length),
    valid: new Uint8Array(valid),
  }
}

describe('useTrackHeatmap', () => {
  it('returns null heatNorm/colorValues when trackColorEnabled is false', () => {
    const s = session([{ name: 'RPM', data: [1000, 2000, 3000] }])
    const { heatNorm, colorValues } = useTrackHeatmap(
      computed<LogSession | null>(() => s),
      ref(track([1, 1, 1])),
      ref('RPM'),
      ref<ColormapId>('turbo'),
      ref(false),
    )
    expect(heatNorm.value).toBeNull()
    expect(colorValues.value).toBeNull()
  })

  it('returns null when no channel is chosen', () => {
    const s = session([{ name: 'RPM', data: [1000, 2000, 3000] }])
    const { heatNorm, colorValues } = useTrackHeatmap(
      computed<LogSession | null>(() => s),
      ref(track([1, 1, 1])),
      ref(null),
      ref<ColormapId>('turbo'),
      ref(true),
    )
    expect(heatNorm.value).toBeNull()
    expect(colorValues.value).toBeNull()
  })

  it('returns null when track is absent', () => {
    const s = session([{ name: 'RPM', data: [1000, 2000, 3000] }])
    const { heatNorm, colorValues } = useTrackHeatmap(
      computed<LogSession | null>(() => s),
      ref(null),
      ref('RPM'),
      ref<ColormapId>('turbo'),
      ref(true),
    )
    expect(heatNorm.value).toBeNull()
    expect(colorValues.value).toBeNull()
  })

  it('normalises the chosen channel over the track when enabled', () => {
    const s = session([{ name: 'RPM', data: [1000, 2000, 3000] }])
    const { heatNorm, colorValues } = useTrackHeatmap(
      computed<LogSession | null>(() => s),
      ref(track([1, 1, 1])),
      ref('RPM'),
      ref<ColormapId>('turbo'),
      ref(true),
    )
    expect(heatNorm.value).not.toBeNull()
    expect(heatNorm.value?.min).toBe(1000)
    expect(heatNorm.value?.max).toBe(3000)
    expect(Array.from(colorValues.value ?? [])).toEqual([0, 0.5, 1])
  })

  it('legendGradient reflects the active colormap and rebuilds when it changes', () => {
    const s = session([{ name: 'RPM', data: [1000, 2000, 3000] }])
    const colormap = ref<ColormapId>('turbo')
    const { legendGradient } = useTrackHeatmap(
      computed<LogSession | null>(() => s),
      ref(track([1, 1, 1])),
      ref('RPM'),
      colormap,
      ref(true),
    )
    const turboGradient = legendGradient.value
    expect(turboGradient).toContain('linear-gradient(to right,')
    colormap.value = 'viridis'
    expect(legendGradient.value).not.toBe(turboGradient)
  })

  describe('fmtVal', () => {
    it('formats small magnitudes with 2 decimals', () => {
      const { fmtVal } = useTrackHeatmap(ref(null), ref(null), ref(null), ref<ColormapId>('turbo'), ref(false))
      expect(fmtVal(1.2345)).toBe('1.23')
    })

    it('formats medium magnitudes with 1 decimal', () => {
      const { fmtVal } = useTrackHeatmap(ref(null), ref(null), ref(null), ref<ColormapId>('turbo'), ref(false))
      expect(fmtVal(42.567)).toBe('42.6')
    })

    it('formats large magnitudes with 0 decimals', () => {
      const { fmtVal } = useTrackHeatmap(ref(null), ref(null), ref(null), ref<ColormapId>('turbo'), ref(false))
      expect(fmtVal(1234.5)).toBe('1235')
    })

    it('formats non-finite values as an em dash', () => {
      const { fmtVal } = useTrackHeatmap(ref(null), ref(null), ref(null), ref<ColormapId>('turbo'), ref(false))
      expect(fmtVal(NaN)).toBe('—')
      expect(fmtVal(Infinity)).toBe('—')
    })
  })
})
