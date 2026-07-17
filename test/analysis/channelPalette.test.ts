import { describe, expect, it } from 'vitest'
import {
  CHANNEL_COLORS_DARK,
  CHANNEL_COLORS_LIGHT,
  channelColor,
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
})
