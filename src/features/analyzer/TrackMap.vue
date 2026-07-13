<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'
import { colormapSwatches, type ColormapId } from '@/domain/analysis/colormap'
import type { TrackOverlayEntry } from '@/domain/analysis/trackOverlay'
import {
  bucketHeatmapSegments,
  clampPanAxis,
  computeCheckeredBand,
  computeFocusFit,
  computeZoomAbout,
  extremumColor,
  firstValidRefPoint,
  mergeBBox,
  metresOffsetToPixelShift,
  projectSamples,
  resolveHighlightSegments,
  type BBox,
  type HighlightSegment,
} from '@/domain/analysis/trackMapGeometry'
import { fitProjection, type MapProjection } from './projection'
import { nearestSample } from './trackNearestSample'

const props = defineProps<{
  track: GpsTrack | null
  cursorIdx: number | null
  line: LapLine | null
  /**
   * Multi-file track-map overlay (賽道地圖多檔疊圖): OTHER loaded sessions'
   * racing lines, drawn faint (see OVERLAY_ALPHA) alongside `track`'s own
   * full-opacity polyline so the active session always reads as the
   * prominent one. Purely visual — no cursor scrub / line-drag / gate-drag
   * hit-testing ever considers these (only `track`'s own px/py feed pointer
   * interactions), so existing map interactions on the active session are
   * unaffected by however many overlays are shown. See useTrackOverlay.ts.
   */
  overlayTracks?: TrackOverlayEntry[]
  /**
   * Selected laps to draw, each as a colored [startIdx, endIdx] segment. An
   * optional `offset` (metres east/north) shifts just that lap's polyline so
   * GNSS-drifted racing lines can be aligned on the map (#9 spatial half).
   */
  highlightLaps?: { startIdx: number; endIdx: number; color: string; offset?: { x: number; y: number } }[]
  /**
   * Cross-file lap selections (`lapStore.selectedAcrossSessions`), already
   * resolved to their OWN session's track by the caller (see
   * `buildComparisonLapHighlights` in domain/analysis/crossSessionLapHighlight.ts)
   * — unlike `highlightLaps`, each entry carries its own `track` because a
   * comparison lap's [startIdx, endIdx] indexes into a DIFFERENT session's
   * samples than `props.track`. Drawn with the same "faint full track +
   * bright segment" weight as `highlightLaps`, so a lap picked from another
   * recording reads identically to a same-file selected lap; the two arrays
   * are simply drawn together (a mixed same-file + cross-file selection is
   * the common "compare 2 laps from 2 different files" case). The `track`
   * itself is always a session already present in `overlayTracks` (a cross-
   * file lap can only be selected from a currently-toggled comparison
   * session), so its faint full polyline is already drawn by the overlay
   * loop above — this only adds the bright emphasized segment on top.
   */
  comparisonLapHighlights?: {
    track: GpsTrack
    startIdx: number
    endIdx: number
    color: string
    offset?: { x: number; y: number }
  }[]
  /**
   * Chart-zoom-follow focus (#7): a session index span to emphasize when the
   * user has narrowed a TIMELINE chart's visible X range, derived by the
   * caller (see `AnalyzerView`'s `focusRange`, already null'd out whenever
   * `highlightLaps` OR `comparisonLapHighlights` is non-empty — lap selection
   * takes precedence, so `focusRange` and either highlight array are never
   * both drawn at once). Rendered via the same "faint full track + bright
   * segment" path as `highlightLaps`, and — when it's a genuine sub-segment —
   * the view auto-fits to its bbox.
   */
  focusRange?: { startIdx: number; endIdx: number } | null
  /**
   * Per-sample normalised value in [0, 1] (NaN where uncoloured) for the track
   * heatmap, or null to draw the plain track. Colours come from {@link colormap}.
   */
  colorValues?: Float64Array | null
  colormap?: ColormapId
  /**
   * Sector gates (A1+A15: auto-detection loads directly as usable gates, no
   * separate suggestion/review step, so every gate is always `confirmed:
   * true` in practice — the flag is kept so a future "just-detected,
   * unedited" visual distinction is trivial to add) — same line shape as the
   * start/finish line, drawn smaller and in a distinct colour so they don't
   * read as another start/finish. Solid + numbered; draggable at either
   * endpoint.
   */
  gates?: { line: LapLine; confirmed: boolean }[]
  /**
   * A9 — unified extrema markers (generalised from the old speed-only corner
   * apexes): numbered markers at a channel's local minima/maxima,
   * colour-graded green (fast/low) -> red (slow/high) by `valueFrac` (0..1,
   * normalised across the SAME lap's own extrema set so the gradient is
   * meaningful regardless of the channel's absolute range). `kind`
   * distinguishes minima from maxima visually (round vs diamond) so both can
   * be shown together without reading as the same marker type. Caller
   * (AnalyzerView) decides when this is populated (single-lap rule).
   */
  extremaMarkers?: {
    lat: number
    lon: number
    value: number
    valueFrac: number
    kind: 'min' | 'max'
    /** `value` pre-formatted for display next to the marker (RaceChrono-style
     *  apex-speed label) — see useTrackExtrema's `formatExtremumValue`. */
    label: string
  }[]
  /**
   * #8 — TrackMap now lives inside a resizable dashboard grid item; whether
   * the canvas fills that item's available height (vs. the fixed 320px used
   * standalone) is entirely a CSS concern (`.track-wrap.fill`/`.track.fill`
   * below) — draw()'s own ResizeObserver already re-measures `cv.clientWidth`/
   * `clientHeight` on every container resize regardless of which mode is
   * active, so no separate JS sizing path is needed here (unlike UPlotChart/
   * GgChart, which read a fixed `height` PROP rather than the DOM element's
   * actual layout size).
   */
  fillHeight?: boolean
}>()

// Fixed, theme-independent colour for sector gates — distinct from the accent
// red (cursor / start-finish handles) and from the lap-identity palette.
const GATE_COLOR = '#00c2ff'

