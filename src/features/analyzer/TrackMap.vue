<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'
import { colormapSwatches, type ColormapId } from '@/domain/analysis/colormap'
import { fitProjection, type MapProjection } from './projection'

const props = defineProps<{
  track: GpsTrack | null
  cursorIdx: number | null
  line: LapLine | null
  /**
   * Selected laps to draw, each as a colored [startIdx, endIdx] segment. An
   * optional `offset` (metres east/north) shifts just that lap's polyline so
   * GNSS-drifted racing lines can be aligned on the map (#9 spatial half).
   */
  highlightLaps?: { startIdx: number; endIdx: number; color: string; offset?: { x: number; y: number } }[]
  /**
   * Per-sample normalised value in [0, 1] (NaN where uncoloured) for the track
   * heatmap, or null to draw the plain track. Colours come from {@link colormap}.
   */
  colorValues?: Float64Array | null
  colormap?: ColormapId
  /**
   * Sector gates: confirmed (solid, numbered) and pending auto-detected
   * suggestions (dashed, awaiting user accept/reject) — same line shape as
   * the start/finish line, drawn smaller and in a distinct colour so they
   * don't read as another start/finish.
   */
  gates?: { line: LapLine; confirmed: boolean }[]
}>()

// Fixed, theme-independent colour for sector gates — distinct from the accent
// red (cursor / start-finish handles) and from the lap-identity palette.
const GATE_COLOR = '#00c2ff'

// Number of discrete colour buckets: caps strokes per frame regardless of
// sample count, so the heatmap stays as cheap as the plain single-stroke track.
const HEAT_BUCKETS = 32
const emit = defineEmits<{ cursor: [number | null]; 'update:line': [LapLine] }>()

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

const showReset = computed(() => zoom.value !== 1 || panX.value !== 0 || panY.value !== 0)

const PAD = 16
// Visible endpoint radius and a larger touch-friendly hit radius (~44px target).
const HANDLE_R = 8
const HANDLE_HIT = 22

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'
}

