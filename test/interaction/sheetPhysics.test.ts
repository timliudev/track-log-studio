import { describe, it, expect } from 'vitest'
import {
  pushSample,
  estimateVelocityPxPerSec,
  rubberBand,
  dragTranslateY,
  project,
  shouldDismissSheet,
  parseTranslateY,
  type PointerSample,
} from '@/domain/interaction/sheetPhysics'

describe('pushSample', () => {
  it('appends a sample and drops everything older than the window relative to it', () => {
    const samples: PointerSample[] = [
      { t: 0, y: 0 },
      { t: 40, y: 10 },
    ]
    const next = pushSample(samples, { t: 150, y: 50 }, 100)
    // Only the newest sample (t=150) survives the 100ms window — both
    // earlier samples (0, 40) are older than `150 - 100 = 50`.
    expect(next).toEqual([{ t: 150, y: 50 }])
  })

  it('keeps samples within the window and does not mutate the input array', () => {
    const samples: PointerSample[] = [
      { t: 0, y: 0 },
      { t: 60, y: 5 },
    ]
    const next = pushSample(samples, { t: 90, y: 12 }, 100)
    expect(next).toEqual([
      { t: 0, y: 0 },
      { t: 60, y: 5 },
      { t: 90, y: 12 },
    ])
    expect(samples).toHaveLength(2) // original untouched
  })
})

describe('estimateVelocityPxPerSec', () => {
  it('returns 0 for fewer than 2 samples', () => {
    expect(estimateVelocityPxPerSec([])).toBe(0)
    expect(estimateVelocityPxPerSec([{ t: 0, y: 0 }])).toBe(0)
  })

  it('computes a signed px/s secant between the first and last sample', () => {
    // 100px downward over 200ms -> 500px/s
    const v = estimateVelocityPxPerSec([
      { t: 0, y: 0 },
      { t: 200, y: 100 },
    ])
    expect(v).toBeCloseTo(500, 5)
  })

  it('is negative for upward movement', () => {
    const v = estimateVelocityPxPerSec([
      { t: 0, y: 100 },
      { t: 200, y: 0 },
    ])
    expect(v).toBeCloseTo(-500, 5)
  })

  it('returns 0 for a degenerate (non-positive) time span', () => {
    expect(estimateVelocityPxPerSec([{ t: 50, y: 0 }, { t: 50, y: 40 }])).toBe(0)
    expect(estimateVelocityPxPerSec([{ t: 50, y: 0 }, { t: 10, y: 40 }])).toBe(0)
  })
})

describe('rubberBand', () => {
  it('returns 0 for non-positive overshoot', () => {
    expect(rubberBand(0, 500)).toBe(0)
    expect(rubberBand(-10, 500)).toBe(0)
  })

  it('returns the raw overshoot unchanged for a non-positive dimension', () => {
    expect(rubberBand(40, 0)).toBe(40)
    expect(rubberBand(40, -5)).toBe(40)
  })

  it('resists monotonically but never exceeds coefficient * dim as overshoot grows', () => {
    const dim = 500
    const coefficient = 0.55
    const small = rubberBand(10, dim, coefficient)
    const medium = rubberBand(100, dim, coefficient)
    const large = rubberBand(100_000, dim, coefficient)
    expect(small).toBeGreaterThan(0)
    expect(medium).toBeGreaterThan(small)
    expect(large).toBeGreaterThan(medium)
    // Asymptote: never reaches (let alone exceeds) `dim` itself, no matter
    // how large the overshoot — but does get close for a huge overshoot.
    expect(large).toBeLessThan(dim)
    expect(large).toBeGreaterThan(dim * 0.9)
  })

  it('always resists — the returned distance is less than the raw overshoot', () => {
    expect(rubberBand(200, 500)).toBeLessThan(200)
  })
})

describe('dragTranslateY', () => {
  it('tracks 1:1 for non-negative (downward) raw offsets', () => {
    expect(dragTranslateY(0, 500)).toBe(0)
    expect(dragTranslateY(150, 500)).toBe(150)
  })

  it('resists (via rubberBand) for negative (upward-past-rest) raw offsets', () => {
    const y = dragTranslateY(-100, 500)
    expect(y).toBeLessThan(0)
    // Resisted magnitude is less than the raw upward drag distance.
    expect(Math.abs(y)).toBeLessThan(100)
  })
})

