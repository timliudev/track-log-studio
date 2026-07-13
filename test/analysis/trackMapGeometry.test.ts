import { describe, it, expect } from 'vitest'
import {
  projectSamples,
  mergeBBox,
  bucketHeatmapSegments,
  resolveHighlightSegments,
  firstValidRefPoint,
  metresOffsetToPixelShift,
  computeCheckeredBand,
  extremumColor,
  clampZoomValue,
  clampPanAxis,
  computeZoomAbout,
  computeFocusFit,
  type BBox,
} from '@/domain/analysis/trackMapGeometry'

describe('projectSamples', () => {
  it('projects valid samples through toPixel, applies zoom/pan, and leaves invalid samples NaN', () => {
    const lat = [10, 11, 12]
    const lon = [20, 21, 22]
    const valid = [1, 0, 1]
    const toPixel = (la: number, lo: number) => ({ x: lo * 10, y: la * 10 })
    const out = projectSamples(lat, lon, valid, toPixel, 2, 5, 7)

    expect(out.px[0]).toBeCloseTo(20 * 10 * 2 + 5) // toPixel(10,20)=(200,100) -> *2+pan
    expect(out.py[0]).toBeCloseTo(10 * 10 * 2 + 7)
    expect(Number.isNaN(out.px[1])).toBe(true)
    expect(Number.isNaN(out.py[1])).toBe(true)
    expect(out.px[2]).toBeCloseTo(22 * 10 * 2 + 5)
  })

  it('computes the base-pixel (pre zoom/pan) bbox of valid samples only', () => {
    const lat = [10, 11, 12]
    const lon = [20, 25, 22]
    const valid = [1, 1, 1]
    const toPixel = (la: number, lo: number) => ({ x: lo, y: la })
    const out = projectSamples(lat, lon, valid, toPixel, 1, 0, 0)
    expect(out.bbox).toEqual({ minX: 20, maxX: 25, minY: 10, maxY: 12 })
  })

  it('returns a null bbox when there are fewer than one valid sample', () => {
    const out = projectSamples([1], [1], [0], () => ({ x: 0, y: 0 }), 1, 0, 0)
    expect(out.bbox).toBeNull()
    expect(out.rangeBbox).toBeNull()
  })

  it('captures a separate range bbox restricted to [startIdx, endIdx], in base-pixel space', () => {
    const lat = [0, 0, 0, 0]
    const lon = [0, 1, 2, 3]
    const valid = [1, 1, 1, 1]
    const toPixel = (la: number, lo: number) => ({ x: lo, y: la })
    const out = projectSamples(lat, lon, valid, toPixel, 1, 0, 0, { startIdx: 1, endIdx: 2 })
    expect(out.rangeBbox).toEqual({ minX: 1, maxX: 2, minY: 0, maxY: 0 })
    // Full bbox still spans everything, independent of the range.
    expect(out.bbox).toEqual({ minX: 0, maxX: 3, minY: 0, maxY: 0 })
  })

  it('rangeBbox is null when the range has no valid fixes', () => {
    const lat = [0, 0]
    const lon = [0, 1]
    const valid = [1, 0]
    const toPixel = (la: number, lo: number) => ({ x: lo, y: la })
    const out = projectSamples(lat, lon, valid, toPixel, 1, 0, 0, { startIdx: 1, endIdx: 1 })
    expect(out.rangeBbox).toBeNull()
  })
})

describe('mergeBBox', () => {
  it('unions two bboxes', () => {
    const a: BBox = { minX: 0, maxX: 5, minY: 0, maxY: 5 }
    const b: BBox = { minX: 3, maxX: 10, minY: -2, maxY: 4 }
    expect(mergeBBox(a, b)).toEqual({ minX: 0, maxX: 10, minY: -2, maxY: 5 })
  })

  it('returns whichever side is non-null when the other is null', () => {
    const a: BBox = { minX: 0, maxX: 5, minY: 0, maxY: 5 }
    expect(mergeBBox(a, null)).toEqual(a)
    expect(mergeBBox(null, a)).toEqual(a)
    expect(mergeBBox(null, null)).toBeNull()
  })
})