function draw(): void {
  const cv = canvas.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth
  const h = cv.clientHeight
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const track = props.track
  if (!track) {
    projection = null
    return
  }

  const base = fitProjection(track, w, h, PAD)
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
  const view: MapProjection = {
    toPixel(lat, lon) {
      const p = base.toPixel(lat, lon)
      return { x: p.x * z + tx, y: p.y * z + ty }
    },
    toGeo(sx, sy) {
      return base.toGeo((sx - tx) / z, (sy - ty) / z)
    },
  }
  projection = view
  const proj = view

  const n = track.valid.length
  px = new Float64Array(n)
  py = new Float64Array(n)
  // Track the base-pixel bbox while projecting so panning can be clamped.
  let bMinX = Infinity
  let bMaxX = -Infinity
  let bMinY = Infinity
  let bMaxY = -Infinity
  for (let i = 0; i < n; i++) {
    if (!track.valid[i]) {
      px[i] = NaN
      py[i] = NaN
      continue
    }
    const p = base.toPixel(track.lat[i], track.lon[i])
    if (p.x < bMinX) bMinX = p.x
    if (p.x > bMaxX) bMaxX = p.x
    if (p.y < bMinY) bMinY = p.y
    if (p.y > bMaxY) bMaxY = p.y
    px[i] = p.x * z + tx
    py[i] = p.y * z + ty
  }
  if (bMinX <= bMaxX) {
    baseMinX = bMinX
    baseMaxX = bMaxX
    baseMinY = bMinY
    baseMaxY = bMaxY
  }

  // Helper: stroke the polyline over sample range [lo, hi] (inclusive), breaking
  // the path across gaps (NaN) so missing fixes don't draw bogus connectors.
  // (dx, dy) is a constant pixel shift applied to this stroke (for #9 lap offset).
  const strokeRange = (lo: number, hi: number, dx = 0, dy = 0): void => {
    ctx.beginPath()
    let on = false
    for (let i = lo; i <= hi; i++) {
      if (Number.isNaN(px![i])) {
        on = false
        continue
      }
      if (!on) {
        ctx.moveTo(px![i] + dx, py![i] + dy)
        on = true
      } else {
        ctx.lineTo(px![i] + dx, py![i] + dy)
      }
    }
    ctx.stroke()
  }

  // Reference geo point + cos(lat) for converting a metres offset to a CONSTANT
  // pixel shift. The projection is affine, so a fixed geo delta maps to a fixed
  // pixel delta regardless of where it's measured; project a ref point and the
  // ref point + delta, and take the pixel difference.
  let refLat = 0
  let refLon = 0
  let cosRefLat = 1
  for (let i = 0; i < n; i++) {
    if (track.valid[i]) {
      refLat = track.lat[i]
      refLon = track.lon[i]
      cosRefLat = Math.cos((refLat * Math.PI) / 180) || 1
      break
    }
  }
  const M_PER_DEG = 111320
  const pixelShift = (off?: { x: number; y: number }): [number, number] => {
    if (!off || (off.x === 0 && off.y === 0)) return [0, 0]
    const dLat = off.y / M_PER_DEG
    const dLon = off.x / (M_PER_DEG * cosRefLat)
    const p0 = proj.toPixel(refLat, refLon)
    const p1 = proj.toPixel(refLat + dLat, refLon + dLon)
    return [p1.x - p0.x, p1.y - p0.y]
  }

  // Heatmap: stroke [lo, hi] gradient-coloured by props.colorValues. Segments are
  // bucketed by their (quantised) value so we issue at most HEAT_BUCKETS strokes
  // instead of one per segment. A segment is skipped if either endpoint is a gap
  // (NaN px) or has no colour (NaN value).
  const colorVals = props.colorValues
  const swatches = colorVals ? colormapSwatches(props.colormap ?? 'turbo', HEAT_BUCKETS) : []
  const strokeHeatmap = (lo: number, hi: number, width: number, dx = 0, dy = 0): void => {
    if (!colorVals) return
    const buckets: number[][] = Array.from({ length: HEAT_BUCKETS }, () => [])
    for (let i = lo; i < hi; i++) {
      if (Number.isNaN(px![i]) || Number.isNaN(px![i + 1])) continue
      const va = colorVals[i]
      const vb = colorVals[i + 1]
      if (Number.isNaN(va) || Number.isNaN(vb)) continue
      const b = Math.min(HEAT_BUCKETS - 1, Math.max(0, Math.round(((va + vb) / 2) * (HEAT_BUCKETS - 1))))
      buckets[b].push(i)
    }
    ctx.lineWidth = width
    for (let b = 0; b < HEAT_BUCKETS; b++) {
      const seg = buckets[b]
      if (seg.length === 0) continue
      ctx.strokeStyle = swatches[b]
      ctx.beginPath()
      for (const i of seg) {
        ctx.moveTo(px![i] + dx, py![i] + dy)
        ctx.lineTo(px![i + 1] + dx, py![i + 1] + dy)
      }
      ctx.stroke()
    }
  }

  const highlightLaps = props.highlightLaps ?? []
  const heat = !!colorVals

  // Full-track polyline. With no selection it's the normal muted track (or the
  // heatmap if active); with a selection we draw it faint (border color) for
  // context and let the selected laps stand out, per "only show selected laps".
  if (heat && !highlightLaps.length) {
    strokeHeatmap(0, n - 1, 2.5)
  } else {
    ctx.strokeStyle = cssVar(highlightLaps.length ? '--color-border' : '--color-text-muted')
    ctx.lineWidth = 2
    strokeRange(0, n - 1)
  }

  // Selected laps: each [startIdx, endIdx] segment, thicker. Heatmap-coloured by
  // value when a heatmap channel is chosen, else its per-lap identity color.
  for (const lap of highlightLaps) {
    const lo = Math.max(0, Math.min(lap.startIdx, lap.endIdx))
    const hi = Math.min(n - 1, Math.max(lap.startIdx, lap.endIdx))
    const [dx, dy] = pixelShift(lap.offset)
    if (heat) {
      strokeHeatmap(lo, hi, 3, dx, dy)
    } else {
      ctx.strokeStyle = lap.color
      ctx.lineWidth = 3
      strokeRange(lo, hi, dx, dy)
    }
  }

  // start/finish line + draggable endpoints. Drawn as a checkered-flag band
  // (the universal start/finish marker) in the text/surface two-tone so it has
  // contrast in both themes and reads completely differently from the round red
  // (--color-accent) cursor dot and the colourful track/heatmap — the #3 fix.
  const line = props.line
  if (line) {
    const a = proj.toPixel(line.a.lat, line.a.lon)
    const b = proj.toPixel(line.b.lat, line.b.lon)
    const dark = cssVar('--color-text')
    const light = cssVar('--color-surface')

    // Checkered band: two rows of alternating squares laid along the line.
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      const ux = dx / len
      const uy = dy / len
      const nx = -uy // unit perpendicular to the line
      const ny = ux
      const SQ = 6 // target checker square size (px)
      const cols = Math.max(2, Math.round(len / SQ))
      const sq = len / cols // exact size so squares tile the line end-to-end
      const corner = (along: number, perp: number): [number, number] => [
        a.x + ux * along + nx * perp,
        a.y + uy * along + ny * perp,
      ]
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < 2; r++) {
          // r = 0 sits above the centre line (perp −sq..0), r = 1 below (0..sq)
          const a0 = c * sq
          const a1 = (c + 1) * sq
          const p0 = (r - 1) * sq
          const p1 = r * sq
          ctx.fillStyle = (c + r) % 2 === 0 ? dark : light
          ctx.beginPath()
          ctx.moveTo(...corner(a0, p0))
          ctx.lineTo(...corner(a1, p0))
          ctx.lineTo(...corner(a1, p1))
          ctx.lineTo(...corner(a0, p1))
          ctx.closePath()
          ctx.fill()
        }
      }
      // Outline so the band stays delineated against either theme background.
      ctx.strokeStyle = dark
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(...corner(0, -sq))
      ctx.lineTo(...corner(len, -sq))
      ctx.lineTo(...corner(len, sq))
      ctx.lineTo(...corner(0, sq))
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

  // Sector gates: a short perpendicular segment + numbered marker at each
  // gate's midpoint. Confirmed gates are solid; pending suggestions dashed —
  // deliberately smaller/thinner than the checkered start/finish band so the
  // two never get confused.
  const gates = props.gates ?? []
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

  // cursor marker
  const ci = props.cursorIdx
  if (ci != null && ci >= 0 && ci < n && !Number.isNaN(px[ci])) {
    ctx.fillStyle = cssVar('--color-accent')
    ctx.beginPath()
    ctx.arc(px[ci], py[ci], 5, 0, Math.PI * 2)
    ctx.fill()
  }
}

