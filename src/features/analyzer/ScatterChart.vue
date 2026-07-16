<script setup lang="ts">
import { computed, defineAsyncComponent, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnalyzerStore, type ScatterChartConfig } from '@/stores/analyzerStore'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import { buildGgPoints, buildGgPointsWithColor, looksLikeForce } from '@/domain/analysis/ggData'
import { lapColor } from './lapColors'
import SearchableSelect from '@/components/SearchableSelect.vue'
import type { GgSeries } from './GgChart.vue'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import {
  buildMultiSessionScatter,
  buildMultiSessionScatterLaps,
  resolveComparisonLapPicks,
} from '@/domain/analysis/multiSessionScatter'
import { useLapStore } from '@/stores/lapStore'

// A10+A12 — XY scatter chart TYPE: any two channels, managed exactly like
// timeseries charts (multiple instances, per-chart config, remove button).
// Force channels (aRacer TC_Xforce/TC_Yforce, milli-g) are just the default
// pick for the featured friction-circle use — see `looksLikeForce` below.
// Lazy: pulls in echarts (~480 kB raw) — async import keeps it in its own
// chunk, split from the main bundle (see AnalyzerView.vue's defineAsyncComponent
// comment for the sibling boundary this mirrors). A small delay + loading
// slot avoids a layout flash on fast connections while still showing
// feedback once the chunk fetch takes a moment (slow network / cold cache).
const GgChart = defineAsyncComponent({
  loader: () => import('./GgChart.vue'),
  loadingComponent: {
    setup() {
      const { t } = useI18n()
      return () => h('p', { class: 'hint' }, t('analyzer.gg.loading'))
    },
  },
  delay: 200,
})

// B25b — `echarts-gl` is only pulled in by this component's async boundary.
// Ordinary X/Y scatters therefore keep the existing, smaller ECharts chunk;
// selecting a Z channel switches to the genuine WebGL scatter3D renderer.
const Scatter3dChart = defineAsyncComponent({
  loader: () => import('./Scatter3dChart.vue'),
  loadingComponent: {
    setup() {
      const { t } = useI18n()
      return () => h('p', { class: 'hint' }, t('analyzer.gg.loading'))
    },
  },
  delay: 200,
})

const MILLI_G_SCALE = 0.001
const MAX_POINTS = 5000

const props = defineProps<{
  chart: ScatterChartConfig
  session: LogSession | null
  /** Selected laps in selection order (for per-lap coloring), or empty for
   *  whole-session single-color plotting. */
  selectedLaps: Lap[]
  comparisonSessions?: ComparisonSession[]
  primaryFileId?: number | null
  primaryFileName?: string
  /** #8 — forwarded to GgChart: fill the dashboard grid item's height instead
   *  of a fixed pixel height. See GgChart's `fillHeight` prop. */
  fillHeight?: boolean
}>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()
const lapStore = useLapStore()

const allChannels = computed(() => {
  const s = props.session
  if (!s) return []
  return s.channels
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name))
})

const xChannel = computed(() => props.chart.xChannel)
const yChannel = computed(() => props.chart.yChannel)

function setX(name: string | null): void {
  analyzer.setChartXY(props.chart.id, 'x', name)
}
function setY(name: string | null): void {
  analyzer.setChartXY(props.chart.id, 'y', name)
}

// XY-aspect feature — persisted per chart card alongside the X/Y picks
// (chartConfigs.ts / aracer-loga.analyzerCharts.v1); ON by default for both
// new and pre-feature persisted charts (parseCharts backfills true).
const equalAspect = computed(() => props.chart.equalAspect)
function setEqualAspect(on: boolean): void {
  analyzer.setChartEqualAspect(props.chart.id, on)
}