describe('bucketHeatmapSegments', () => {
  it('buckets each segment by the quantised average of its two endpoint values', () => {
    const values = [0, 0.25, 0.5, 0.75, 1]
    const buckets = bucketHeatmapSegments(values, 0, 4, 4)
    // avg(0,0.25)=0.125 -> round(0.125*3)=0 (bucket 0); avg(0.25,0.5)=0.375 -> round(1.125)=1
    // avg(0.5,0.75)=0.625 -> round(1.875)=2; avg(0.75,1)=0.875 -> round(2.625)=3
    expect(buckets[0]).toEqual([0])
    expect(buckets[1]).toEqual([1])
    expect(buckets[2]).toEqual([2])
    expect(buckets[3]).toEqual([3])
  })

  it('skips a segment when either endpoint value is NaN (a gap or uncoloured sample)', () => {
    const values = [0, NaN, 1]
    const buckets = bucketHeatmapSegments(values, 0, 2, 4)
    expect(buckets.flat()).toEqual([])
  })

  it('clamps the bucket index to [0, numBuckets - 1]', () => {
    const values = [-5, -5, 50, 50]
    const buckets = bucketHeatmapSegments(values, 0, 3, 4)
    expect(buckets[0]).toEqual([0]) // avg(-5,-5) -> round(-15), clamped to 0
    expect(buckets[3]).toEqual([1, 2]) // avg(-5,50) and avg(50,50) both clamp to 3
  })
})

describe('resolveHighlightSegments', () => {
  it('prefers explicit highlightLaps over focusRange', () => {
    const laps = [{ startIdx: 1, endIdx: 2, color: 'red' }]
    const out = resolveHighlightSegments(laps, { startIdx: 5, endIdx: 6 }, 'accent')
    expect(out).toBe(laps)
  })

  it('falls back to a single accent-coloured segment from focusRange', () => {
    const out = resolveHighlightSegments(undefined, { startIdx: 5, endIdx: 6 }, 'accent')
    expect(out).toEqual([{ startIdx: 5, endIdx: 6, color: 'accent' }])
  })

  it('returns an empty array when neither is present', () => {
    expect(resolveHighlightSegments(undefined, null, 'accent')).toEqual([])
    expect(resolveHighlightSegments([], null, 'accent')).toEqual([])
  })
})

describe('firstValidRefPoint', () => {
  it('returns the first valid sample and its cos(lat)', () => {
    const out = firstValidRefPoint([0, 60, 30], [0, 1, 2], [0, 1, 1])
    expect(out.lat).toBe(60)
    expect(out.lon).toBe(1)
    expect(out.cosRefLat).toBeCloseTo(Math.cos((60 * Math.PI) / 180))
  })

  it('defaults to (0, 0, cos=1) when there is no valid sample', () => {
    const out = firstValidRefPoint([1, 2], [3, 4], [0, 0])
    expect(out).toEqual({ lat: 0, lon: 0, cosRefLat: 1 })
  })
})

describe('metresOffsetToPixelShift', () => {
  it('is a no-op ([0, 0]) for an undefined or zero offset', () => {
    const toPixel = () => ({ x: 0, y: 0 })
    expect(metresOffsetToPixelShift(undefined, { lat: 0, lon: 0 }, 1, toPixel)).toEqual([0, 0])
    expect(metresOffsetToPixelShift({ x: 0, y: 0 }, { lat: 0, lon: 0 }, 1, toPixel)).toEqual([0, 0])
  })

  it('converts a metres offset to the pixel delta via the projection', () => {
    // A projection where 1 degree lon/lat maps to 100px, so the constant
    // metres->pixel scale can be checked precisely.
    const toPixel = (lat: number, lon: number) => ({ x: lon * 100, y: lat * 100 })
    const ref = { lat: 0, lon: 0 }
    const [dx, dy] = metresOffsetToPixelShift({ x: 111320, y: 0 }, ref, 1, toPixel)
    // x offset of 111320m at the equator (cosRefLat=1) = exactly 1 degree lon = 100px.
    expect(dx).toBeCloseTo(100)
    expect(dy).toBeCloseTo(0)
  })
})

