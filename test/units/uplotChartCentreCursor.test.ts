import { describe, it, expect } from 'vitest'
import { centreCursorIndex, needleOffsetX, valueAtPlotX } from '@/components/UPlotChart.vue'

/**
 * B31b — "固定中線模式 unusable — 一點用都沒有、還是歪的". Two of the three
 * suspects investigated (see UPlotChart.vue's B31b comments): the needle's
 * OWN pixel position (`needleOffsetX`) and the sample-under-needle read
 * (`valueAtPlotX`/`centreCursorIndex`) were both already mathematically
 * correct — pinned here as regression tests. The ACTUAL bug was suspect #3:
 * uPlot's native drag-to-zoom (`cursor.drag`) stayed active independently of
 * `cursor.x/y: false`, fighting this component's own pan gesture on every
 * drag — fixed in buildOptions() and pinned in
 * uplotChartCentreDrag.test.ts (drives the real uplot package).
 */
describe('needleOffsetX (B31b — needle pixel position, suspect #1)', () => {
  it('sits at plotLeft + plotWidth/2, NOT at the host/wrap centre', () => {
    // A left axis-label gutter of 40px, plot area 560px wide (plotLeft=40,
    // plotWidth=560, in a 600px-wide host) — the needle must sit at the PLOT
    // AREA's centre (40 + 280 = 320), not the host's own centre (300).
    expect(needleOffsetX(40, 560)).toBe(320)
    expect(needleOffsetX(40, 560)).not.toBe(300)
  })

  it('reduces to the host centre when there is no gutter (plotLeft=0)', () => {
    expect(needleOffsetX(0, 600)).toBe(300)
  })

  it('shifts by exactly the gutter width for a fixed plot width', () => {
    expect(needleOffsetX(0, 500)).toBe(250)
    expect(needleOffsetX(80, 500)).toBe(330) // +80, same plotWidth
  })
})

describe('valueAtPlotX (B31b — pixel→value mapping, suspect #2)', () => {
  it('maps the plot-area centre pixel to the midpoint of the range', () => {
    expect(valueAtPlotX(300, 600, { min: 0, max: 100 })).toBe(50)
    expect(valueAtPlotX(280, 560, { min: 20, max: 40 })).toBe(30)
  })

  it('maps the left/right edges to min/max', () => {
    expect(valueAtPlotX(0, 600, { min: 10, max: 20 })).toBe(10)
    expect(valueAtPlotX(600, 600, { min: 10, max: 20 })).toBe(20)
  })

  it('is unaffected by devicePixelRatio scaling — both inputs are CSS px', () => {
    // A HiDPI screen (dpr=2) does NOT change getBoundingClientRect's CSS-px
    // values — the same plotLeft/plotWidth/xPixel in CSS px must resolve to
    // the same value regardless of dpr (there is no dpr parameter at all,
    // by design — see the function's doc).
    expect(valueAtPlotX(150, 300, { min: 0, max: 10 })).toBe(5)
  })

  it('falls back to range.min for a non-positive plotWidth (not-yet-measured plot)', () => {
    expect(valueAtPlotX(0, 0, { min: 7, max: 9 })).toBe(7)
    expect(valueAtPlotX(0, -5, { min: 7, max: 9 })).toBe(7)
  })
})

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
