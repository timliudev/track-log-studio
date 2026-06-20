import { describe, it, expect } from 'vitest'
import {
  COLORMAP_IDS,
  sampleColormap,
  colormapSwatches,
} from '@/domain/analysis/colormap'

describe('sampleColormap', () => {
  it('returns the first stop at t=0 and the last at t=1', () => {
    // turbo low stop [48,18,59], high stop [122,4,3]
    expect(sampleColormap('turbo', 0)).toBe('rgb(48, 18, 59)')
    expect(sampleColormap('turbo', 1)).toBe('rgb(122, 4, 3)')
  })

  it('linearly interpolates between adjacent stops', () => {
    // coolwarm has 5 stops; t=0.5 lands exactly on the middle stop [220,220,220]
    expect(sampleColormap('coolwarm', 0.5)).toBe('rgb(220, 220, 220)')
  })

  it('clamps out-of-range and treats non-finite t as 0', () => {
    expect(sampleColormap('viridis', -1)).toBe(sampleColormap('viridis', 0))
    expect(sampleColormap('viridis', 2)).toBe(sampleColormap('viridis', 1))
    expect(sampleColormap('viridis', NaN)).toBe(sampleColormap('viridis', 0))
  })

  it('produces valid rgb() strings across the range for every colormap', () => {
    for (const id of COLORMAP_IDS) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(sampleColormap(id, t)).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/)
      }
    }
  })
})

describe('colormapSwatches', () => {
  it('returns `steps` colours spanning the colormap, low → high', () => {
    const s = colormapSwatches('turbo', 5)
    expect(s).toHaveLength(5)
    expect(s[0]).toBe(sampleColormap('turbo', 0))
    expect(s[4]).toBe(sampleColormap('turbo', 1))
  })

  it('returns the low colour for a single step (no divide-by-zero)', () => {
    expect(colormapSwatches('plasma', 1)).toEqual([sampleColormap('plasma', 0)])
  })
})