describe('computeCheckeredBand', () => {
  it('returns null for a near-zero-length line', () => {
    expect(computeCheckeredBand({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 6)).toBeNull()
  })

  it('tiles a horizontal line into alternating squares + a matching outline', () => {
    const band = computeCheckeredBand({ x: 0, y: 0 }, { x: 10, y: 0 }, 6)
    expect(band).not.toBeNull()
    // cols = max(2, round(10/6)) = 2, sq = 10/2 = 5
    expect(band!.squares).toHaveLength(4) // 2 cols x 2 rows
    expect(band!.squares.map((s) => s.dark)).toEqual([true, false, false, true])
    // First square: col 0, row 0 -> spans along [0,5], perp [-5,0]
    expect(band!.squares[0].corners).toEqual([
      [0, -5],
      [5, -5],
      [5, 0],
      [0, 0],
    ])
    expect(band!.outline).toEqual([
      [0, -5],
      [10, -5],
      [10, 5],
      [0, 5],
    ])
  })
})

describe('extremumColor', () => {
  it('is red at frac=0 and green at frac=1', () => {
    expect(extremumColor(0)).toBe('rgb(220, 60, 60)')
    expect(extremumColor(1)).toBe('rgb(60, 200, 60)')
  })

  it('clamps out-of-range and non-finite fractions', () => {
    expect(extremumColor(-5)).toBe(extremumColor(0))
    expect(extremumColor(5)).toBe(extremumColor(1))
    expect(extremumColor(NaN)).toBe(extremumColor(0))
  })
})

describe('clampZoomValue / clampPanAxis / computeZoomAbout', () => {
  it('clampZoomValue clamps to [min, max]', () => {
    expect(clampZoomValue(0.5, 1, 24)).toBe(1)
    expect(clampZoomValue(30, 1, 24)).toBe(24)
    expect(clampZoomValue(5, 1, 24)).toBe(5)
  })

  it('clampPanAxis keeps at least `margin` px of the bbox on-screen', () => {
    // Track bbox [0, 100] at zoom 1 in a 200px canvas, margin 10: pan should
    // be clamped to keep some part of [0,100] within [10, 190].
    const clamped = clampPanAxis(1000, 0, 100, 200, 1, 10)
    expect(clamped).toBeLessThanOrEqual(190)
  })

  it('clampPanAxis centres when the allowed range is degenerate (2x margin exceeds canvas size)', () => {
    // bbox [0, 10] (span 10) at zoom 1 in a 100px canvas with margin 60: lo=60-10=50,
    // hi=100-60-0=40 -> lo > hi, so the axis centres instead of clamping to a reversed range.
    const out = clampPanAxis(0, 0, 10, 100, 1, 60)
    const lo = 60 - 10 * 1
    const hi = 100 - 60 - 0 * 1
    expect(lo).toBeGreaterThan(hi)
    expect(out).toBeCloseTo((lo + hi) / 2)
  })

  it('computeZoomAbout keeps the geo point under (sx, sy) fixed on screen', () => {
    const out = computeZoomAbout(50, 50, 2, 1, 0, 0, 1, 24)
    expect(out.zoom).toBe(2)
    // panX = sx - (sx-panX)*f = 50 - 50*2 = -50
    expect(out.panX).toBe(-50)
    expect(out.panY).toBe(-50)
  })

  it('computeZoomAbout clamps the resulting zoom', () => {
    const out = computeZoomAbout(0, 0, 1000, 1, 0, 0, 1, 24)
    expect(out.zoom).toBe(24)
  })
})

describe('computeFocusFit', () => {
  const base: BBox = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 }

  it('returns null when the focus bbox already fills most of the track bbox', () => {
    const focus: BBox = { minX: 0, maxX: 900, minY: 0, maxY: 900 }
    expect(computeFocusFit(focus, base, 400, 300, 48, 0.4, 1, 24)).toBeNull()
  })

  it('returns null for a degenerate (empty) focus bbox', () => {
    const focus: BBox = { minX: 10, maxX: 5, minY: 0, maxY: 0 }
    expect(computeFocusFit(focus, base, 400, 300, 48, 0.4, 1, 24)).toBeNull()
  })

  it('fits and centres a small focus sub-range, clamped to maxZoom', () => {
    // fw=fh=1 needs a scale of min(304/1, 204/1)=204 to fill the padded canvas
    // — clamped down to maxZoom (24).
    const focus: BBox = { minX: 105, maxX: 106, minY: 105, maxY: 106 }
    const out = computeFocusFit(focus, base, 400, 300, 48, 0.4, 1, 24)
    expect(out).not.toBeNull()
    expect(out!.zoom).toBe(24)
    // Pan centres the focus bbox's midpoint (105.5, 105.5) on the canvas centre.
    expect(out!.panX).toBeCloseTo(200 - 105.5 * 24)
    expect(out!.panY).toBeCloseTo(150 - 105.5 * 24)
  })

  it('fits (without clamping) a moderate focus sub-range to the padded canvas', () => {
    const focus: BBox = { minX: 100, maxX: 110, minY: 100, maxY: 110 }
    const out = computeFocusFit(focus, base, 400, 300, 48, 0.4, 1, 24)
    expect(out).not.toBeNull()
    // availW=304, availH=204, fw=fh=10 -> scaleX=30.4, scaleY=20.4 -> min=20.4.
    expect(out!.zoom).toBeCloseTo(20.4)
    expect(out!.panX).toBeCloseTo(200 - 105 * 20.4)
    expect(out!.panY).toBeCloseTo(150 - 105 * 20.4)
  })
})
