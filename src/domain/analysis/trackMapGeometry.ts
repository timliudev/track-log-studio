/**
 * Pure geometry/colour helpers extracted out of TrackMap.vue's draw() (M3 —
 * draw() was a ~500-line god-function mixing canvas calls with coordinate
 * math). Everything here is canvas-free and unit-testable: projecting
 * lat/lon samples to screen pixels, zoom/pan arithmetic, heatmap bucketing,
 * the checkered start/finish band's polygon geometry, and colour mapping.
 * draw() itself now just calls these to get numbers/shapes, then issues the
 * matching ctx.* calls — see the small drawXxx() functions in TrackMap.vue.
 */

/** Axis-aligned bounding box in pixel space. */
export interface BBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** A lat/lon -> pixel mapping, matching the shape `MapProjection.toPixel` has. */
export type ToPixel = (lat: number, lon: number) => { x: number; y: number }

export interface ProjectedSamples {
  /** View-space (zoom/pan applied) pixel coords per sample; NaN where the sample has no fix. */
  px: Float64Array
  py: Float64Array
  /** Base-pixel (pre zoom/pan) bbox of the valid samples, or null if none are valid. */
  bbox: BBox | null
  /** Base-pixel bbox restricted to [range.startIdx, range.endIdx], or null if
   *  no `range` was given or it contains no valid fixes. */
  rangeBbox: BBox | null
}

/**
 * Projects every sample of a track (lat/lon/valid, same shape as {@link
 * GpsTrack}) to view-space pixels via `toPixel` (the UNZOOMED/unpanned base
 * projection) + the given zoom/pan, in one pass. Used both for the active
 * track (with an optional `range` to also capture the focus-segment's own
 * bbox for #7's auto-fit) and for each overlay track (no `range`).
 */
export function projectSamples(
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  valid: ArrayLike<number>,
  toPixel: ToPixel,
  zoom: number,
  panX: number,
  panY: number,
  range?: { startIdx: number; endIdx: number } | null,
): ProjectedSamples {
  const n = lat.length
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let rMinX = Infinity
  let rMaxX = -Infinity
  let rMinY = Infinity
  let rMaxY = -Infinity
  for (let i = 0; i < n; i++) {
    if (!valid[i]) {
      px[i] = NaN
      py[i] = NaN
      continue
    }
    const p = toPixel(lat[i], lon[i])
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
    if (range && i >= range.startIdx && i <= range.endIdx) {
      if (p.x < rMinX) rMinX = p.x
      if (p.x > rMaxX) rMaxX = p.x
      if (p.y < rMinY) rMinY = p.y
      if (p.y > rMaxY) rMaxY = p.y
    }
    px[i] = p.x * zoom + panX
    py[i] = p.y * zoom + panY
  }
  return {
    px,
    py,
    bbox: minX <= maxX ? { minX, maxX, minY, maxY } : null,
    rangeBbox: rMinX <= rMaxX ? { minX: rMinX, maxX: rMaxX, minY: rMinY, maxY: rMaxY } : null,
  }
}

/** Combines two (possibly null) bboxes into their union; null if both are null. */
export function mergeBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b
  if (!b) return a
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/**
 * Buckets segment [i, i+1] (for lo <= i < hi) by the quantised average of its
 * two endpoint values into `numBuckets` evenly-spaced buckets over [0, 1] —
 * caps the number of strokes issued per heatmap redraw to `numBuckets`
 * regardless of sample count. A segment with either endpoint NaN (a gap, or
 * an uncoloured sample) is skipped entirely. Returns one index array per
 * bucket (possibly empty), in bucket order.
 */
export function bucketHeatmapSegments(
  colorValues: ArrayLike<number>,
  lo: number,
  hi: number,
  numBuckets: number,
): number[][] {
  const buckets: number[][] = Array.from({ length: numBuckets }, () => [])
  for (let i = lo; i < hi; i++) {
    const va = colorValues[i]
    const vb = colorValues[i + 1]
    if (Number.isNaN(va) || Number.isNaN(vb)) continue
    const b = Math.min(numBuckets - 1, Math.max(0, Math.round(((va + vb) / 2) * (numBuckets - 1))))
    buckets[b].push(i)
  }
  return buckets
}

export interface HighlightSegment {
  startIdx: number
  endIdx: number
  color: string
  offset?: { x: number; y: number }
}

