import { describe, it, expect } from 'vitest'
import {
  nearestSample,
  resolveTrackHitRadius,
  TRACK_HIT_RADIUS_FINE,
  TRACK_HIT_RADIUS_COARSE,
} from '@/features/analyzer/trackNearestSample'

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

// B30b(a) — preferredRanges: two "laps" whose traces sit right next to each
// other (as overlapping laps on a closed-loop track commonly do), simulating
// the reported bug where the globally-nearest sample belongs to a different,
// unselected lap.
describe('nearestSample with preferredRanges', () => {
  // Lap A: indices 0..2, at x = 0, 10, 20 (y = 0).
  // Lap B: indices 3..5, at x = 0, 10, 20 (y = 1) — one px closer to y=0.5 than lap A.
  const px = [0, 10, 20, 0, 10, 20]
  const py = [0, 0, 0, 1, 1, 1]

  it('prefers a sample inside a preferred range over a globally-closer one outside it', () => {
    // Pointer at (10, 0.6): globally nearest is index 4 (dist 0.4) in lap B,
    // but lap A (0..2) is given as the preferred range and index 1 (dist 0.6)
    // is still well within the hit radius, so it wins.
    const preferred = [{ startIdx: 0, endIdx: 2 }]
    expect(nearestSample(px, py, 10, 0.6, 24, preferred)).toBe(1)
  })

  it('falls back to the full-track scan when nothing in the preferred ranges is within radius', () => {
    // A preferred range far from the pointer, with a tight radius that only
    // the (outside-preferred) global nearest sample satisfies.
    const preferred = [{ startIdx: 3, endIdx: 3 }] // just index 3, at (0, 1) — far from (20, 0)
    expect(nearestSample(px, py, 20, 0, 2, preferred)).toBe(2)
  })

  it('behaves exactly like the no-ranges call when preferredRanges is empty', () => {
    expect(nearestSample(px, py, 10, 0.6, 24, [])).toBe(nearestSample(px, py, 10, 0.6, 24))
  })

  it('picks the closest candidate across MULTIPLE preferred ranges, not just the first', () => {
    const preferred = [
      { startIdx: 0, endIdx: 0 }, // (0,0), far from the pointer
      { startIdx: 1, endIdx: 1 }, // (10,0), close to the pointer
    ]
    expect(nearestSample(px, py, 10, 0.6, 24, preferred)).toBe(1)
  })

  it('tolerates reversed [endIdx, startIdx] and out-of-bounds ranges', () => {
    const reversed = [{ startIdx: 2, endIdx: 0 }]
    expect(nearestSample(px, py, 0, 0, 24, reversed)).toBe(0)
    const outOfBounds = [{ startIdx: 99, endIdx: 120 }]
    // No usable preferred candidate → full-track fallback.
    expect(nearestSample(px, py, 0, 0, 24, outOfBounds)).toBe(0)
  })

  it('ignores NaN (no-fix) samples within a preferred range', () => {
    const pxGap = [0, NaN, 20]
    const pyGap = [0, NaN, 0]
    const preferred = [{ startIdx: 0, endIdx: 1 }]
    expect(nearestSample(pxGap, pyGap, 11, 0, 24, preferred)).toBe(0)
  })
})

describe('resolveTrackHitRadius', () => {
  it('returns the fine-pointer radius when no coarse pointer is present', () => {
    expect(resolveTrackHitRadius(false)).toBe(TRACK_HIT_RADIUS_FINE)
  })

  it('returns the larger coarse-pointer radius when any coarse pointer is present', () => {
    expect(resolveTrackHitRadius(true)).toBe(TRACK_HIT_RADIUS_COARSE)
  })

  it('the coarse radius is strictly larger than the fine one', () => {
    expect(TRACK_HIT_RADIUS_COARSE).toBeGreaterThan(TRACK_HIT_RADIUS_FINE)
  })
})