// Number of discrete colour buckets: caps strokes per frame regardless of
// sample count, so the heatmap stays as cheap as the plain single-stroke track.
const HEAT_BUCKETS = 32

// Multi-file overlay styling: faint + thin so an overlaid session reads as
// background context, never competing with the active session's full-opacity,
// thicker (2px+) polyline drawn on top of it (see the draw() painter's-order
// comment above the overlay stroke loop).
const OVERLAY_ALPHA = 0.45
const OVERLAY_LINE_WIDTH = 1.5
const emit = defineEmits<{
  cursor: [number | null]
  'update:line': [LapLine]
  /** A confirmed gate's endpoint was dragged: (gate index into `props.gates`, new line). */
  'update:gate': [number, LapLine]
  /** B7 — in-card maximize toggled; lets the host card hide its other body
   *  content (legend/hints/band inputs) while the map fills the card. */
  'update:maximized': [boolean]
}>()

const { t } = useI18n()

const canvas = ref<HTMLCanvasElement | null>(null)
let ro: ResizeObserver | null = null

// Projected pixel coords per sample (NaN where no fix); recomputed on draw.
let px: Float64Array | null = null
let py: Float64Array | null = null
// The projection used by the last draw(); shared with line hit-testing/dragging.
// This is the *view* projection (base fit composed with the zoom/pan below), so
// hit-testing and dragging happen in the same on-screen coordinate frame.
let projection: MapProjection | null = null

// View transform on top of the base fit: screen = base * zoom + (panX, panY).
// Zoom/pan let the user inspect the track like a map; the base fit (projection.ts)
// stays the zoom-1 / pan-0 reference. Kept as refs so the reset button can react.
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const MIN_ZOOM = 1
const MAX_ZOOM = 24
// Base-pixel bbox of the fitted track + last canvas size, captured each draw and
// used to clamp panning so the track can't be dragged completely off-screen.
let baseMinX = NaN
let baseMaxX = NaN
let baseMinY = NaN
let baseMaxY = NaN
let lastW = 0
let lastH = 0
// Base-pixel bbox of the CURRENT focusRange span (#7), captured alongside the
// full-track bbox each draw; used to auto-fit the view (see watch below).
// NaN when there's no focus range or it has no valid fixes.
let focusMinX = NaN
let focusMaxX = NaN
let focusMinY = NaN
let focusMaxY = NaN

const showReset = computed(() => zoom.value !== 1 || panX.value !== 0 || panY.value !== 0)

// "Maximize" — in-card (B7: works identically on desktop and mobile, unlike
// the old mobile-only fullscreen-overlay design). The map itself stays in
// place in the DOM (no Teleport): toggling only flips this local `maximized`
// flag, which is emitted upward so the HOST card (AnalyzerView's "map"
// DashboardCard) can hide its OTHER body content (heatmap legend, line hint,
// lap count/reset, lap-time/lap-distance band inputs) while active. With
// those siblings gone, `.track-wrap.fill`'s existing `flex: 1 1 0` (see the
// `.fill` rule below) simply expands to consume the whole card body — no
// special "maximized" positioning/sizing CSS is needed for the map itself,
// and the ResizeObserver already wired up in onMounted below keeps firing/
// redrawing as that flex-driven size change happens. Still purely local UI
// state (no analyzerStore/grid-layout involvement) beyond the one emitted
// event a host may listen to.
const maximized = ref(false)
function toggleMaximize(): void {
  maximized.value = !maximized.value
}
function onMaximizedKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && maximized.value) maximized.value = false
}
watch(maximized, (isMax) => emit('update:maximized', isMax))

const PAD = 16
// Visible endpoint radius and a larger touch-friendly hit radius (~44px target).
const HANDLE_R = 8
const HANDLE_HIT = 22

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
}

// ── draw() steps ─────────────────────────────────────────────────────────
// draw() (below, at the bottom of this section) is the orchestrator: it
// projects the active + overlay tracks via the pure helpers imported from
// trackMapGeometry.ts, then calls these small, single-purpose canvas-drawing
// steps in painter's-order (overlay tracks -> active path -> lap highlights
// -> comparison highlights -> start/finish line -> gates -> extrema markers
// -> cursor). Each step owns exactly one visual element from the original
// god-function; none of them read component state directly (only their
// arguments), so they stay easy to reason about independent of draw()'s own
// zoom/pan/canvas bookkeeping.

/** DPR-aware canvas frame setup: resizes the backing store to match the CSS
 *  size at devicePixelRatio, resets the transform, and clears. Returns the
 *  CSS (logical) width/height draw() continues to work in. */
function setupCanvasFrame(cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth
  const h = cv.clientHeight
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  return { w, h }
}

/** Composes the base (zoom-1 / pan-0) fit with the current zoom/pan into the
 *  view projection used for drawing AND line/gate hit-testing/dragging. */
function composeViewProjection(base: MapProjection, z: number, tx: number, ty: number): MapProjection {
  return {
    toPixel(lat, lon) {
      const p = base.toPixel(lat, lon)
      return { x: p.x * z + tx, y: p.y * z + ty }
    },
    toGeo(sx, sy) {
      return base.toGeo((sx - tx) / z, (sy - ty) / z)
    },
  }
}

/** Strokes the polyline over sample range [lo, hi] (inclusive), breaking the
 *  path across gaps (NaN) so missing fixes don't draw bogus connectors.
 *  (dx, dy) is a constant pixel shift applied to this stroke (#9 lap offset). */
function drawPlainSegment(
  ctx: CanvasRenderingContext2D,
  px: Float64Array,
  py: Float64Array,
  lo: number,
  hi: number,
  dx = 0,
  dy = 0,
): void {
  ctx.beginPath()
  let on = false
  for (let i = lo; i <= hi; i++) {
    if (Number.isNaN(px[i])) {
      on = false
      continue
    }
    if (!on) {
      ctx.moveTo(px[i] + dx, py[i] + dy)
      on = true
    } else {
      ctx.lineTo(px[i] + dx, py[i] + dy)
    }
  }
  ctx.stroke()
}

