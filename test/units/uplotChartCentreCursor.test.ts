import { describe, it, expect } from 'vitest'
import { centreCursorIndex } from '@/components/UPlotChart.vue'

/**
 * B31 — RaceChrono-style fixed centre-needle mode: `centreCursorIndex` is the
 * pure "visible range → sample index under the fixed needle" resolver behind
 * it (see its doc in UPlotChart.vue). This app never uses a log X scale, so
 * the needle's data value is always exactly the midpoint of the current
 * visible range — no live uPlot instance needed to compute it.
 */
describe('centreCursorIndex (B31 — fixed centre-needle mode)', () => {
  it('resolves to the sample nearest the midpoint of the visible range', () => {
    const xs = [0, 10, 20, 30, 40, 50]
    // midpoint of [0,50] is 25 — nearest samples are 20 (idx 2) and 30 (idx 3),
    // equidistant; nearestXIndex's tie-break picks the LEFT one (see its own doc).
    expect(centreCursorIndex(xs, { min: 0, max: 50 })).toBe(2)
  })

  it('follows the visible range as it pans (e.g. after a drag)', () => {
    const xs = [0, 10, 20, 30, 40, 50]
    // Panned window [20,40] -> midpoint 30 -> exact sample at idx 3.
    expect(centreCursorIndex(xs, { min: 20, max: 40 })).toBe(3)
  })

  it('picks the closer sample when the midpoint sits off-grid', () => {
    const xs = [0, 10, 20, 30, 40, 50]
    // midpoint of [0,44] is 22 -> nearest is 20 (idx 2), closer than 30.
    expect(centreCursorIndex(xs, { min: 0, max: 44 })).toBe(2)
    // midpoint of [0,56] is 28 -> nearest is 30 (idx 3), closer than 20.
    expect(centreCursorIndex(xs, { min: 0, max: 56 })).toBe(3)
  })

  it('clamps to the first/last sample when the midpoint is outside the data extent', () => {
    const xs = [10, 20, 30]
    expect(centreCursorIndex(xs, { min: -100, max: -50 })).toBe(0)
    expect(centreCursorIndex(xs, { min: 100, max: 200 })).toBe(2)
  })

  it('returns null for an empty data array', () => {
    expect(centreCursorIndex([], { min: 0, max: 100 })).toBeNull()
  })

  it('resolves a single-sample array to that sample regardless of range', () => {
    expect(centreCursorIndex([42], { min: 0, max: 100 })).toBe(0)
  })
})
