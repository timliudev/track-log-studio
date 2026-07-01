import { describe, it, expect } from 'vitest'
import { xRangeToFocusIndices } from '@/domain/analysis/focusRange'

// 101 samples, xValues = 0..100 (step 1), so index i === value i — makes the
// expected index ranges easy to reason about.
const XVALUES = new Float64Array(Array.from({ length: 101 }, (_, i) => i))

describe('xRangeToFocusIndices', () => {
  it('returns null when there is no active range (auto/full view)', () => {
    expect(xRangeToFocusIndices(null, XVALUES)).toBeNull()
  })

  it('returns null when xValues is unavailable', () => {
    expect(xRangeToFocusIndices({ min: 10, max: 20 }, null)).toBeNull()
  })

  it('returns null when xValues has fewer than 2 samples', () => {
    expect(xRangeToFocusIndices({ min: 0, max: 1 }, new Float64Array([5]))).toBeNull()
  })

  it('converts a genuine sub-range to its bounding index range', () => {
    expect(xRangeToFocusIndices({ min: 10, max: 20 }, XVALUES)).toEqual({ startIdx: 10, endIdx: 20 })
  })

  it('converts a small sub-range near the start', () => {
    expect(xRangeToFocusIndices({ min: 0, max: 5 }, XVALUES)).toEqual({ startIdx: 0, endIdx: 5 })
  })

  it('converts a small sub-range near the end', () => {
    expect(xRangeToFocusIndices({ min: 95, max: 100 }, XVALUES)).toEqual({ startIdx: 95, endIdx: 100 })
  })

  it('clamps a range that overshoots the data bounds', () => {
    expect(xRangeToFocusIndices({ min: -50, max: 20 }, XVALUES)).toEqual({ startIdx: 0, endIdx: 20 })
  })

  it('rounds to the nearest bounding samples for a non-integer range', () => {
    // xValues are integers 0..100; a range of [10.4, 19.6] should bound to
    // the smallest containing index span: [11, 19].
    expect(xRangeToFocusIndices({ min: 10.4, max: 19.6 }, XVALUES)).toEqual({ startIdx: 11, endIdx: 19 })
  })

  it('treats a range covering (nearly) the whole session as no focus', () => {
    expect(xRangeToFocusIndices({ min: 0, max: 100 }, XVALUES)).toBeNull()
    // within the slack of full extent still counts as "whole session"
    expect(xRangeToFocusIndices({ min: 0.5, max: 100 }, XVALUES)).toBeNull()
  })

  it('treats a range just outside the whole-session slack as a real focus', () => {
    // > 2% off the full span should NOT be treated as "whole session".
    expect(xRangeToFocusIndices({ min: 5, max: 100 }, XVALUES)).toEqual({ startIdx: 5, endIdx: 100 })
  })

  it('returns null for a degenerate (single-sample) resolved range', () => {
    expect(xRangeToFocusIndices({ min: 10, max: 10.4 }, XVALUES)).toBeNull()
  })

  it('handles a distance-axis xValues array (non-unit step, still monotonic)', () => {
    const dist = new Float64Array([0, 2.5, 6, 6.5, 20, 45, 90, 91, 200])
    // range covers indices [2..6] inclusive (values 6..90)
    expect(xRangeToFocusIndices({ min: 6, max: 90 }, dist)).toEqual({ startIdx: 2, endIdx: 6 })
  })
})