/** Strokes [lo, hi) segment-by-segment, gradient-coloured by `colorVals` via
 *  {@link bucketHeatmapSegments} — bounded to at most `swatches.length`
 *  strokes regardless of sample count. A segment is skipped if either
 *  endpoint is a gap (NaN px) or has no colour (NaN value): folded into one
 *  NaN rule by masking `colorVals` with any pixel gap before bucketing. */
function drawHeatmapSegment(
  ctx: CanvasRenderingContext2D,
  px: Float64Array,
  py: Float64Array,
  colorVals: Float64Array,
  swatches: string[],
  lo: number,
  hi: number,
  width: number,
  dx = 0,
  dy = 0,
): void {
  const masked = new Float64Array(colorVals.length)
  for (let i = 0; i < colorVals.length; i++) {
    masked[i] = Number.isNaN(px[i]) ? NaN : colorVals[i]
  }
  const buckets = bucketHeatmapSegments(masked, lo, hi, swatches.length)
  ctx.lineWidth = width
  for (let b = 0; b < swatches.length; b++) {
    const seg = buckets[b]
    if (seg.length === 0) continue
    ctx.strokeStyle = swatches[b]
    ctx.beginPath()
    for (const i of seg) {
      ctx.moveTo(px[i] + dx, py[i] + dy)
      ctx.lineTo(px[i + 1] + dx, py[i + 1] + dy)
    }
    ctx.stroke()
  }
}

/** Multi-file overlay: strokes every OTHER session's track, faint (see
 *  OVERLAY_ALPHA/OVERLAY_LINE_WIDTH). Always called BEFORE anything
 *  belonging to the active session — painter's-order keeps the active track
 *  (and its heatmap/highlight/start-finish/gates/extrema/cursor) drawn on
 *  top, so it always reads as the prominent one regardless of how many
 *  overlays are on. */
function drawOverlayTracks(
  ctx: CanvasRenderingContext2D,
  overlays: { color: string; xs: Float64Array; ys: Float64Array; offset?: { x: number; y: number } }[],
  pixelShift: (off?: { x: number; y: number }) => [number, number],
): void {
  for (const { color, xs, ys, offset } of overlays) {
    const [dx, dy] = pixelShift(offset)
    ctx.save()
    ctx.globalAlpha = OVERLAY_ALPHA
    ctx.strokeStyle = color
    ctx.lineWidth = OVERLAY_LINE_WIDTH
    ctx.beginPath()
    let on = false
    for (let i = 0; i < xs.length; i++) {
      if (Number.isNaN(xs[i])) {
        on = false
        continue
      }
      if (!on) {
        ctx.moveTo(xs[i] + dx, ys[i] + dy)
        on = true
      } else {
        ctx.lineTo(xs[i] + dx, ys[i] + dy)
      }
    }
    ctx.stroke()
    ctx.restore()
  }
}

/** Full-track polyline. With no selection it's the normal muted track (or
 *  the heatmap if active); with a selection (same-file OR cross-file) it's
 *  drawn faint (border color) for context and the selected laps stand out,
 *  per "only show selected laps". */
function drawTrackPath(
  ctx: CanvasRenderingContext2D,
  px: Float64Array,
  py: Float64Array,
  n: number,
  heat: boolean,
  anySelection: boolean,
  colorVals: Float64Array | null | undefined,
  swatches: string[],
): void {
  if (heat && !anySelection && colorVals) {
    drawHeatmapSegment(ctx, px, py, colorVals, swatches, 0, n - 1, 2.5)
  } else {
    ctx.strokeStyle = cssVar(anySelection ? '--color-border' : '--color-text-muted')
    ctx.lineWidth = 2
    drawPlainSegment(ctx, px, py, 0, n - 1)
  }
}

/** Selected laps (or the focus segment): each [startIdx, endIdx] span,
 *  thicker. Heatmap-coloured by value when a heatmap channel is chosen, else
 *  its identity color (lap colour, or the accent colour for a focus range). */
function drawLapHighlights(
  ctx: CanvasRenderingContext2D,
  laps: HighlightSegment[],
  px: Float64Array,
  py: Float64Array,
  n: number,
  heat: boolean,
  colorVals: Float64Array | null | undefined,
  swatches: string[],
  pixelShift: (off?: { x: number; y: number }) => [number, number],
): void {
  for (const lap of laps) {
    const lo = Math.max(0, Math.min(lap.startIdx, lap.endIdx))
    const hi = Math.min(n - 1, Math.max(lap.startIdx, lap.endIdx))
    const [dx, dy] = pixelShift(lap.offset)
    if (heat && colorVals) {
      drawHeatmapSegment(ctx, px, py, colorVals, swatches, lo, hi, 3, dx, dy)
    } else {
      ctx.strokeStyle = lap.color
      ctx.lineWidth = 3
      drawPlainSegment(ctx, px, py, lo, hi, dx, dy)
    }
  }
}

/** Cross-file selected laps: same visual weight (3px, identity color) as
 *  drawLapHighlights, but projected from EACH entry's OWN track rather than
 *  the active track's px/py. Never heatmap-coloured — the active heatmap
 *  channel's data belongs to the PRIMARY session, not a comparison one, so
 *  identity color is always used (matching how drawOverlayTracks also
 *  ignores the heatmap). */