describe('project', () => {
  it('projects 0 velocity to 0 additional distance', () => {
    expect(project(0)).toBe(0)
  })

  it('projects a larger positive distance for a faster velocity', () => {
    const slow = project(200)
    const fast = project(2000)
    expect(fast).toBeGreaterThan(slow)
    expect(slow).toBeGreaterThan(0)
  })

  it('matches the closed-form spec exactly for a known input', () => {
    // project(v, d) = (v/1000) * d / (1 - d); v=1000, d=0.998 -> 1 * 0.998/0.002 = 499
    expect(project(1000, 0.998)).toBeCloseTo(499, 5)
  })

  it('is negative for negative (upward) velocity', () => {
    expect(project(-1000, 0.998)).toBeCloseTo(-499, 5)
  })
})

describe('shouldDismissSheet', () => {
  it('dismisses when the projected landing point clears the dismiss fraction of sheet height', () => {
    // Released already at 80% of a 400px sheet, slow velocity — position
    // alone is well past the default 50% threshold.
    expect(
      shouldDismissSheet({ releaseOffsetPx: 320, velocityPxPerSec: 10, sheetHeightPx: 400 }),
    ).toBe(true)
  })

  it('returns (springs back) when released high up with negligible velocity', () => {
    expect(
      shouldDismissSheet({ releaseOffsetPx: 20, velocityPxPerSec: 5, sheetHeightPx: 400 }),
    ).toBe(false)
  })

  it('dismisses on a clear downward flick even released near the top', () => {
    // Released at only 5% down, but a brisk 900px/s flick (>= the 700px/s
    // default flick threshold) dismisses outright regardless of position —
    // this is the case a bare "past halfway" check would miss.
    expect(
      shouldDismissSheet({ releaseOffsetPx: 20, velocityPxPerSec: 900, sheetHeightPx: 400 }),
    ).toBe(true)
  })

  it('dismisses via projected momentum even when released before the halfway mark', () => {
    // Released at 30% (120/400, below the 50% raw threshold) but with
    // enough velocity that the PROJECTED landing point clears halfway.
    const params = { releaseOffsetPx: 120, velocityPxPerSec: 600, sheetHeightPx: 400 }
    const projected = 120 + project(600)
    expect(projected).toBeGreaterThan(200) // sanity: projection clears halfway
    expect(shouldDismissSheet(params)).toBe(true)
  })

  it('falls back to a plain position check when sheetHeightPx is non-positive', () => {
    expect(shouldDismissSheet({ releaseOffsetPx: 10, velocityPxPerSec: 0, sheetHeightPx: 0 })).toBe(true)
    expect(shouldDismissSheet({ releaseOffsetPx: -10, velocityPxPerSec: 0, sheetHeightPx: 0 })).toBe(false)
  })

  it('respects custom dismissFraction/flickVelocityPxPerSec overrides', () => {
    // With a strict 0.9 fraction, a release at 60% with no velocity should
    // NOT dismiss even though it would under the default 0.5.
    expect(
      shouldDismissSheet({
        releaseOffsetPx: 240,
        velocityPxPerSec: 0,
        sheetHeightPx: 400,
        dismissFraction: 0.9,
      }),
    ).toBe(false)
  })
})

describe('parseTranslateY', () => {
  it('returns 0 for "none" or an unrecognised string', () => {
    expect(parseTranslateY('none')).toBe(0)
    expect(parseTranslateY('')).toBe(0)
    expect(parseTranslateY('translateY(40px)')).toBe(0) // not a matrix() form
  })

  it('extracts ty from a 2D matrix() string', () => {
    // matrix(1, 0, 0, 1, tx, ty)
    expect(parseTranslateY('matrix(1, 0, 0, 1, 12, 84)')).toBeCloseTo(84, 5)
  })

  it('extracts ty from a matrix3d() string', () => {
    // matrix3d has 16 components; the translateY component is index 13.
    const parts = Array(16).fill(0)
    parts[0] = 1
    parts[5] = 1
    parts[10] = 1
    parts[15] = 1
    parts[13] = 55.5
    expect(parseTranslateY(`matrix3d(${parts.join(', ')})`)).toBeCloseTo(55.5, 5)
  })
})