/**
 * Resolves which segments to draw emphasized: an explicit lap selection
 * always wins (the caller is responsible for nulling `focusRange` whenever
 * `highlightLaps` is non-empty — see TrackMap's `highlightLaps` prop doc),
 * else a chart-zoom-follow `focusRange` (#7) becomes a single segment in
 * `accentColor`. Neither present -> no emphasis segments.
 */
export function resolveHighlightSegments(
  highlightLaps: HighlightSegment[] | undefined,
  focusRange: { startIdx: number; endIdx: number } | null | undefined,
  accentColor: string,
): HighlightSegment[] {
  if (highlightLaps?.length) return highlightLaps
  if (focusRange) return [{ startIdx: focusRange.startIdx, endIdx: focusRange.endIdx, color: accentColor }]
  return []
}

/** Metres-per-degree-latitude constant used to convert a metres offset to degrees. */
const M_PER_DEG = 111320

/** First valid sample's lat/lon + cos(lat) — the reference point a metres
 *  offset (#9 lap alignment) is converted to a pixel shift relative to.
 *  cos(lat) defaults to 1 (degenerate — equator) when there's no valid fix. */
export function firstValidRefPoint(
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  valid: ArrayLike<number>,
): { lat: number; lon: number; cosRefLat: number } {
  for (let i = 0; i < valid.length; i++) {
    if (valid[i]) {
      const refLat = lat[i]
      return { lat: refLat, lon: lon[i], cosRefLat: Math.cos((refLat * Math.PI) / 180) || 1 }
    }
  }
  return { lat: 0, lon: 0, cosRefLat: 1 }
}

/**
 * Converts a metres east/north offset (#9 lap-alignment offset) to a constant
 * PIXEL shift, via the view projection. The projection is affine, so a fixed
 * geo delta maps to a fixed pixel delta regardless of where it's measured:
 * project the reference point and the reference point + delta, and take the
 * pixel difference.
 */
export function metresOffsetToPixelShift(
  offset: { x: number; y: number } | undefined,
  ref: { lat: number; lon: number },
  cosRefLat: number,
  toPixel: ToPixel,
): [number, number] {
  if (!offset || (offset.x === 0 && offset.y === 0)) return [0, 0]
  const dLat = offset.y / M_PER_DEG
  const dLon = offset.x / (M_PER_DEG * cosRefLat)
  const p0 = toPixel(ref.lat, ref.lon)
  const p1 = toPixel(ref.lat + dLat, ref.lon + dLon)
  return [p1.x - p0.x, p1.y - p0.y]
}

export interface CheckeredSquare {
  /** true = the "dark" checker cell (theme --color-text), false = "light" (--color-surface). */
  dark: boolean
  /** 4 polygon corners, in draw order (not closed — caller closes the path). */
  corners: [number, number][]
}

export interface CheckeredBand {
  squares: CheckeredSquare[]
  /** 4 corners of the band's outer outline rectangle. */
  outline: [number, number][]
}

/**
 * Geometry for the start/finish "checkered flag" band between two endpoint
 * pixels: two rows of alternating squares tiling the line end-to-end, sized
 * to approximately `squareSize` px, plus the outer outline rectangle. Pure
 * shape math only — no colours/canvas; TrackMap.vue's drawStartFinishLine()
 * fills each square by `dark` and strokes the outline.  Returns null for a
 * degenerate (near-zero-length) line, same threshold as the original inline
 * code (len <= 1px).
 */
export function computeCheckeredBand(
  a: { x: number; y: number },
  b: { x: number; y: number },
  squareSize: number,
): CheckeredBand | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len <= 1) return null

  const ux = dx / len
  const uy = dy / len
  const nx = -uy // unit perpendicular to the line
  const ny = ux
  const cols = Math.max(2, Math.round(len / squareSize))
  const sq = len / cols // exact size so squares tile the line end-to-end
  const corner = (along: number, perp: number): [number, number] => [
    a.x + ux * along + nx * perp,
    a.y + uy * along + ny * perp,
  ]

  const squares: CheckeredSquare[] = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 2; r++) {
      // r = 0 sits above the centre line (perp -sq..0), r = 1 below (0..sq)
      const a0 = c * sq
      const a1 = (c + 1) * sq
      const p0 = (r - 1) * sq
      const p1 = r * sq
      squares.push({
        dark: (c + r) % 2 === 0,
        corners: [corner(a0, p0), corner(a1, p0), corner(a1, p1), corner(a0, p1)],
      })
    }
  }
  const outline: [number, number][] = [corner(0, -sq), corner(len, -sq), corner(len, sq), corner(0, sq)]
  return { squares, outline }
}