function drawComparisonHighlights(
  ctx: CanvasRenderingContext2D,
  highlights: {
    track: GpsTrack
    startIdx: number
    endIdx: number
    color: string
    offset?: { x: number; y: number }
  }[],
  base: MapProjection,
  z: number,
  tx: number,
  ty: number,
  pixelShift: (off?: { x: number; y: number }) => [number, number],
): void {
  for (const hl of highlights) {
    const hn = hl.track.valid.length
    const lo = Math.max(0, Math.min(hl.startIdx, hl.endIdx))
    const hi = Math.min(hn - 1, Math.max(hl.startIdx, hl.endIdx))
    const [dx, dy] = pixelShift(hl.offset)
    ctx.strokeStyle = hl.color
    ctx.lineWidth = 3
    ctx.beginPath()
    let on = false
    for (let i = lo; i <= hi; i++) {
      if (!hl.track.valid[i]) {
        on = false
        continue
      }
      const p = base.toPixel(hl.track.lat[i], hl.track.lon[i])
      const x = p.x * z + tx + dx
      const y = p.y * z + ty + dy
      if (!on) {
        ctx.moveTo(x, y)
        on = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }
}

/** Start/finish line + draggable endpoints. Drawn as a checkered-flag band
 *  (the universal start/finish marker) in the text/surface two-tone so it
 *  has contrast in both themes and reads completely differently from the
 *  round red (--color-accent) cursor dot and the colourful track/heatmap —
 *  the #3 fix. The band's polygon geometry itself comes from
 *  computeCheckeredBand (trackMapGeometry.ts); this only fills/strokes it. */
function drawStartFinishLine(ctx: CanvasRenderingContext2D, proj: MapProjection, line: LapLine | null | undefined): void {
  if (!line) return
  const a = proj.toPixel(line.a.lat, line.a.lon)
  const b = proj.toPixel(line.b.lat, line.b.lon)
  const dark = cssVar('--color-text')
  const light = cssVar('--color-surface')

  const SQ = 6 // target checker square size (px)
  const band = computeCheckeredBand(a, b, SQ)
  if (band) {
    for (const square of band.squares) {
      ctx.fillStyle = square.dark ? dark : light
      ctx.beginPath()
      ctx.moveTo(...square.corners[0])
      ctx.lineTo(...square.corners[1])
      ctx.lineTo(...square.corners[2])
      ctx.lineTo(...square.corners[3])
      ctx.closePath()
      ctx.fill()
    }
    // Outline so the band stays delineated against either theme background.
    ctx.strokeStyle = dark
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(...band.outline[0])
    ctx.lineTo(...band.outline[1])
    ctx.lineTo(...band.outline[2])
    ctx.lineTo(...band.outline[3])
    ctx.closePath()
    ctx.stroke()
  }

  // Grab handles: a 2×2-checker square (surface + text) at each endpoint. The
  // square shape + checker tie them to the start/finish line and keep them
  // distinct from the round red cursor/track dots.
  for (const p of [a, b]) {
    const s = HANDLE_R // half-side
    ctx.fillStyle = light
    ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2)
    ctx.fillStyle = dark
    ctx.fillRect(p.x - s, p.y - s, s, s) // top-left
    ctx.fillRect(p.x, p.y, s, s) // bottom-right
    ctx.lineWidth = 2
    ctx.strokeStyle = dark
    ctx.strokeRect(p.x - s, p.y - s, s * 2, s * 2)
  }
}

/** Sector gates: a short perpendicular segment + numbered marker at each
 *  gate's midpoint — deliberately smaller/thinner than the checkered
 *  start/finish band so the two never get confused. */
function drawSectorGates(
  ctx: CanvasRenderingContext2D,
  proj: MapProjection,
  gates: { line: LapLine; confirmed: boolean }[],
): void {
  gates.forEach((g, i) => {
    const a = proj.toPixel(g.line.a.lat, g.line.a.lon)
    const b = proj.toPixel(g.line.b.lat, g.line.b.lon)
    ctx.strokeStyle = GATE_COLOR
    ctx.lineWidth = g.confirmed ? 3 : 2
    ctx.setLineDash(g.confirmed ? [] : [5, 4])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])

    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    ctx.fillStyle = cssVar('--color-surface')
    ctx.beginPath()
    ctx.arc(mx, my, 9, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = GATE_COLOR
    ctx.stroke()
    ctx.fillStyle = cssVar('--color-text')
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), mx, my)
  })
}

/** A9 — unified extrema markers: numbered markers colour-graded green->red
 *  by valueFrac. MIN markers are filled circles (round, unlike the square
 *  gate/start-finish handles) — same visual as the old corner-apex markers.
 *  MAX markers are filled diamonds so the two kinds stay visually distinct
 *  at a glance when both are shown together on the same lap. Numbering is
 *  independent per kind (each starts at 1) so a "min #2" and "max #2" can
 *  coexist without implying an order between the two sets.
 *
 *  RaceChrono-style value label: the marker's own formatted value (e.g. an
 *  apex speed) drawn as small text just above it, so the number reads
 *  directly off the map instead of only via the side-panel list. Themed
 *  text colour (--color-text) with a stroked halo in the surface colour for
 *  contrast against any track/heatmap colour underneath — same halo
 *  technique used for the numbered marker glyph, just inverted (dark text +
 *  light halo instead of white text + no halo) since this label sits OUTSIDE
 *  the coloured marker, over the track/background rather than over the
 *  marker's own fill. */
