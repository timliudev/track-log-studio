import { describe, it, expect } from 'vitest'
import { sizeChangedEnoughToApply } from '@/features/analyzer/GgChart.vue'

/**
 * ResizeObserver feedback-loop fix — 1:1 (equalAspect) G-G/scatter charts
 * zoom-pulsed/flickered at some viewport sizes (reported: 1386×949).
 *
 * Root cause: `resize()` calls `render()` in equalAspect mode, and
 * `render()` rebuilds the option's square grid box from the container's
 * CURRENT size — that rebuild can nudge the host element's own measured size
 * by a sub-pixel amount, which re-fires the ResizeObserver → resize() →
 * render() → relayout → observer … forever. `sizeChangedEnoughToApply` is
 * the guard that breaks the loop: it compares a fresh measurement against
 * the size last actually APPLIED to the chart and reports "no" for anything
 * under a 1px-per-axis threshold (the echo), "yes" for anything at or above
 * it (a genuine resize).
 */
describe('sizeChangedEnoughToApply (ResizeObserver feedback-loop guard)', () => {
  it('always applies when there is no prior applied size (first measurement)', () => {
    expect(sizeChangedEnoughToApply(null, { width: 800, height: 600 })).toBe(true)
  })

  it('skips when the new measurement is identical to the last applied size', () => {
    const size = { width: 742, height: 742 }
    expect(sizeChangedEnoughToApply(size, { ...size })).toBe(false)
  })

  it('skips a sub-pixel echo on either axis (the render()-relayout nudge)', () => {
    const applied = { width: 742.3, height: 742.3 }
    expect(sizeChangedEnoughToApply(applied, { width: 742.6, height: 742.3 })).toBe(false)
    expect(sizeChangedEnoughToApply(applied, { width: 742.3, height: 742.9 })).toBe(false)
    expect(sizeChangedEnoughToApply(applied, { width: 742.9, height: 742.9 })).toBe(false)
  })

  it('applies once either axis moves by a full pixel or more', () => {
    const applied = { width: 742, height: 742 }
    expect(sizeChangedEnoughToApply(applied, { width: 743, height: 742 })).toBe(true)
    expect(sizeChangedEnoughToApply(applied, { width: 742, height: 741 })).toBe(true)
  })

  it('applies for a genuine large resize (e.g. a real window/card resize)', () => {
    const applied = { width: 742, height: 742 }
    expect(sizeChangedEnoughToApply(applied, { width: 1386, height: 949 })).toBe(true)
  })

  it('respects a custom threshold', () => {
    const applied = { width: 100, height: 100 }
    expect(sizeChangedEnoughToApply(applied, { width: 102, height: 100 }, 5)).toBe(false)
    expect(sizeChangedEnoughToApply(applied, { width: 106, height: 100 }, 5)).toBe(true)
  })
})
