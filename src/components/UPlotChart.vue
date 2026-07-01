<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { panRange, pinchRange, type XRange } from '@/features/analyzer/xRangeGesture'

const props = defineProps<{
  data: uPlot.AlignedData
  series: uPlot.Series[]
  /** Optional axes (with scale/side); colours are themed here. Defaults to x+y. */
  axes?: uPlot.Axis[]
  /** Shared X zoom range (null = auto). Applied to this chart; user zoom emits xZoom. */
  xRange?: { min: number; max: number } | null
  height?: number
  externalCursor?: number | null
}>()

const emit = defineEmits<{
  cursor: [number | null]
  xZoom: [{ min: number; max: number }]
}>()

const host = ref<HTMLDivElement | null>(null)
let plot: uPlot | null = null
let ro: ResizeObserver | null = null
let themeObs: MutationObserver | null = null
// Guard so programmatic setScale (from a synced xRange) doesn't echo back out.
let applyingRange = false
let applyingCursor = false

function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function buildOptions(width: number): uPlot.Options {
  // Read theme colours so axis/grid text follows light/dark (incl. auto).
  const axisStroke = themeColor('--color-text-muted', '#888')
  const gridStroke = themeColor('--color-border', '#cccccc')
  // Apply theme to each axis; keep a per-axis stroke if the caller set one
  // (used to colour each value axis to match its series).
  const themed = (a: uPlot.Axis): uPlot.Axis => ({
    grid: { stroke: gridStroke, width: 1 },
    ticks: { stroke: gridStroke, width: 1 },
    ...a,
    stroke: a.stroke ?? axisStroke,
  })
  const axes = (props.axes ?? [{}, {}]).map(themed)
  return {
    width,
    height: props.height ?? 260,
    series: props.series,
    axes,
    legend: { show: true },
    scales: { x: { time: false } },
    cursor: { focus: { prox: 16 } },
    hooks: {
      setCursor: [
        (u: uPlot) => {
          if (!applyingCursor) emit('cursor', u.cursor.idx ?? null)
        },
      ],
      setScale: [
        (u: uPlot, key: string) => {
          if (key !== 'x' || applyingRange) return
          const { min, max } = u.scales.x
          if (min != null && max != null) emit('xZoom', { min, max })
        },
      ],
    },
  }
}

function applyXRange(): void {
  if (!plot || !props.xRange) return
  applyingRange = true
  plot.setScale('x', { min: props.xRange.min, max: props.xRange.max })
  applyingRange = false
}

function create(): void {
  if (!host.value) return
  destroy()
  const width = host.value.clientWidth || 600
  plot = new uPlot(buildOptions(width), props.data, host.value)
  applyXRange() // adopt the shared zoom on (re)create, e.g. a newly added chart
}

function destroy(): void {
  plot?.destroy()
  plot = null
}

// ── touch gestures (#8) ──────────────────────────────────────────────────────
// uPlot's built-in drag-box zoom only binds mouse events, so touch/pen input is
// dead on this chart by default. We add our own Pointer Event handling for
// touch/pen only (mouse is left to uPlot's native mousedown/mousemove/mouseup
// drag-zoom + hover-scrub, untouched) and translate gestures into X-range
// changes via the same `xZoom` event the mouse drag-zoom path already emits —
// so the shared X range still has a single owner (analyzerStore.xRange, or a
// local xRange for callers that don't sync one), rather than each chart
// maintaining its own touch-only zoom state.
const touchPointers = new Map<number, { x: number; y: number }>()
type TouchMode = 'idle' | 'pan' | 'pinch'
let touchMode: TouchMode = 'idle'
let panLastX = 0
let pinchLast: { dist: number; midX: number } | null = null

/** Current X data-bounds (full data extent), used to clamp touch pan/pinch —
 * same bounds uPlot itself would use for a fully-zoomed-out view. */
