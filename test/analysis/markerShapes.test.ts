import { describe, it, expect } from 'vitest'
import { MARKER_SHAPES, markerShapeForIndex } from '@/domain/analysis/markerShapes'

describe('markerShapeForIndex (B25 file-identity marker shapes)', () => {
  it('assigns the first shape (circle) to index 0, i.e. the primary file', () => {
    expect(markerShapeForIndex(0)).toBe('circle')
    expect(MARKER_SHAPES[0]).toBe('circle')
  })

  it('cycles through the shape palette by index', () => {
    for (let i = 0; i < MARKER_SHAPES.length; i++) {
      expect(markerShapeForIndex(i)).toBe(MARKER_SHAPES[i])
    }
    expect(markerShapeForIndex(MARKER_SHAPES.length)).toBe(MARKER_SHAPES[0])
  })

  it('wraps negative indices the same way as categoricalColor (no negative-modulo bug)', () => {
    expect(markerShapeForIndex(-1)).toBe(MARKER_SHAPES[MARKER_SHAPES.length - 1])
  })

  it('has more than one shape so a second file is visibly distinguishable', () => {
    expect(MARKER_SHAPES.length).toBeGreaterThan(1)
  })
})