function drawExtremaMarkers(
  ctx: CanvasRenderingContext2D,
  proj: MapProjection,
  markers: {
    lat: number
    lon: number
    value: number
    valueFrac: number
    kind: 'min' | 'max'
    label: string
  }[],
): void {
  let minSeen = 0
  let maxSeen = 0
  const MARK_R = 9
  const LABEL_OFFSET_Y = MARK_R + 11 // clears the marker glyph, sits just above it
  markers.forEach((m) => {
    const p = proj.toPixel(m.lat, m.lon)
    const numberLabel = m.kind === 'min' ? String(++minSeen) : String(++maxSeen)
    ctx.fillStyle = extremumColor(m.valueFrac)
    ctx.beginPath()
    if (m.kind === 'min') {
      ctx.arc(p.x, p.y, MARK_R, 0, Math.PI * 2)
    } else {
      // Diamond: same bounding radius as the circle so the two kinds read as
      // the same "size" of marker, just a different silhouette.
      ctx.moveTo(p.x, p.y - MARK_R)
      ctx.lineTo(p.x + MARK_R, p.y)
      ctx.lineTo(p.x, p.y + MARK_R)
      ctx.lineTo(p.x - MARK_R, p.y)
      ctx.closePath()
    }
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = cssVar('--color-surface')
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 10px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(numberLabel, p.x, p.y)

    // Value label, offset above the marker so it doesn't cover the glyph.
    const ly = p.y - LABEL_OFFSET_Y
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 3
    ctx.strokeStyle = cssVar('--color-surface')
    ctx.lineJoin = 'round'
    ctx.strokeText(m.label, p.x, ly)
    ctx.fillStyle = cssVar('--color-text')
    ctx.fillText(m.label, p.x, ly)
  })
}

/** Cursor marker: a filled accent-colour dot at the current sample index, or
 *  nothing when out of range / on a gap (no fix at that sample). */
function drawCursorMarker(
  ctx: CanvasRenderingContext2D,
  px: Float64Array,
  py: Float64Array,
  cursorIdx: number | null | undefined,
  n: number,
): void {
  if (cursorIdx == null || cursorIdx < 0 || cursorIdx >= n || Number.isNaN(px[cursorIdx])) return
  ctx.fillStyle = cssVar('--color-accent')
  ctx.beginPath()
  ctx.arc(px[cursorIdx], py[cursorIdx], 5, 0, Math.PI * 2)
  ctx.fill()
}

function draw(): void {
  const cv = canvas.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return

  const { w, h } = setupCanvasFrame(cv, ctx)

  const track = props.track
  if (!track) {
    projection = null
    return
  }

  // Multi-file overlay (賽道地圖多檔疊圖): fit the projection to the COMBINED
  // bounds of the active track + every overlaid session, not just the active
  // one — otherwise an overlay whose bbox extends past the active track's own
  // would draw (partly) off-canvas. See fitProjection's multi-track doc.
  const overlayTracks = props.overlayTracks ?? []
  const base = fitProjection(
    overlayTracks.length ? [track, ...overlayTracks.map((o) => o.track)] : track,
    w,
    h,
    PAD,
  )
  if (!base) {
    projection = null
    return
  }

  // Compose the base fit with the current zoom/pan into the view projection. The
  // composition is affine (uniform scale + translate of an affine fit), so every
  // downstream pixel calculation — polyline, line band, handles, lap offsets —
  // works unchanged in screen space, and lap-offset pixel shifts scale with zoom.
  lastW = w
  lastH = h
  const z = zoom.value
  const tx = panX.value
  const ty = panY.value
  const view = composeViewProjection(base, z, tx, ty)
  projection = view
  const proj = view

  // Project the active track (+ the focusRange sub-bbox for #7's auto-fit)
  // and every overlay track through the SAME base projection in one pass
  // each, then fold every bbox together so panning stays clamped to
  // whatever's actually drawn (multi-file overlay). Overlay pixels are
  // captured now but STROKED later (drawOverlayTracks, below) — right before
  // the active track's own polyline — so painter's-order keeps the active
  // session on top.
  const n = track.valid.length
  const activeProjected = projectSamples(track.lat, track.lon, track.valid, base.toPixel, z, tx, ty, props.focusRange)
  px = activeProjected.px
  py = activeProjected.py
  let bbox: BBox | null = activeProjected.bbox

  const overlayPixels = overlayTracks.map((entry) => {
    const projected = projectSamples(entry.track.lat, entry.track.lon, entry.track.valid, base.toPixel, z, tx, ty)
    bbox = mergeBBox(bbox, projected.bbox)
    return { color: entry.color, xs: projected.px, ys: projected.py, offset: entry.offset }
  })

  if (bbox) {
    baseMinX = bbox.minX
    baseMaxX = bbox.maxX
    baseMinY = bbox.minY
    baseMaxY = bbox.maxY
  }
  if (activeProjected.rangeBbox) {
    focusMinX = activeProjected.rangeBbox.minX
    focusMaxX = activeProjected.rangeBbox.maxX
    focusMinY = activeProjected.rangeBbox.minY
    focusMaxY = activeProjected.rangeBbox.maxY
  } else {
    focusMinX = NaN
    focusMaxX = NaN
    focusMinY = NaN
    focusMaxY = NaN
  }

  // Reference geo point + cos(lat) for converting a metres offset (#9 lap
  // alignment) to a constant pixel shift via the view projection.
  const ref = firstValidRefPoint(track.lat, track.lon, track.valid)
  const pixelShift = (off?: { x: number; y: number }): [number, number] =>
    metresOffsetToPixelShift(off, ref, ref.cosRefLat, proj.toPixel)

  // Heatmap swatches: bucketed by props.colorValues, at most HEAT_BUCKETS
  // strokes issued per stroked range regardless of sample count.
  const colorVals = props.colorValues
  const swatches = colorVals ? colormapSwatches(props.colormap ?? 'turbo', HEAT_BUCKETS) : []
  const heat = !!colorVals

  drawOverlayTracks(ctx, overlayPixels, pixelShift)

  const highlightLaps = resolveHighlightSegments(props.highlightLaps, props.focusRange, cssVar('--color-accent'))
  const comparisonHighlights = props.comparisonLapHighlights ?? []
  const anySelection = highlightLaps.length > 0 || comparisonHighlights.length > 0

  drawTrackPath(ctx, px, py, n, heat, anySelection, colorVals, swatches)
  drawLapHighlights(ctx, highlightLaps, px, py, n, heat, colorVals, swatches, pixelShift)
  drawComparisonHighlights(ctx, comparisonHighlights, base, z, tx, ty, pixelShift)
  drawStartFinishLine(ctx, proj, props.line)
  drawSectorGates(ctx, proj, props.gates ?? [])
  drawExtremaMarkers(ctx, proj, props.extremaMarkers ?? [])
  drawCursorMarker(ctx, px, py, props.cursorIdx, n)
}

