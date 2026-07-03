<script lang="ts">
/** One colored series of G-G points: a single lap's or the whole session's points. */
export interface GgSeries {
  points: [number, number][]
  color: string
  /** Legend/tooltip label. */
  name: string
}

/** Axis `name`/`nameLocation`/`nameGap` fields for an echarts axis (#10 — the
 * scatter's X/Y channel names weren't shown anywhere on the chart itself,
 * only in the pickers above it). Returns `{}` when there's no name to show,
 * so spreading it into an axis config is a no-op (keeps echarts' own
 * defaults, i.e. no name). Lives in a plain (non-`setup`) `<script>` block
 * because `<script setup>` can't export plain named bindings — this way the
 * naming rule stays unit-testable (imported directly by test code) without
 * a separate module file or mounting the chart. */
export function axisNameFields(name: string | null | undefined): {
  name?: string
  nameLocation?: 'middle'
  nameGap?: number
} {
  if (!name) return {}
  return { name, nameLocation: 'middle', nameGap: 28 }
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([ScatterChart, GridComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{
  series: GgSeries[]
  height?: number
  /** Adaptive axis rule (A10+A12 — GgChart is now the shared renderer for
   *  ANY XY scatter, not just friction circles): 'square' draws symmetric
   *  axes about 0 sized to the max |value| (the friction-circle look) —
   *  meaningful only when both channels are signed force-like data.
   *  'auto' (default) lets each axis auto-range independently, matching a
   *  normal scatter of unrelated channels (e.g. RPM vs speed). The caller
   *  decides the mode from the actual data range (min<0<max on both axes),
   *  not the channel name — see ScatterChart.vue's `axisMode`. */
  axisMode?: 'square' | 'auto'
  /** Channel name shown on the X axis (#10 — axes were unlabeled, so a
   *  free-XY scatter gave no clue which channel was plotted where). Undefined
   *  omits the axis name entirely (falls back to echarts' default of none). */
  xName?: string | null
  /** Channel name shown beside the Y axis; see `xName`. */
  yName?: string | null
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null
let themeObs: MutationObserver | null = null

function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Square axis range symmetric about 0, sized to the max |g| across all series
 * (rounded up to the nearest 0.5g so the range has a little headroom). */
function computeMaxAbs(series: GgSeries[]): number {
  let max = 0
  for (const s of series) {
    for (const [x, y] of s.points) {
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      if (ax > max) max = ax
      if (ay > max) max = ay
    }
  }
  if (max <= 0) return 1
  return Math.ceil(max * 2) / 2
}

function buildOption(): echarts.EChartsCoreOption {
  const axisStroke = themeColor('--color-text-muted', '#888')
  const gridStroke = themeColor('--color-border', '#ccc')
  const square = (props.axisMode ?? 'auto') === 'square'
  const bound = square ? computeMaxAbs(props.series) : undefined

  const sharedAxis = {
    type: 'value' as const,
    ...(square ? { min: -bound!, max: bound! } : {}),
    axisLine: { lineStyle: { color: axisStroke } },
    axisLabel: { color: axisStroke },
    splitLine: { lineStyle: { color: gridStroke } },
    nameTextStyle: { color: axisStroke },
  }

  // Extra grid margin so the axis `name` (below the X axis, left of the Y
  // axis's tick labels) has room without being clipped by the chart edge.
  const hasXName = Boolean(props.xName)
  const hasYName = Boolean(props.yName)

  return {
    animation: false,
    grid: {
      left: hasYName ? 64 : 48,
      right: 16,
      top: 16,
      bottom: hasXName ? 56 : 40,
      containLabel: false,
    },
    tooltip: {
      trigger: 'item',
      formatter: (p: { seriesName?: string; value?: number[] }) => {
        const v = p.value ?? [0, 0]
        const unit = square ? ' g' : ''
        return `${p.seriesName ?? ''}<br/>X: ${v[0].toFixed(2)}${unit}<br/>Y: ${v[1].toFixed(2)}${unit}`
      },
    },
    xAxis: { ...sharedAxis, ...axisNameFields(props.xName) },
    yAxis: { ...sharedAxis, ...axisNameFields(props.yName) },
    series: props.series.map((s) => ({
      name: s.name,
      type: 'scatter',
      data: s.points,
      symbolSize: 4,
      itemStyle: { color: s.color, opacity: 0.5 },
    })),
  }
}

function render(): void {
  if (!chart) return
  chart.setOption(buildOption(), true)
}

function create(): void {
  if (!host.value) return
  destroy()
  chart = echarts.init(host.value, undefined, {
    width: host.value.clientWidth || 400,
    height: props.height ?? 360,
  })
  render()
}

function destroy(): void {
  chart?.dispose()
  chart = null
}

function resize(): void {
  chart?.resize()
}

onMounted(() => {
  create()
  ro = new ResizeObserver(() => resize())
  if (host.value) ro.observe(host.value)
  window.addEventListener('resize', resize)
  // Re-render with new colours when the theme (data-theme) changes — same
  // pattern as UPlotChart.
  themeObs = new MutationObserver(() => render())
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

watch(
  () => [props.series, props.axisMode, props.xName, props.yName],
  () => render(),
  { deep: false },
)
</script>

<template>
  <div ref="host" class="gg-chart-host" :style="{ height: `${props.height ?? 360}px` }" />
</template>

<style scoped>
.gg-chart-host {
  width: 100%;
}
</style>