// B25b — an optional THIRD channel is the Z axis of a genuine WebGL XYZ
// scatter. Persisted alongside X/Y/equalAspect (same "one field, one setter"
// contract) — see analyzerStore's setChartColorChannel.
const colorChannel = computed(() => props.chart.colorChannel)
function setColorChannel(name: string | null): void {
  analyzer.setChartColorChannel(props.chart.id, name)
}

// B51 — 3D-only outlier-robust axis ranging escape hatch: false (default)
// clamps each of the 3D scatter's X/Y/Z axes to their 0.5-99.5 percentile
// band (see domain/analysis/scatter3d.ts's computeAxisRanges); true restores
// the full data-extent ranging. Persisted alongside the chart's other
// settings (same "one field, one setter" contract as setChartEqualAspect).
const includeOutliers = computed(() => props.chart.includeOutliers)
function setIncludeOutliers(on: boolean): void {
  analyzer.setChartIncludeOutliers(props.chart.id, on)
}

// Scale is only meaningful for aRacer's milli-g force channels; any other
// channel pair plots in its native units (raw scale = 1). `looksLikeForce`
// is shared with analyzerStore's addChart/chartConfigs' backfill — see
// ggData.ts's doc for why the equal-aspect default now uses the same rule.
const useMilliG = computed(() => looksLikeForce(xChannel.value) && looksLikeForce(yChannel.value))
const is3d = computed(() => colorChannel.value !== null)

const ggSeries = computed<GgSeries[]>(() => {
  const s = props.session
  const xName = xChannel.value
  const yName = yChannel.value
  if (!s || !xName || !yName) return []
  const xCh = s.get(xName)
  const yCh = s.get(yName)
  if (!xCh || !yCh) return []
  const scale = useMilliG.value ? MILLI_G_SCALE : 1
  const comparisons = props.comparisonSessions ?? []
  if (comparisons.length > 0) {
    const primaryId = props.primaryFileId ?? 0
    const sources = [
      {
        id: primaryId,
        name: props.primaryFileName ?? t('analyzer.gg.session'),
        color: categoricalColor(primaryId),
        session: s,
      },
      ...comparisons,
    ]

    // B57 — the primary's own selected laps (from the lap table, same source
    // TimeSeriesChart's overlay uses) PLUS any laps picked from a comparison
    // file's own per-lap table (`lapStore.selectedAcrossSessions` — see
    // TimeSeriesChart.vue's `crossLapSources` for the identical merge). When
    // this combined list is non-empty the scatter must follow the selection
    // instead of silently falling back to whole-session clouds for every
    // file — that fallback is the reported bug (圈次表選了圈之後散佈圖仍顯示
    // 整個 session 的所有點).
    const lapPicks = resolveComparisonLapPicks(
      primaryId,
      props.selectedLaps,
      lapStore.selectedAcrossSessions,
      comparisons,
      (index) => t('analyzer.gg.lapSeries', { n: index + 1 }) as string,
    )

    if (lapPicks.length > 0) {
      return buildMultiSessionScatterLaps(sources, lapPicks, xName, yName, MAX_POINTS, colorChannel.value)
    }
    return buildMultiSessionScatter(sources, xName, yName, MAX_POINTS, colorChannel.value)
  }

  // The selected Z channel is resolved once here (not per lap). A stale
  // persisted pick degrades to an empty 3D chart rather than inventing data.
  const colorCh = colorChannel.value ? s.get(colorChannel.value) : null

  if (props.selectedLaps.length === 0) {
    if (colorCh) {
      const { points, colorValues } = buildGgPointsWithColor(xCh.data, yCh.data, colorCh.data, {
        scale,
        maxPoints: MAX_POINTS,
      })
      return [{ points, colorValues, color: categoricalColor(props.primaryFileId ?? 0), name: t('analyzer.gg.session') }]
    }
    const points = buildGgPoints(xCh.data, yCh.data, { scale, maxPoints: MAX_POINTS })
    return [{ points, color: '#4363d8', name: t('analyzer.gg.session') }]
  }

  return props.selectedLaps.map((lap, order) => {
    const name = t('analyzer.gg.lapSeries', { n: lap.index + 1 })
    // In XYZ mode hue identifies the FILE, not the selected lap. The 2D path
    // deliberately retains its established per-lap colours.
    const color = colorCh ? categoricalColor(props.primaryFileId ?? 0) : lapColor(order)
    if (colorCh) {
      const { points, colorValues } = buildGgPointsWithColor(xCh.data, yCh.data, colorCh.data, {
        scale,
        start: lap.startIdx,
        end: lap.endIdx,
        maxPoints: MAX_POINTS,
      })
      return { points, colorValues, color, name }
    }
    return {
      points: buildGgPoints(xCh.data, yCh.data, {
        scale,
        start: lap.startIdx,
        end: lap.endIdx,
        maxPoints: MAX_POINTS,
      }),
      color,
      name,
    }
  })
})

