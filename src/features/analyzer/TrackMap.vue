<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'
import { fitProjection, type MapProjection } from './projection'

const props = defineProps<{
  track: GpsTrack | null
  cursorIdx: number | null
  line: LapLine | null
  highlightRange?: { startIdx: number; endIdx: number } | null
}>()
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

  // polyline
  ctx.strokeStyle = cssVar('--color-text-muted')
  ctx.lineWidth = 2
  ctx.beginPath()
  let started = false
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(px[i])) {
      started = false
      continue
    }
    if (!started) {
      ctx.moveTo(px[i], py[i])
      started = true
    } else {
      ctx.lineTo(px[i], py[i])
    }
  }
  ctx.stroke()

  // highlighted lap segment: redraw [startIdx, endIdx] in accent, thicker.
  const hr = props.highlightRange
  if (hr) {
    const lo = Math.max(0, Math.min(hr.startIdx, hr.endIdx))
    const hi = Math.min(n - 1, Math.max(hr.startIdx, hr.endIdx))
    ctx.strokeStyle = cssVar('--color-accent')
    ctx.lineWidth = 3
    ctx.beginPath()
    let on = false
    for (let i = lo; i <= hi; i++) {
      if (Number.isNaN(px[i])) {
        on = false
        continue
      }
      if (!on) {
        ctx.moveTo(px[i], py[i])
        on = true
      } else {
        ctx.lineTo(px[i], py[i])
      }
    }
    ctx.stroke()
  }

  // start/finish line + draggable endpoints
  const line = props.line
  if (line) {
    const a = proj.toPixel(line.a.lat, line.a.lon)
    const b = proj.toPixel(line.b.lat, line.b.lon)
    ctx.strokeStyle = cssVar('--color-accent')
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    // Grab handles: an accent fill ringed by the surface colour so they read as
    // draggable and stay distinct from the (smaller, ring-less) cursor dot.
    const accent = cssVar('--color-accent')
    const ring = cssVar('--color-surface')
    for (const p of [a, b]) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2)
      ctx.fillStyle = accent
      ctx.fill()
      ctx.lineWidth = 2.5
      ctx.strokeStyle = ring
      ctx.stroke()
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
watch(() => props.highlightRange, () => draw())
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
