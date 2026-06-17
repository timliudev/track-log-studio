<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

const props = defineProps<{
  data: uPlot.AlignedData
  series: uPlot.Series[]
  /** Optional axes (with scale/side); colours are themed here. Defaults to x+y. */
  axes?: uPlot.Axis[]
  /** Shared X zoom range (null = auto). Applied to this chart; user zoom emits xZoom. */
  xRange?: { min: number; max: number } | null
  height?: number
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
        (u: uPlot) => emit('cursor', u.cursor.idx ?? null),
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
</script>

<template>
  <div ref="host" class="uplot-host" />
</template>

<style scoped>
.uplot-host {
  width: 100%;
}
/* uPlot's legend is HTML — theme its text (canvas axes are themed via options). */
.uplot-host :deep(.u-legend) {
  color: var(--color-text);
}
</style>
