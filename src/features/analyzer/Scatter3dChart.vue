<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import 'echarts-gl'
import { computeAxisRanges, equalAspectBoxSize, xyzPoints } from '@/domain/analysis/scatter3d'
import { sizeChangedEnoughToApply } from '@/domain/analysis/chartResize'
import type { GgSeries } from './GgChart.vue'

echarts.use([TooltipComponent, CanvasRenderer])

// B50 — the fixed "auto" box shape used before the 1:1 feature existed:
// each axis independently stretches to fill its own dedicated box dimension
// regardless of its actual data span (the opposite of `equalAspectBoxSize`'s
// data-proportional sizing) — kept as the literal default for `equalAspect
// === false` so unchecked charts render exactly as before this feature.
const AUTO_BOX = { boxWidth: 120, boxHeight: 100, boxDepth: 100 }

const props = defineProps<{
  series: GgSeries[]
  xName: string | null
  yName: string | null
  zName: string | null
  fillHeight?: boolean
  /** B50 — mirrors GgChart's 2D `equalAspect`: true sizes the grid3D box
   *  proportional to each axis's actual data span (see
   *  `equalAspectBoxSize`), so equal data units map to equal visual length
   *  on X/Y/Z; false (default) keeps the historic fixed box shape, each axis
   *  auto-stretched independently to fill it. */
  equalAspect?: boolean
  /** B51 — mirrors the "include outliers" escape hatch: true renders the
   *  full min/max data extent on every axis (the historic, pre-B51
   *  behaviour); false (default) clamps each axis to its 0.5–99.5
   *  percentile band so a few extreme outlier/noise samples don't squash the
   *  rest of the point cloud — see `computeAxisRanges`. */
  includeOutliers?: boolean
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null
// ResizeObserver feedback-loop guard (see `sizeChangedEnoughToApply`'s doc,
// shared with GgChart.vue/B107) — the size actually last passed to
// `chart.resize()`, compared against each new measurement so a sub-pixel
// echo doesn't re-trigger work forever.
let lastAppliedSize: { width: number; height: number } | null = null
// Coalesces bursts of ResizeObserver callbacks (an observer can fire more
// than once per frame) into a single measurement+resize per animation frame
// — same rAF-coalescing shape as GgChart's `scheduleResize` (B107)/TrackMap's
// `scheduleDraw` (B30).
let resizeRafId: number | null = null

function hostSize(): { width: number; height: number } {
  return {
    width: host.value?.clientWidth || 400,
    height: props.fillHeight && (host.value?.clientHeight ?? 0) > 0 ? host.value!.clientHeight : 360,
  }
}

function buildOption(): echarts.EChartsCoreOption {
  // B51 — outlier-robust (default) or full-extent axis ranges, computed once
  // from every series' raw points/zValues so the grid3D axes AND (when 1:1
  // is on) the box proportions below derive from the SAME data.
  const seriesInputs = props.series.map((s) => ({ points: s.points, zValues: s.colorValues }))
  const ranges = computeAxisRanges(seriesInputs, props.includeOutliers ?? false)
  // B50 — 1:1 sizes the box proportional to each axis's actual span;
  // otherwise keep the historic fixed "auto" box (each axis independently
  // fills its own dimension).
  const box = props.equalAspect ? equalAspectBoxSize(ranges) : AUTO_BOX

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
      ...box,
      viewControl: {
        projection: 'perspective',
        alpha: 22,
        beta: 35,
        rotateSensitivity: 1,
        zoomSensitivity: 1,
        panSensitivity: 1,
      },
    },
    xAxis3D: { type: 'value', name: props.xName ?? '', min: ranges.x.min, max: ranges.x.max },
    yAxis3D: { type: 'value', name: props.yName ?? '', min: ranges.y.min, max: ranges.y.max },
    zAxis3D: { type: 'value', name: props.zName ?? '', min: ranges.z.min, max: ranges.z.max },
    series: props.series.map((series) => ({
      name: series.name,
      type: 'scatter3D',
      // Points outside the (possibly percentile-clamped) axis ranges above
      // are NOT filtered out here — they're left in the series data and
      // simply clip out of view at the grid3D box edge (echarts-gl's own
      // clipping), so tooltips/legend/other consumers of `series` never see
      // a silently-truncated point set — only this chart's camera framing
      // changes. See scatter3d.ts's `computeAxisRanges` doc.
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
  const size = hostSize()
  chart = echarts.init(host.value, undefined, size)
  // The size just passed to `echarts.init` IS the applied size — seed the
  // guard with it so the FIRST ResizeObserver callback (which fires right
  // after mount, reporting this same size) is correctly treated as a no-op
  // rather than an unnecessary extra resize+render — see GgChart's `create()`
  // (B107) for the identical reasoning.
  lastAppliedSize = size
  render()
}

function resize(): void {
  if (!chart) return
  const size = hostSize()
  // Feedback-loop guard — see `sizeChangedEnoughToApply`'s doc. Skipping
  // sub-pixel "changes" breaks the loop while still catching every genuine
  // (>=1px) resize.
  if (!sizeChangedEnoughToApply(lastAppliedSize, size)) return
  chart.resize(size)
  lastAppliedSize = size
}

/** Coalesces a burst of ResizeObserver callbacks into one `resize()` per
 *  animation frame, always acting on the LATEST measurement — see GgChart's
 *  `scheduleResize` (B107)/TrackMap's `scheduleDraw` (B30) for the same
 *  pattern. */
function scheduleResize(): void {
  if (resizeRafId !== null) return
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null
    resize()
  })
}

onMounted(() => {
  create()
  ro = new ResizeObserver(() => scheduleResize())
  if (host.value) ro.observe(host.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  if (resizeRafId !== null) {
    cancelAnimationFrame(resizeRafId)
    resizeRafId = null
  }
  chart?.dispose()
  chart = null
})

watch(
  () => [props.series, props.xName, props.yName, props.zName, props.equalAspect, props.includeOutliers],
  render,
  { deep: false },
)
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