// Adaptive axis rule (documented on GgChart.vue too): symmetric-about-0
// square axes only make sense when BOTH channels look like signed force data
// (min<0<max on each axis) — otherwise (e.g. RPM vs speed) a normal
// auto-ranged axis is used. Computed here from the actual data rather than
// the channel NAME so it works for any signed bipolar channel, not just
// TC_*force.
const axisMode = computed<'square' | 'auto'>(() => {
  const series = ggSeries.value
  if (series.length === 0) return 'auto'
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const s of series) {
    for (const [x, y] of s.points) {
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
  }
  const xSigned = xMin < 0 && xMax > 0
  const ySigned = yMin < 0 && yMax > 0
  return xSigned && ySigned ? 'square' : 'auto'
})

// B50 — the 1:1/自動 buttons are shared between the 2D and 3D chart, but what
// "1:1" scales (X/Y pixels vs X/Y/Z grid3D box proportions — see
// Scatter3dChart.vue's equalAspectBoxSize) differs enough to warrant a
// distinct hint per mode, so the tooltip never implies a 2D-only meaning
// while a Z channel is active.
const aspectEqualHint = computed(() =>
  is3d.value ? t('analyzer.gg.aspectEqualHint3d') : t('analyzer.gg.aspectEqualHint'),
)
const aspectAutoHint = computed(() =>
  is3d.value ? t('analyzer.gg.aspectAutoHint3d') : t('analyzer.gg.aspectAutoHint'),
)
</script>

<template>
  <section class="scatter-chart" :class="{ fill: fillHeight }">
    <div class="toolbar">
      <div class="picker">
        <span class="picker-label">{{ t('analyzer.gg.xAxis') }}</span>
        <SearchableSelect :model-value="xChannel" :options="allChannels" @update:model-value="setX" />
      </div>
      <div class="picker">
        <span class="picker-label">{{ t('analyzer.gg.yAxis') }}</span>
        <SearchableSelect :model-value="yChannel" :options="allChannels" @update:model-value="setY" />
      </div>
      <div class="picker">
        <span class="picker-label">{{ t('analyzer.gg.zAxis') }}</span>
        <SearchableSelect
          :model-value="colorChannel"
          :options="allChannels"
          @update:model-value="setColorChannel"
        />
      </div>
      <div class="aspect" role="group" :aria-label="t('analyzer.gg.aspectLabel')">
        <button
          type="button"
          :class="{ active: equalAspect }"
          v-tooltip="aspectEqualHint"
          @click="setEqualAspect(true)"
        >
          {{ t('analyzer.gg.aspectEqual') }}
        </button>
        <button
          type="button"
          :class="{ active: !equalAspect }"
          v-tooltip="aspectAutoHint"
          @click="setEqualAspect(false)"
        >
          {{ t('analyzer.gg.aspectAuto') }}
        </button>
      </div>
      <label v-if="is3d" class="toggle outliers" v-tooltip="t('analyzer.gg.includeOutliersHint')">
        <input
          type="checkbox"
          :checked="includeOutliers"
          @change="setIncludeOutliers(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t('analyzer.gg.includeOutliers') }}</span>
      </label>
      <button type="button" class="remove" @click="analyzer.removeChart(chart.id)">
        {{ t('analyzer.removeChart') }}
      </button>
    </div>

    <p v-if="!xChannel || !yChannel" class="hint">{{ t('analyzer.gg.pickBoth') }}</p>
    <Scatter3dChart
      v-if="is3d"
      class="chart-fill"
      :series="ggSeries"
      :x-name="xChannel"
      :y-name="yChannel"
      :z-name="colorChannel"
      :fill-height="fillHeight"
      :equal-aspect="equalAspect"
      :include-outliers="includeOutliers"
    />
    <GgChart
      v-else
      class="chart-fill"
      :series="ggSeries"
      :axis-mode="axisMode"
      :x-name="xChannel"
      :y-name="yChannel"
      :fill-height="fillHeight"
      :equal-aspect="equalAspect"
    />
  </section>