// ── zoom / pan ──────────────────────────────────────────────────────────────

/**
 * Keep the track from being dragged entirely off-screen: each axis is clamped so
 * at least PAN_MARGIN px of the track's bbox stays inside the canvas. When the
 * track is smaller than the visible area the allowed range collapses, so we
 * centre it instead.
 */
const PAN_MARGIN = 48
function clampPan(): void {
  if (!lastW || !lastH || Number.isNaN(baseMinX)) return
  const z = zoom.value
  panX.value = clampPanAxis(panX.value, baseMinX, baseMaxX, lastW, z, PAN_MARGIN)
  panY.value = clampPanAxis(panY.value, baseMinY, baseMaxY, lastH, z, PAN_MARGIN)
}

/** Zoom by `factor` while keeping the geo point under screen (sx, sy) fixed. */
function zoomAbout(sx: number, sy: number, factor: number): void {
  const next = computeZoomAbout(sx, sy, factor, zoom.value, panX.value, panY.value, MIN_ZOOM, MAX_ZOOM)
  zoom.value = next.zoom
  panX.value = next.panX
  panY.value = next.panY
  clampPan()
}

function resetView(): void {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  draw()
}

// Auto-fit margin around the focus segment's bbox, in CSS px (keeps the
// emphasized segment from touching the canvas edge).
const FOCUS_FIT_PAD = 48
// A focus bbox smaller than this fraction of the canvas (at zoom 1) isn't
// worth auto-fitting — it's already comfortably visible, so leave the user's
// current pan/zoom alone (conservative: emphasize always via the draw path
// above, auto-fit only for a real, zoomable-in sub-segment).
const FOCUS_FIT_MIN_FRACTION = 0.4

/**
 * Auto-fit the view (zoom/pan) to the focus segment's base-pixel bbox
 * (captured during the last draw() as focusMinX/Y..focusMaxX/Y), when that
 * bbox is a real sub-segment worth zooming into. Conservative by design —
 * see the task's "don't fight the user's manual pan/zoom" rule:
 *  - Only runs on a focusRange prop CHANGE (the watcher below), never on
 *    every draw/redraw, so panning/zooming the map manually while a focus is
 *    active is never overridden.
 *  - Skips entirely if the focus bbox already fills most of the canvas at
 *    zoom 1 (FOCUS_FIT_MIN_FRACTION) — a "sub-range" that's actually most of
 *    the visible track doesn't need zooming in further.
 *  - Skips if there's no valid bbox (no fixes in range) or no canvas size yet.
 */
function fitToFocus(): void {
  if (!lastW || !lastH || Number.isNaN(focusMinX) || Number.isNaN(baseMinX)) return
  const fit = computeFocusFit(
    { minX: focusMinX, maxX: focusMaxX, minY: focusMinY, maxY: focusMaxY },
    { minX: baseMinX, maxX: baseMaxX, minY: baseMinY, maxY: baseMaxY },
    lastW,
    lastH,
    FOCUS_FIT_PAD,
    FOCUS_FIT_MIN_FRACTION,
    MIN_ZOOM,
    MAX_ZOOM,
  )
  if (!fit) return
  zoom.value = fit.zoom
  panX.value = fit.panX
  panY.value = fit.panY
  clampPan()
}

function onWheel(e: WheelEvent): void {
  const pos = clientPos(e)
  if (!pos) return
  // Exponential so each notch is a constant ratio; deltaY < 0 (scroll up) zooms in.
  zoomAbout(pos.x, pos.y, Math.exp(-e.deltaY * 0.0015))
  draw()
}

// ── pointer handling ─────────────────────────────────────────────────────────

// Active pointers (by id) and the current interaction mode. 'idle' means hover
// (mouse, no button) → scrub the nearest sample; a press picks line / pan / pinch.
const pointers = new Map<number, { x: number; y: number }>()
type Mode = 'idle' | 'line' | 'pan' | 'pinch'
let mode: Mode = 'idle'
// Which handle is being dragged in 'line' mode, and on what target: the
// start/finish line, or a gate (by index into props.gates). Reuses the exact
// same hit radius, pointer-capture and toGeo conversion as the start/finish
// line; only the emitted event and its target line differ.
type DragTarget = { kind: 'line' } | { kind: 'gate'; index: number }
let dragging: { target: DragTarget; handle: 'a' | 'b' } | null = null
let panLast: { x: number; y: number } | null = null
let pinchLast: { dist: number; cx: number; cy: number } | null = null

