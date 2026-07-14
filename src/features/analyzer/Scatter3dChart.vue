<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import 'echarts-gl'
import { xyzPoints } from '@/domain/analysis/scatter3d'
import type { GgSeries } from './GgChart.vue'

echarts.use([TooltipComponent, CanvasRenderer])

const props = defineProps<{
  series: GgSeries[]
  xName: string | null
  yName: string | null
  zName: string | null
  fillHeight?: boolean
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null

function hostSize(): { width: number; height: number } {
  return {
    width: host.value?.clientWidth || 400,
    height: props.fillHeight && (host.value?.clientHeight ?? 0) > 0 ? host.value!.clientHeight : 360,
  }
}

function buildOption(): echarts.EChartsCoreOption {
  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      formatter: (p: { seriesName?: string; value?: unknown[] }) => {
        const [x, y, z] = p.value ?? []
        return `${p.seriesName ?? ''}<br/>${props.xName}: ${Number(x).toFixed(2)}<br/>${props.yName}: ${Number(y).toFixed(2)}<br/>${props.zName}: ${Number(z).toFixed(2)}`
      },
    },
    grid3D: {
      boxWidth: 120,
      boxDepth: 100,
      boxHeight: 100,
      viewControl: {
        projection: 'perspective',
        alpha: 22,
        beta: 35,
        rotateSensitivity: 1,
        zoomSensitivity: 1,
        panSensitivity: 1,
      },
    },
    xAxis3D: { type: 'value', name: props.xName ?? '' },
    yAxis3D: { type: 'value', name: props.yName ?? '' },
    zAxis3D: { type: 'value', name: props.zName ?? '' },
    series: props.series.map((series) => ({
      name: series.name,
      type: 'scatter3D',
      data: xyzPoints({ points: series.points, zValues: series.colorValues }),
      symbolSize: 4,
      itemStyle: { color: series.color, opacity: 0.8 },
    })),
  }
}

function render(): void {
  chart?.setOption(buildOption(), true)
}

function create(): void {
  if (!host.value) return
  chart?.dispose()
  chart = echarts.init(host.value, undefined, hostSize())
  render()
}

onMounted(() => {
  create()
  ro = new ResizeObserver(() => chart?.resize(hostSize()))
  if (host.value) ro.observe(host.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  chart?.dispose()
  chart = null
})

watch(() => [props.series, props.xName, props.yName, props.zName], render, { deep: false })
</script>

<template>
  <div ref="host" class="scatter-3d" :class="{ fill: fillHeight }" />
</template>

<style scoped>
.scatter-3d {
  width: 100%;
  height: 360px;
  min-width: 0;
  /* Let ECharts GL receive one-finger rotation and two-finger zoom directly
     instead of the browser treating the canvas as a page-scroll surface. */
  touch-action: none;
}
.scatter-3d.fill { flex: 1 1 0; min-height: 60px; height: auto; }
</style>