function dataXBounds(): XRange | null {
  const xs = props.data[0] as (number | null)[] | undefined
  if (!xs || xs.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const v of xs) {
    if (v == null || !Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!(min < max)) return null
  return { min, max }
}

/** Current visible X range (the shared range if set, else the full extent). */
function currentXRange(): XRange | null {
  if (props.xRange) return props.xRange
  if (!plot) return dataXBounds()
  const { min, max } = plot.scales.x
  if (min == null || max == null) return dataXBounds()
  return { min, max }
}

function emitXRange(range: XRange): void {
  // Reflect immediately so the gesture feels responsive even before the prop
  // round-trips back down (parent may re-derive xRange asynchronously).
  applyingRange = true
  plot?.setScale('x', range)
  applyingRange = false
  emit('xZoom', range)
}

function touchMidpoint(): { x: number; y: number } | null {
  if (touchPointers.size < 2) return null
  const it = touchPointers.values()
  const p1 = it.next().value!
  const p2 = it.next().value!
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
}

function touchDist(): number {
  if (touchPointers.size < 2) return 0
  const it = touchPointers.values()
  const p1 = it.next().value!
  const p2 = it.next().value!
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

/** CSS-px position within the plotting area (u.over), for uPlot's valToPos/posToVal. */
function overPos(e: PointerEvent): { x: number; y: number } | null {
  const over = plot?.over
  if (!over) return null
  const rect = over.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse') return // mouse keeps uPlot's native drag-zoom
  const pos = overPos(e)
  if (!pos || !plot) return
  touchPointers.set(e.pointerId, pos)
  ;(e.target as Element).setPointerCapture?.(e.pointerId)

  if (touchPointers.size >= 2) {
    touchMode = 'pinch'
    const mid = touchMidpoint()
    pinchLast = mid ? { dist: touchDist(), midX: mid.x } : null
  } else {
    touchMode = 'pan'
    panLastX = pos.x
  }
  e.preventDefault()
}

function onPointerMove(e: PointerEvent): void {
  if (e.pointerType === 'mouse') return
  if (!touchPointers.has(e.pointerId)) return
  const pos = overPos(e)
  if (!pos || !plot) return
  touchPointers.set(e.pointerId, pos)

  const bounds = dataXBounds()
  if (!bounds) return
  const range = currentXRange() ?? bounds

  if (touchMode === 'pinch') {
    const mid = touchMidpoint()
    if (!mid || !pinchLast) return
    const dist = touchDist()
    if (dist <= 0 || pinchLast.dist <= 0) return
    const factor = dist / pinchLast.dist
    const aboutVal = plot.posToVal(pinchLast.midX, 'x')
    const midValNow = plot.posToVal(mid.x, 'x')
    const midValPrev = plot.posToVal(pinchLast.midX, 'x')
    const deltaX = midValPrev - midValNow // content should follow the fingers
    emitXRange(pinchRange(range, factor, aboutVal, -deltaX, bounds))
    pinchLast = { dist, midX: mid.x }
    return
  }

  if (touchMode === 'pan') {
    const prevVal = plot.posToVal(panLastX, 'x')
    const curVal = plot.posToVal(pos.x, 'x')
    const deltaX = curVal - prevVal // > 0 when the finger moves right
    // Content should follow the finger (drag right → reveal earlier/smaller X,
    // i.e. the window shifts left) — panRange's deltaX shifts min/max by -deltaX,
    // so pass +deltaX here to get the window to move by -deltaX.
    emitXRange(panRange(range, deltaX, bounds))
    panLastX = pos.x
  }
}

function onPointerUp(e: PointerEvent): void {
  if (e.pointerType === 'mouse') return
  touchPointers.delete(e.pointerId)

  if (touchMode === 'pinch') {
    if (touchPointers.size === 1) {
      touchMode = 'pan'
      panLastX = touchPointers.values().next().value?.x ?? panLastX
      pinchLast = null
    } else if (touchPointers.size === 0) {
      touchMode = 'idle'
      pinchLast = null
    }
    return
  }
  if (touchPointers.size === 0) touchMode = 'idle'
}

/** A signature of the series shape; changing it requires re-creating uPlot. */
function seriesKey(): string {
  return props.series.map((s) => s.label ?? '').join('|')
}

function resize(): void {
  if (plot && host.value) {
    plot.setSize({ width: host.value.clientWidth, height: props.height ?? 260 })
  }
}

onMounted(() => {
  create()
  ro = new ResizeObserver(() => resize())
  if (host.value) ro.observe(host.value)
  // dpr / viewport changes (e.g. devtools device-mode toggle) don't trigger the
  // element ResizeObserver — also redraw on window resize.
  window.addEventListener('resize', resize)
  // Recreate with new colours when the theme (data-theme) changes.
  themeObs = new MutationObserver(() => create())
  themeObs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onBeforeUnmount(() => {
  ro?.disconnect()
  themeObs?.disconnect()
  window.removeEventListener('resize', resize)
  destroy()
})

// Data-only change → fast setData. Series structure change → recreate.
let lastKey = ''
watch(
  () => [props.data, props.series],
  () => {
    const key = seriesKey()
    if (!plot || key !== lastKey) {
      lastKey = key
      create()
    } else {
      plot.setData(props.data)
      applyXRange()
    }
  },
  { deep: false },
)

// Sync this chart to the shared X zoom range.
watch(
  () => props.xRange,
  () => applyXRange(),
)

watch(
  () => props.externalCursor,
  (idx) => {
    if (!plot || idx == null) return
    const xVal = (plot.data[0] as number[])[idx]
    if (!Number.isFinite(xVal)) return
    const left = plot.valToPos(xVal, 'x')
    if (!Number.isFinite(left)) return
    applyingCursor = true
    plot.setCursor({ left, top: 0 })
    applyingCursor = false
  },
)
</script>

<template>
  <div
    ref="host"
    class="uplot-host"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  />
</template>

<style scoped>
.uplot-host {
  width: 100%;
  /* This chart sits in a scrollable page, unlike TrackMap's dedicated canvas —
     so unlike TrackMap's `touch-action: none`, we keep vertical page scroll
     available (pan-y) and only claim horizontal drag + pinch for our own
     pan/zoom gesture handling (see onPointerDown/Move/Up above). */
  touch-action: pan-y;
}
/* uPlot's legend is HTML — theme its text (canvas axes are themed via options). */
.uplot-host :deep(.u-legend) {
  color: var(--color-text);
}
</style>
