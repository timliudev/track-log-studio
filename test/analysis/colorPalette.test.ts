import { describe, it, expect } from 'vitest'
import { CATEGORICAL_COLORS, categoricalColor } from '@/domain/analysis/colorPalette'
import { LAP_COLORS, lapColor } from '@/features/analyzer/lapColors'

describe('categoricalColor', () => {
  it('cycles through the palette by index', () => {
    for (let i = 0; i < CATEGORICAL_COLORS.length; i++) {
      expect(categoricalColor(i)).toBe(CATEGORICAL_COLORS[i])
    }
    expect(categoricalColor(CATEGORICAL_COLORS.length)).toBe(CATEGORICAL_COLORS[0])
  })

  it('wraps negative indices the same way (no negative-modulo bug)', () => {
    expect(categoricalColor(-1)).toBe(CATEGORICAL_COLORS[CATEGORICAL_COLORS.length - 1])
  })
})

describe('lapColors re-export (features/analyzer/lapColors.ts)', () => {
  it('LAP_COLORS is the same palette as CATEGORICAL_COLORS (single source, no duplicate)', () => {
    expect(LAP_COLORS).toBe(CATEGORICAL_COLORS)
  })

  it('lapColor delegates straight to categoricalColor', () => {
    expect(lapColor(3)).toBe(categoricalColor(3))
  })
})
