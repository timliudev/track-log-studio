import { describe, it, expect } from 'vitest'
import { nearestSample } from '@/features/analyzer/trackNearestSample'

describe('nearestSample', () => {
  const px = [0, 10, 20, 30]
  const py = [0, 0, 0, 0]

  it('returns the index of the closest sample within the hit radius', () => {
    expect(nearestSample(px, py, 9, 0, 24)).toBe(1)
    expect(nearestSample(px, py, 11, 0, 24)).toBe(1)
    expect(nearestSample(px, py, 21, 0, 24)).toBe(2)
  })

  it('returns null when nothing is within the hit radius', () => {
    expect(nearestSample(px, py, 100, 100, 24)).toBeNull()
  })

  it('returns the exact index when the pointer sits on a sample', () => {
    expect(nearestSample(px, py, 30, 0, 24)).toBe(3)
  })

  it('skips NaN (no-fix) samples', () => {
    const pxWithGap = [0, NaN, 20, 30]
    const pyWithGap = [0, NaN, 0, 0]
    // Nearest to x=11 would be index 1, but it has no fix — falls through
    // to index 2 (or 0), whichever is actually closer.
    expect(nearestSample(pxWithGap, pyWithGap, 11, 0, 24)).toBe(2)
  })

  it('respects a tighter hit radius', () => {
    expect(nearestSample(px, py, 15, 0, 4)).toBeNull()
    expect(nearestSample(px, py, 15, 0, 6)).not.toBeNull()
  })

  it('returns null for an empty sample set', () => {
    expect(nearestSample([], [], 0, 0, 24)).toBeNull()
  })

  it('picks the first-encountered index on an exact tie', () => {
    const pxTie = [0, 20]
    const pyTie = [0, 0]
    expect(nearestSample(pxTie, pyTie, 10, 0, 24)).toBe(0)
  })
})
