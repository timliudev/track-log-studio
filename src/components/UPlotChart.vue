<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

const props = defineProps<{
  data: uPlot.AlignedData
  series: uPlot.Series[]
  height?: number
}>()

const emit = defineEmits<{ cursor: [number | null] }>()

const host = ref<HTMLDivElement | null>(null)
let plot: uPlot | null = null
let ro: ResizeObserver | null = null
let themeObs: MutationObserver | null = null

function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function buildOptions(width: number): uPlot.Options {
  // Read theme colours so axis/grid text follows light/dark (incl. auto).
  const axisStroke = themeColor('--color-text-muted', '#888')
  const gridStroke = themeColor('--color-border', '#cccccc')
  const axis = {
    stroke: axisStroke,
    grid: { stroke: gridStroke, width: 1 },
    ticks: { stroke: gridStroke, width: 1 },
  }
  return {
    width,
    height: props.height ?? 260,
    series: props.series,
    axes: [axis, axis],
    legend: { show: true },
    scales: { x: { time: false } },
    cursor: { focus: { prox: 16 } },
    hooks: {
      setCursor: [
        (u: uPlot) => emit('cursor', u.cursor.idx ?? null),
      ],
    },
  }
}

function create(): void {
  if (!host.value) return
  destroy()
  const width = host.value.clientWidth || 600
  plot = new uPlot(buildOptions(width), props.data, host.value)
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
    }
  },
  { deep: false },
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
