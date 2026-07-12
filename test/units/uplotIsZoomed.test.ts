import { describe, it, expect } from 'vitest'
import { isZoomed } from '@/components/UPlotChart.vue'

/**
 * B9 — "重設縮放" control: the reset-zoom button (UPlotChart.vue) is shown
 * only while the chart's current x range is a real zoom relative to the full
 * data extent. `isZoomed` is the pure predicate behind that — see its doc in
 * UPlotChart.vue for why a float-precision epsilon is needed (a
 * reset-to-bounds `setScale` can land a hair off the exact bounds values).
 */
describe('isZoomed (B9 — reset-zoom button visibility)', () => {
  it('is false at exactly the full extent', () => {
    expect(isZoomed({ min: 0, max: 100 }, { min: 0, max: 100 })).toBe(false)
  })

  it('is true for a narrower range on either side', () => {
    expect(isZoomed({ min: 10, max: 100 }, { min: 0, max: 100 })).toBe(true)
    expect(isZoomed({ min: 0, max: 90 }, { min: 0, max: 100 })).toBe(true)
    expect(isZoomed({ min: 20, max: 80 }, { min: 0, max: 100 })).toBe(true)
  })

  it('is false when there is no data yet (null bounds)', () => {
    expect(isZoomed({ min: 10, max: 20 }, null)).toBe(false)
  })

  it('tolerates float-precision slop right at the bounds (within the epsilon)', () => {
    const bounds = { min: 0, max: 100 }
    expect(isZoomed({ min: 1e-9, max: 100 - 1e-9 }, bounds)).toBe(false)
  })

  it('is false for a degenerate (zero-width) bounds matched exactly', () => {
    // span <= 0 -> eps collapses to 0; an exactly-matching range is still "not
    // zoomed" (there's no narrower sub-range of a zero-width extent).
    expect(isZoomed({ min: 5, max: 5 }, { min: 5, max: 5 })).toBe(false)
  })

  it('honours a custom epsilon fraction', () => {
    const bounds = { min: 0, max: 1000 }
    // 1 unit off of 1000 is 0.1% — outside the default 1e-6 epsilon (zoomed),
    // but within a looser 1% (0.01) epsilon (not zoomed).
    expect(isZoomed({ min: 1, max: 1000 }, bounds)).toBe(true)
    expect(isZoomed({ min: 1, max: 1000 }, bounds, 0.01)).toBe(false)
  })
})
