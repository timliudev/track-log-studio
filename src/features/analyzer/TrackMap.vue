<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'
import { colormapSwatches, type ColormapId } from '@/domain/analysis/colormap'
import { fitProjection, type MapProjection } from './projection'

const props = defineProps<{
  track: GpsTrack | null
  cursorIdx: number | null
  line: LapLine | null
  /** Selected laps to draw, each as a colored [startIdx, endIdx] segment. */
  highlightLaps?: { startIdx: number; endIdx: number; color: string }[]
  /**
   * Per-sample normalised value in [0, 1] (NaN where uncoloured) for the track
   * heatmap, or null to draw the plain track. Colours come from {@link colormap}.
   */
  colorValues?: Float64Array | null
  colormap?: ColormapId
}>()

// Number of discrete colour buckets: caps strokes per frame regardless of
// sample count, so the heatmap stays as cheap as the plain single-stroke track.
const HEAT_BUCKETS = 32
const emit = defineEmits<{ cursor: [number | null]; 'update:line': [LapLine] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let ro: ResizeObserver | null = null

// Projected pixel coords per sample (NaN where no fix); recomputed on draw.
let px: Float64Array | null = null
let py: Float64Array | null = null
// The projection used by the last draw(); shared with line hit-testing/dragging.
let projection: MapProjection | null = null

// Which start/finish handle is being dragged ('a' | 'b'), or null when idle.
let dragging: 'a' | 'b' | null = null

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

  projection = fitProjection(track, w, h, PAD)
  if (!projection) return
  const proj = projection

  const n = track.valid.length
  px = new Float64Array(n)
  py = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (!track.valid[i]) {
      px[i] = NaN
      py[i] = NaN
      continue
    }
    const p = proj.toPixel(track.lat[i], track.lon[i])
    px[i] = p.x
    py[i] = p.y
  }

  // Helper: stroke the polyline over sample range [lo, hi] (inclusive), breaking
  // the path across gaps (NaN) so missing fixes don't draw bogus connectors.
  const strokeRange = (lo: number, hi: number): void => {
    ctx.beginPath()
    let on = false
    for (let i = lo; i <= hi; i++) {
      if (Number.isNaN(px![i])) {
        on = false
        continue
      }
      if (!on) {
        ctx.moveTo(px![i], py![i])
        on = true
      } else {
        ctx.lineTo(px![i], py![i])
      }
    }
    ctx.stroke()
  }

  // Heatmap: stroke [lo, hi] gradient-coloured by props.colorValues. Segments are
  // bucketed by their (quantised) value so we issue at most HEAT_BUCKETS strokes
  // instead of one per segment. A segment is skipped if either endpoint is a gap
  // (NaN px) or has no colour (NaN value).
  const colorVals = props.colorValues
  const swatches = colorVals ? colormapSwatches(props.colormap ?? 'turbo', HEAT_BUCKETS) : []
  const strokeHeatmap = (lo: number, hi: number, width: number): void => {
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
        ctx.moveTo(px![i], py![i])
        ctx.lineTo(px![i + 1], py![i + 1])
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
    if (heat) {
      strokeHeatmap(lo, hi, 3)
    } else {
      ctx.strokeStyle = lap.color
      ctx.lineWidth = 3
      strokeRange(lo, hi)
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

  // cursor marker
  const ci = props.cursorIdx
  if (ci != null && ci >= 0 && ci < n && !Number.isNaN(px[ci])) {
    ctx.fillStyle = cssVar('--color-accent')
    ctx.beginPath()
    ctx.arc(px[ci], py[ci], 5, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Pointer position relative to the canvas, in CSS px. */
function pointerPos(e: PointerEvent): { x: number; y: number } | null {
  if (!canvas.value) return null
  const rect = canvas.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
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
  const pos = pointerPos(e)
  if (!pos) return
  const h = handleAt(pos.x, pos.y)
  if (!h) return
  dragging = h
  canvas.value?.setPointerCapture(e.pointerId)
  e.preventDefault()
}

function onPointerMove(e: PointerEvent): void {
  // While dragging a handle, move the line and suppress the chart cursor.
  if (dragging && projection && props.line) {
    const pos = pointerPos(e)
    if (!pos) return
    const geo = projection.toGeo(pos.x, pos.y)
    const next: LapLine = { a: { ...props.line.a }, b: { ...props.line.b } }
    next[dragging] = { lat: geo.lat, lon: geo.lon }
    emit('update:line', next)
    return
  }

  if (!px || !py) return
  const pos = pointerPos(e)
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
  if (dragging) {
    canvas.value?.releasePointerCapture(e.pointerId)
    dragging = null
  }
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

watch(() => props.track, () => draw())
watch(() => props.cursorIdx, () => draw())
watch(() => props.line, () => draw())
watch(() => props.highlightLaps, () => draw())
watch(() => props.colorValues, () => draw())
watch(() => props.colormap, () => draw())
</script>

<template>
  <canvas
    ref="canvas"
    class="track"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointerleave="emit('cursor', null)"
  />
</template>

<style scoped>
.track {
  width: 100%;
  height: 320px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  /* allow vertical page scrolling when a finger passes over the map */
  touch-action: pan-y;
}
</style>
