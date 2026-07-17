import { describe, expect, it } from 'vitest'
import {
  CHANNEL_COLORS_DARK,
  CHANNEL_COLORS_LIGHT,
  channelColor,
  channelSeriesColor,
  chartColorContrast,
} from '@/domain/analysis/channelPalette'

describe('chart channel palette', () => {
  it('cycles stable per-channel colours independently for light and dark themes', () => {
    expect(channelColor(0, 'light')).toBe(CHANNEL_COLORS_LIGHT[0])
    expect(channelColor(CHANNEL_COLORS_LIGHT.length, 'light')).toBe(CHANNEL_COLORS_LIGHT[0])
    expect(channelColor(-1, 'dark')).toBe(CHANNEL_COLORS_DARK.at(-1))
  })

  it('keeps every palette colour at least 3:1 against its chart surface', () => {
    for (const color of CHANNEL_COLORS_LIGHT) {
      expect(chartColorContrast(color, '#ffffff')).toBeGreaterThanOrEqual(3)
    }
    for (const color of CHANNEL_COLORS_DARK) {
      expect(chartColorContrast(color, '#181b21')).toBeGreaterThanOrEqual(3)
    }
  })

  it('cycles stable same-hue trace variants without reducing surface contrast', () => {
    expect(channelSeriesColor(0, 0, 'light')).toBe(channelColor(0, 'light'))
    expect(channelSeriesColor(0, 1, 'light')).not.toBe(channelColor(0, 'light'))
    expect(channelSeriesColor(0, 1, 'light')).toBe(channelSeriesColor(0, 5, 'light'))
    expect(channelSeriesColor(2, -1, 'dark')).toBe(channelSeriesColor(2, 3, 'dark'))

    for (const theme of ['light', 'dark'] as const) {
      const surface = theme === 'light' ? '#ffffff' : '#181b21'
      for (let channel = 0; channel < CHANNEL_COLORS_LIGHT.length; channel++) {
        for (let trace = 0; trace < 4; trace++) {
          expect(chartColorContrast(channelSeriesColor(channel, trace, theme), surface)).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})