/** Simple 2-colour lerp for extrema markers: red (frac=0) -> green (frac=1).
 *  Deliberately independent of the heatmap colormaps (turbo/viridis/…) so
 *  markers stay legible over any active heatmap. */
export function extremumColor(frac: number): string {
  const t = Number.isFinite(frac) ? Math.max(0, Math.min(1, frac)) : 0
  const r = Math.round(220 - 160 * t)
  const g = Math.round(60 + 140 * t)
  const b = 60
  return `rgb(${r}, ${g}, ${b})`
}

export function clampZoomValue(z: number, minZoom: number, maxZoom: number): number {
  return Math.max(minZoom, Math.min(maxZoom, z))
}

/**
 * Clamps a single pan axis so at least `margin` px of the track's bbox
 * (`bmin`..`bmax`, in base-pixel space) stays inside a `size`-px canvas at
 * the given `zoom`. When the track is smaller than the visible area the
 * allowed range collapses (lo > hi) — centre it instead of clamping to a
 * degenerate/reversed range.
 */
export function clampPanAxis(p: number, bmin: number, bmax: number, size: number, zoom: number, margin: number): number {
  const lo = margin - bmax * zoom
  const hi = size - margin - bmin * zoom
  if (lo > hi) return (lo + hi) / 2
  return Math.min(hi, Math.max(lo, p))
}

/** Zooming by `factor` about screen point (sx, sy): the new zoom (clamped)
 *  and the pan that keeps the geo point currently under (sx, sy) fixed on
 *  screen. Pan clamping (track-dependent) is the caller's job afterward. */
export function computeZoomAbout(
  sx: number,
  sy: number,
  factor: number,
  zoom: number,
  panX: number,
  panY: number,
  minZoom: number,
  maxZoom: number,
): { zoom: number; panX: number; panY: number } {
  const z2 = clampZoomValue(zoom * factor, minZoom, maxZoom)
  const f = z2 / zoom
  return { zoom: z2, panX: sx - (sx - panX) * f, panY: sy - (sy - panY) * f }
}

/**
 * Auto-fit (#7) the view to a focus segment's base-pixel bbox, conservative
 * by design: returns null (leave the view alone) when there's no real bbox,
 * or when the focus bbox already fills most (`minFraction`) of the track's
 * own bbox at zoom 1 — a "sub-range" that's actually most of the visible
 * track doesn't need zooming in further. Otherwise returns the zoom/pan that
 * centres and scales the focus bbox to fit `canvasW x canvasH` minus `pad`.
 */
export function computeFocusFit(
  focusBbox: BBox,
  baseBbox: BBox,
  canvasW: number,
  canvasH: number,
  pad: number,
  minFraction: number,
  minZoom: number,
  maxZoom: number,
): { zoom: number; panX: number; panY: number } | null {
  const fw = focusBbox.maxX - focusBbox.minX
  const fh = focusBbox.maxY - focusBbox.minY
  // Degenerate bbox (e.g. a single point / straight line with ~0 extent on
  // one axis) — still worth centring/zooming on, so only bail on truly empty.
  if (fw < 0 || fh < 0) return null

  const bw = Math.max(baseBbox.maxX - baseBbox.minX, 1e-9)
  const bh = Math.max(baseBbox.maxY - baseBbox.minY, 1e-9)
  if (fw >= bw * minFraction && fh >= bh * minFraction) return null

  const availW = Math.max(canvasW - 2 * pad, 1)
  const availH = Math.max(canvasH - 2 * pad, 1)
  const scaleX = fw > 1e-9 ? availW / fw : maxZoom
  const scaleY = fh > 1e-9 ? availH / fh : maxZoom
  const zoom = clampZoomValue(Math.min(scaleX, scaleY), minZoom, maxZoom)

  const cx = (focusBbox.minX + focusBbox.maxX) / 2
  const cy = (focusBbox.minY + focusBbox.maxY) / 2
  return { zoom, panX: canvasW / 2 - cx * zoom, panY: canvasH / 2 - cy * zoom }
}