</template>

<style scoped>
.scatter-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* #16: this is itself a flex item (of AnalyzerView's `.card`/`.analyzer`
   * column layout upstream); a flex item's cross-axis min-width defaults to
   * `auto`, i.e. its content's min-content size, not 0. GgChart's host below
   * renders a canvas at an explicit pixel width (echarts sizes it from
   * clientWidth at creation), which otherwise floors this container's
   * shrink and makes the chart overflow instead of shrinking when the
   * window/panel narrows. */
  min-width: 0;
}
/* #8/T1 — inside a dashboard grid item's card body (a flex COLUMN — see
   DashboardCard's `.body`): grow into the remaining space as a flex item
   (`flex: 1`, not the old `height: 100%`, which overflowed the body once any
   sibling text existed) and let GgChart's own .fill (via fillHeight) claim
   the remaining space below the toolbar/hint. */
.scatter-chart.fill {
  flex: 1 1 auto;
  min-height: 0;
}
.scatter-chart.fill .chart-fill {
  /* Basis 0, not auto — see TimeSeriesChart's .chart-fill for why (the
     echarts canvas's height derives from this host's measured height, so a
     content-based basis would be circular). */
  flex: 1 1 0;
  /* Same floor as TimeSeriesChart's .chart-fill — keeps the plot usable at
     tiny card sizes; beyond it the card body scrolls. */
  min-height: 60px;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}
.picker {
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  flex: 1 1 220px;
  min-width: 180px;
}
.picker-label {
  font-size: 0.85rem;
}
/* Same segmented-toggle look as TimeSeriesChart's timeline/overlay `.mode`
   buttons — two mutually exclusive presentation modes for one chart. */
.aspect {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
  align-self: flex-end;
}
.aspect button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.aspect button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
/* B51 — the 3D-only "include outliers" escape hatch, styled like
   TrackChannelPanel's `.toggle` checkbox+label pattern. */
.toggle.outliers {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  cursor: pointer;
  align-self: flex-end;
  padding-bottom: 6px;
}
/* B35 — §8 layer 3: any coarse pointer present grows the checkbox itself to
   a >=44px touch target, same pattern as CurrentValuesPanel's `.hide-toggle
   input` — see that file's identical rule for the full doc. */
:root[data-any-pointer-coarse] .toggle.outliers input {
  width: 44px;
  height: 44px;
}
.remove {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 10px;
  font: inherit;
  cursor: pointer;
  align-self: flex-end;
}
.remove:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
/* B35 — §8 layer 3: capability signal (useInputCapabilities.ts, mirrored onto
   <html data-any-pointer-coarse>), not a viewport-width guess — grows the
   remove-chart button ("close" this card's content) to a >=44px touch
   target on any coarse-pointer device. */
:root[data-any-pointer-coarse] .remove {
  min-height: 44px;
  padding: 12px 16px;
}
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
</style>