// ── zoom / pan ──────────────────────────────────────────────────────────────

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))
}

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
  const clampAxis = (p: number, bmin: number, bmax: number, size: number): number => {
    const lo = PAN_MARGIN - bmax * z
    const hi = size - PAN_MARGIN - bmin * z
    if (lo > hi) return (lo + hi) / 2
    return Math.min(hi, Math.max(lo, p))
  }
  panX.value = clampAxis(panX.value, baseMinX, baseMaxX, lastW)
  panY.value = clampAxis(panY.value, baseMinY, baseMaxY, lastH)
}

/** Zoom by `factor` while keeping the geo point under screen (sx, sy) fixed. */
function zoomAbout(sx: number, sy: number, factor: number): void {
  const z2 = clampZoom(zoom.value * factor)
  const f = z2 / zoom.value
  panX.value = sx - (sx - panX.value) * f
  panY.value = sy - (sy - panY.value) * f
  zoom.value = z2
  clampPan()
}

function resetView(): void {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
  draw()
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
// Which start/finish handle is being dragged ('a' | 'b') in 'line' mode.
let dragging: 'a' | 'b' | null = null
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

/** Which start/finish handle (if any) is under the pointer, within the hit radius. */
function handleAt(mx: number, my: number): 'a' | 'b' | null {
  if (!props.line || !projection) return null
  const a = projection.toPixel(props.line.a.lat, props.line.a.lon)
  const b = projection.toPixel(props.line.b.lat, props.line.b.lon)
  const da = (a.x - mx) ** 2 + (a.y - my) ** 2
  const db = (b.x - mx) ** 2 + (b.y - my) ** 2
  const hit = HANDLE_HIT * HANDLE_HIT
  if (da <= hit && da <= db) return 'a'
  if (db <= hit) return 'b'
  return null
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

  // Single pointer: grab a start/finish handle if one is under it, else pan.
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

  if (mode === 'line' && dragging && projection && props.line) {
    const pos = clientPos(e)
    if (!pos) return
    const geo = projection.toGeo(pos.x, pos.y)
    const next: LapLine = { a: { ...props.line.a }, b: { ...props.line.b } }
    next[dragging] = { lat: geo.lat, lon: geo.lon }
    emit('update:line', next)
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
  if (!px || !py) return
  const pos = clientPos(e)
  if (!pos) return
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < px.length; i++) {
    if (Number.isNaN(px[i])) continue
    const dx = px[i] - pos.x
    const dy = py[i] - pos.y
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  // Only select when the pointer is actually near the track line, so the
  // whitespace around it doesn't snap to the outermost point.
  const HIT = 24
  emit('cursor', best >= 0 && bestD <= HIT * HIT ? best : null)
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

onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (canvas.value) ro.observe(canvas.value)
  // dpr / viewport changes (devtools device-mode toggle) may not trigger RO.
  window.addEventListener('resize', draw)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', draw)
})

// A new track has a different fit, so any prior zoom/pan no longer makes sense.
watch(() => props.track, () => resetView())
watch(() => props.cursorIdx, () => draw())
watch(() => props.line, () => draw())
watch(() => props.highlightLaps, () => draw())
watch(() => props.colorValues, () => draw())
watch(() => props.colormap, () => draw())
watch(() => props.gates, () => draw())
</script>

<template>
  <div class="track-wrap">
    <canvas
      ref="canvas"
      class="track"
      :title="t('analyzer.zoomHint')"
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
  </div>
</template>

<style scoped>
.track-wrap {
  position: relative;
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
</style>
