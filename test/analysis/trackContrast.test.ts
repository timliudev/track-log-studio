import { describe, expect, it } from 'vitest'
import {
  meanCompositedLuminance,
  parseCssRgb,
  relativeLuminance,
  resolveTrackContrast,
  TRACK_CONTRAST_DARK,
  TRACK_CONTRAST_LIGHT,
} from '@/domain/analysis/trackContrast'

describe('track background contrast', () => {
  it('parses app theme colour forms and computes ordered luminance', () => {
    expect(parseCssRgb('#fff')).toEqual([255, 255, 255])
    expect(parseCssRgb('#102030')).toEqual([16, 32, 48])
    expect(parseCssRgb('rgb(1, 2, 3)')).toEqual([1, 2, 3])
    expect(relativeLuminance([255, 255, 255])).toBeGreaterThan(relativeLuminance([17, 17, 17]))
  })

  it('composites transparent uploaded-image samples over the canvas colour', () => {
    const transparentWhite = new Uint8ClampedArray([255, 255, 255, 0])
    expect(meanCompositedLuminance(transparentWhite, [0, 0, 0])).toBeCloseTo(0)
    const opaqueWhite = new Uint8ClampedArray([255, 255, 255, 255])
    expect(meanCompositedLuminance(opaqueWhite, [0, 0, 0])).toBeCloseTo(1)
  })

  it('uses actual canvas/image brightness for none and local-image backgrounds', () => {
    expect(resolveTrackContrast('none', null, 1)).toEqual({ inner: TRACK_CONTRAST_DARK, casing: TRACK_CONTRAST_LIGHT })
    expect(resolveTrackContrast('none', null, 0)).toEqual({ inner: TRACK_CONTRAST_LIGHT, casing: TRACK_CONTRAST_DARK })
    expect(resolveTrackContrast('image', 0.9, 0)).toEqual({ inner: TRACK_CONTRAST_DARK, casing: TRACK_CONTRAST_LIGHT })
    expect(resolveTrackContrast('image', 0.1, 1)).toEqual({ inner: TRACK_CONTRAST_LIGHT, casing: TRACK_CONTRAST_DARK })
  })

  it('uses CORS-safe provider priors for remote tiles while retaining opposite casing', () => {
    // Deliberately contradictory sampled/canvas values prove remote kinds do
    // not depend on a forbidden tile pixel read.
    expect(resolveTrackContrast('osm', 0, 0)).toEqual({ inner: TRACK_CONTRAST_DARK, casing: TRACK_CONTRAST_LIGHT })
    expect(resolveTrackContrast('satellite', 1, 1)).toEqual({ inner: TRACK_CONTRAST_LIGHT, casing: TRACK_CONTRAST_DARK })
  })
})