/** Position relative to the canvas, in CSS px, from any event with clientX/Y. */
function clientPos(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
  if (!canvas.value) return null
  const rect = canvas.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function twoPointers(): [{ x: number; y: number }, { x: number; y: number }] | null {
  if (pointers.size < 2) return null
  const it = pointers.values()
  return [it.next().value!, it.next().value!]
}

/** Squared-distance hit test for a single line's two endpoints, shared below. */
function nearestHandle(
  line: LapLine,
  mx: number,
  my: number,
): { handle: 'a' | 'b'; distSq: number } | null {
  if (!projection) return null
  const a = projection.toPixel(line.a.lat, line.a.lon)
  const b = projection.toPixel(line.b.lat, line.b.lon)
  const da = (a.x - mx) ** 2 + (a.y - my) ** 2
  const db = (b.x - mx) ** 2 + (b.y - my) ** 2
  const hit = HANDLE_HIT * HANDLE_HIT
  if (da > hit && db > hit) return null
  return da <= db ? { handle: 'a', distSq: da } : { handle: 'b', distSq: db }
}

/**
 * Which handle (if any) is under the pointer, within the hit radius — checked
 * across the start/finish line AND every gate. When several targets' handles
 * overlap, the closest one wins.
 */
function handleAt(mx: number, my: number): { target: DragTarget; handle: 'a' | 'b' } | null {
  if (!projection) return null
  let best: { target: DragTarget; handle: 'a' | 'b'; distSq: number } | null = null

  if (props.line) {
    const hit = nearestHandle(props.line, mx, my)
    if (hit) best = { target: { kind: 'line' }, handle: hit.handle, distSq: hit.distSq }
  }

  const gates = props.gates ?? []
  gates.forEach((g, index) => {
    const hit = nearestHandle(g.line, mx, my)
    if (hit && (!best || hit.distSq < best.distSq)) {
      best = { target: { kind: 'gate', index }, handle: hit.handle, distSq: hit.distSq }
    }
  })

  return best ? { target: best.target, handle: best.handle } : null
}

function onPointerDown(e: PointerEvent): void {
  const pos = clientPos(e)
  if (!pos) return
  pointers.set(e.pointerId, pos)
  canvas.value?.setPointerCapture(e.pointerId)

  if (pointers.size >= 2) {
    // Second finger down → pinch zoom/pan; abandon any line/pan in progress.
    mode = 'pinch'
    dragging = null
    const [p1, p2] = twoPointers()!
    pinchLast = { dist: Math.hypot(p2.x - p1.x, p2.y - p1.y), cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2 }
    e.preventDefault()
    return
  }

  // Single pointer: grab a start/finish or confirmed-gate handle if one is
  // under it, else pan.
  const h = handleAt(pos.x, pos.y)
  if (h) {
    mode = 'line'
    dragging = h
  } else {
    mode = 'pan'
    panLast = pos
  }
  e.preventDefault()
}

function onPointerMove(e: PointerEvent): void {
  if (pointers.has(e.pointerId)) {
    const pos = clientPos(e)
    if (pos) pointers.set(e.pointerId, pos)
  }

  if (mode === 'pinch') {
    const two = twoPointers()
    if (!two || !pinchLast) return
    const [p1, p2] = two
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const cx = (p1.x + p2.x) / 2
    const cy = (p1.y + p2.y) / 2
    if (dist > 0 && pinchLast.dist > 0) zoomAbout(cx, cy, dist / pinchLast.dist)
    // Also translate by the midpoint movement so a two-finger drag pans.
    panX.value += cx - pinchLast.cx
    panY.value += cy - pinchLast.cy
    clampPan()
    pinchLast = { dist, cx, cy }
    draw()
    return
  }

  if (mode === 'line' && dragging && projection) {
    const pos = clientPos(e)
    if (!pos) return
    const geo = projection.toGeo(pos.x, pos.y)
    const { target, handle } = dragging
    if (target.kind === 'line') {
      if (!props.line) return
      const next: LapLine = { a: { ...props.line.a }, b: { ...props.line.b } }
      next[handle] = { lat: geo.lat, lon: geo.lon }
      emit('update:line', next)
    } else {
      const g = (props.gates ?? [])[target.index]
      if (!g) return
      const next: LapLine = { a: { ...g.line.a }, b: { ...g.line.b } }
      next[handle] = { lat: geo.lat, lon: geo.lon }
      emit('update:gate', target.index, next)
    }
    return
  }

  if (mode === 'pan') {
    const pos = clientPos(e)
    if (!pos || !panLast) return
    panX.value += pos.x - panLast.x
    panY.value += pos.y - panLast.y
    panLast = pos
    clampPan()
    draw()
    return
  }

  // Idle hover (mouse, no button): scrub the nearest sample for chart sync.
  // Only selects when the pointer is actually near the track line (HIT radius),
  // so the whitespace around it doesn't snap to the outermost point.
  if (!px || !py) return
  const pos = clientPos(e)
  if (!pos) return
  const HIT = 24
  emit('cursor', nearestSample(px, py, pos.x, pos.y, HIT))
}

function onPointerUp(e: PointerEvent): void {
  pointers.delete(e.pointerId)
  canvas.value?.releasePointerCapture(e.pointerId)

  if (mode === 'pinch') {
    // Lifting one finger of a pinch → continue panning with the one that remains.
    if (pointers.size === 1) {
      mode = 'pan'
      panLast = pointers.values().next().value ?? null
      pinchLast = null
    } else if (pointers.size === 0) {
      mode = 'idle'
      pinchLast = null
    }
    return
  }

  if (pointers.size === 0) {
    mode = 'idle'
    dragging = null
    panLast = null
  }
}

function onPointerLeave(): void {
  // Clear the scrub cursor only when not mid-gesture (capture keeps gestures alive).
  if (mode === 'idle') emit('cursor', null)
}

// B30 — coalesce cursorIdx-driven redraws to at most one per animation frame.
// `draw()` re-renders the WHOLE canvas every time (full track polyline,
// heatmap buckets, highlight/comparison segments, gates, extrema
// labels/strokeText, start/finish band — see the function above), not just
// the cursor dot. `watch(() => props.cursorIdx, () => draw())` used to call
// that full pipeline SYNCHRONOUSLY on every single hover-driven cursor
// change — i.e. on every mousemove pixel, since map→chart cursor forwarding
// (TrackMap's own idle-hover branch in onPointerMove below) emits a new
// cursorIdx on every pointermove. On a real multi-lap/heatmap track (tens of
// thousands of samples, HEAT_BUCKETS strokes, per-marker strokeText/fillText)
// a single draw() can take long enough that a fast mouse move floods the main
// thread with a backlog of queued draw() calls it can't keep up with — from
// the user's POV the map cursor "freezes" near wherever it first landed while
// the backlog slowly (or never, in practice) catches up, exactly matching the
// "only the first touched point registers, not continuous" symptom. This
// doesn't reproduce on a small synthetic track (draw() is cheap enough there
// to always keep up), which is why it wasn't caught by a plain small-fixture
// component test.
//
// scheduleDraw() fixes this the standard way: coalesce however many
// cursorIdx changes land within one frame into a SINGLE draw() call that
// reads props.cursorIdx fresh (not a captured stale value) — so the render
// loop can never fall behind the input rate, capping redraw work to the
// display's own refresh rate regardless of how fast the pointer moves. Only
// used for the two purely-hover-driven triggers below (the cursorIdx prop
// watch, and onPointerLeave's clear-to-null) — every OTHER draw() call site
// (zoom/pan, line/gate drag, resize, focusRange fit) stays synchronous and
// unchanged, since those either need draw()'s side effects (focusMinX/Y etc.)
// available immediately afterward, or aren't high-frequency enough to matter.
let cursorDrawScheduled = false
function scheduleDraw(): void {
  if (cursorDrawScheduled) return
  cursorDrawScheduled = true
  requestAnimationFrame(() => {
    cursorDrawScheduled = false
    draw()
  })
}

onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (canvas.value) ro.observe(canvas.value)
  // dpr / viewport changes (devtools device-mode toggle) may not trigger RO.
  window.addEventListener('resize', draw)
  window.addEventListener('keydown', onMaximizedKeydown)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', draw)
  window.removeEventListener('keydown', onMaximizedKeydown)
})

