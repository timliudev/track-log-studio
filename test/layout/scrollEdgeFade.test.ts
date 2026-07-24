import { describe, it, expect } from 'vitest'
import { computeScrollEdgeFade } from '@/domain/layout/scrollEdgeFade'

describe('computeScrollEdgeFade', () => {
  it('shows neither fade when content fits entirely (scrollWidth <= clientWidth)', () => {
    expect(computeScrollEdgeFade({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })).toEqual({
      canScrollLeft: false,
      canScrollRight: false,
    })
    expect(computeScrollEdgeFade({ scrollLeft: 0, scrollWidth: 200, clientWidth: 300 })).toEqual({
      canScrollLeft: false,
      canScrollRight: false,
    })
  })

  it('shows neither fade for a not-yet-laid-out element (all zeros)', () => {
    expect(computeScrollEdgeFade({ scrollLeft: 0, scrollWidth: 0, clientWidth: 0 })).toEqual({
      canScrollLeft: false,
      canScrollRight: false,
    })
  })

  it('shows only the RIGHT fade when scrolled fully to the start', () => {
    expect(computeScrollEdgeFade({ scrollLeft: 0, scrollWidth: 600, clientWidth: 300 })).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
    })
  })

  it('shows only the LEFT fade when scrolled fully to the end', () => {
    expect(computeScrollEdgeFade({ scrollLeft: 300, scrollWidth: 600, clientWidth: 300 })).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
    })
  })

  it('shows BOTH fades in the middle of a scrollable bar', () => {
    expect(computeScrollEdgeFade({ scrollLeft: 150, scrollWidth: 600, clientWidth: 300 })).toEqual({
      canScrollLeft: true,
      canScrollRight: true,
    })
  })

  it('absorbs sub-pixel rounding noise at either edge via epsilon', () => {
    // 0.4px short of the true max — real browsers report exactly this kind
    // of fractional residue under DPR scaling; must NOT read as "can scroll
    // right" (flicker).
    expect(computeScrollEdgeFade({ scrollLeft: 299.6, scrollWidth: 600, clientWidth: 300 })).toEqual({
      canScrollLeft: true,
      canScrollRight: false,
    })
    // 0.4px past the start — must NOT read as "can scroll left".
    expect(computeScrollEdgeFade({ scrollLeft: 0.4, scrollWidth: 600, clientWidth: 300 })).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
    })
  })

  it('respects a custom epsilon', () => {
    expect(computeScrollEdgeFade({ scrollLeft: 5, scrollWidth: 600, clientWidth: 300 }, 10)).toEqual({
      canScrollLeft: false,
      canScrollRight: true,
    })
  })
})
