<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'

const props = defineProps<{
  track: GpsTrack | null
  cursorIdx: number | null
}>()
const emit = defineEmits<{ cursor: [number | null] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let ro: ResizeObserver | null = null

// Projected pixel coords per sample (NaN where no fix); recomputed on draw.
let px: Float64Array | null = null
let py: Float64Array | null = null

const PAD = 16

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
  if (!track) return

  // bounds over valid fixes
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  let count = 0
  for (let i = 0; i < track.valid.length; i++) {
    if (!track.valid[i]) continue
    count++
    if (track.lat[i] < minLat) minLat = track.lat[i]
    if (track.lat[i] > maxLat) maxLat = track.lat[i]
    if (track.lon[i] < minLon) minLon = track.lon[i]
    if (track.lon[i] > maxLon) maxLon = track.lon[i]
  }
  if (count < 2) return

  const latMean = ((minLat + maxLat) / 2) * (Math.PI / 180)
  const spanX = Math.max((maxLon - minLon) * Math.cos(latMean), 1e-9)
  const spanY = Math.max(maxLat - minLat, 1e-9)
  const scale = Math.min((w - 2 * PAD) / spanX, (h - 2 * PAD) / spanY)
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2

  const n = track.valid.length
  px = new Float64Array(n)
  py = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (!track.valid[i]) {
      px[i] = NaN
      py[i] = NaN
      continue
    }
    px[i] = offX + (track.lon[i] - minLon) * Math.cos(latMean) * scale
    py[i] = h - (offY + (track.lat[i] - minLat) * scale) // flip Y
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

  // cursor marker
  const ci = props.cursorIdx
  if (ci != null && ci >= 0 && ci < n && !Number.isNaN(px[ci])) {
    ctx.fillStyle = cssVar('--color-accent')
    ctx.beginPath()
    ctx.arc(px[ci], py[ci], 5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!px || !py || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < px.length; i++) {
    if (Number.isNaN(px[i])) continue
    const dx = px[i] - mx
    const dy = py[i] - my
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

onMounted(() => {
  draw()
  ro = new ResizeObserver(() => draw())
  if (canvas.value) ro.observe(canvas.value)
})
onBeforeUnmount(() => ro?.disconnect())

watch(() => props.track, () => draw())
watch(() => props.cursorIdx, () => draw())
</script>

<template>
  <canvas
    ref="canvas"
    class="track"
    @pointermove="onPointerMove"
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