// A new track has a different fit, so any prior zoom/pan no longer makes sense.
watch(() => props.track, () => resetView())
watch(() => props.cursorIdx, () => scheduleDraw())
watch(() => props.line, () => draw())
watch(() => props.highlightLaps, () => draw())
watch(() => props.comparisonLapHighlights, () => draw())
// #7: on a focusRange CHANGE (not every draw — see fitToFocus's docs), draw
// once to (re)capture this range's base-pixel bbox, auto-fit the view to it
// when it's a real sub-segment, then draw again to render at the new
// zoom/pan. Emphasis rendering itself happens unconditionally inside draw()
// (already covered by this watch firing draw() at least once).
watch(
  () => props.focusRange,
  (r) => {
    draw()
    if (r) fitToFocus()
    draw()
  },
)
watch(() => props.colorValues, () => draw())
watch(() => props.colormap, () => draw())
watch(() => props.gates, () => draw())
watch(() => props.extremaMarkers, () => draw())
// Multi-file overlay: toggling a session on/off changes what's drawn AND the
// combined fit (fitProjection bounds), so just redraw — the user's zoom/pan
// is deliberately left alone (unlike a track IDENTITY change above, an
// overlay toggle is an additive comparison act, not a context switch; the
// re-fit only matters at zoom 1, and clampPan keeps any current pan legal
// against the new bbox on the next gesture).
watch(() => props.overlayTracks, () => draw())
</script>

<template>
  <!-- In-card maximize (B7): no Teleport — the map stays exactly where it is
       in the grid/card DOM. `maximized` only adds a class hook (for any
       future styling) and is emitted to the host, which hides its OTHER body
       content so `.fill`'s existing flex-grow expands the map to fill the
       card (see the `maximized` ref's module doc above). -->
  <div class="track-wrap" :class="{ fill: fillHeight, maximized }">
    <canvas
      ref="canvas"
      class="track"
      :class="{ fill: fillHeight, maximized }"
      v-tooltip="t('analyzer.zoomHint')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @wheel.prevent="onWheel"
      @dblclick="resetView"
    />
    <button v-if="showReset" type="button" class="reset-view" @click="resetView">
      {{ t('analyzer.resetView') }}
    </button>
    <button
      v-if="!maximized"
      type="button"
      class="maximize-toggle"
      :aria-label="t('analyzer.maximizeMap')"
      v-tooltip="t('analyzer.maximizeMap')"
      @click="toggleMaximize"
    >
      <span aria-hidden="true">⛶</span>
    </button>
    <button
      v-else
      type="button"
      class="maximize-toggle maximize-toggle--close"
      :aria-label="t('analyzer.minimizeMap')"
      v-tooltip="t('analyzer.minimizeMap')"
      @click="toggleMaximize"
    >
      <span aria-hidden="true">✕</span>
    </button>
  </div>
</template>

<style scoped>
.track-wrap {
  position: relative;
}
/* #8/T1 — inside a dashboard grid item's card body (a flex COLUMN — see
   DashboardCard's `.body`): take the REMAINING space after the card's text
   rows (legend/hints/lap-band inputs) instead of the old `height: 100%`,
   which claimed the whole body and pushed every text row out of view. The
   min-height keeps the map usable when the card is small — beyond that the
   body scrolls rather than squashing the canvas to nothing. */
.track-wrap.fill {
  display: flex;
  /* Basis 0, not auto — the canvas inside sizes itself from THIS wrapper's
     laid-out height (draw() reads clientHeight), so a content-based basis
     would be circular. Basis 0 + grow 1 = "whatever the text rows leave". */
  flex: 1 1 0;
  min-height: 120px;
}
.track {
  display: block;
  width: 100%;
  height: 320px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  /* the map owns wheel/drag/pinch gestures (zoom & pan), like an embedded map */
  touch-action: none;
}
.track.fill {
  height: 100%;
  flex: 1 1 auto;
  min-height: 0;
}
.reset-view {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 10px;
  font-size: 0.8rem;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
.reset-view:hover {
  border-color: var(--color-text-muted);
}

/* B7 — in-card maximize: `.maximized` on `.track-wrap`/`.track` is kept as a
   styling hook (and a stable test/DOM signal of the toggle's state) even
   though no rule currently keys off it — the actual "fill the card" effect
   comes entirely from the host hiding its other body content, which lets
   `.track-wrap.fill`'s existing flex-grow (above) expand into the reclaimed
   space. No fixed/viewport-covering positioning here (unlike the old mobile-
   only fullscreen overlay this replaces): the map never leaves its card. */
.maximize-toggle {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: 1rem;
  line-height: 1;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
.maximize-toggle:hover {
  border-color: var(--color-text-muted);
}
</style>
