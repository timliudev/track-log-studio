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
import { buildMultiSessionScatter } from '@/domain/analysis/multiSessionScatter'

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

// Colour-axis feature — an optional THIRD channel mapped to point colour via
// a continuous colormap (a 3D-plot alternative — see GgChart.vue's
// visualMap). Persisted alongside X/Y/equalAspect (same "one field, one
// setter" contract) — see analyzerStore's setChartColorChannel.
const colorChannel = computed(() => props.chart.colorChannel)
function setColorChannel(name: string | null): void {
  analyzer.setChartColorChannel(props.chart.id, name)
}

// Scale is only meaningful for aRacer's milli-g force channels; any other
// channel pair plots in its native units (raw scale = 1). `looksLikeForce`
// is shared with analyzerStore's addChart/chartConfigs' backfill — see
// ggData.ts's doc for why the equal-aspect default now uses the same rule.
const useMilliG = computed(() => looksLikeForce(xChannel.value) && looksLikeForce(yChannel.value))

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
  // Session identity owns hue while multi-session comparison is active. A
  // continuous colour-axis would erase that encoding, so it remains available
  // only in the existing single-session path.
  if (comparisons.length > 0) {
    return buildMultiSessionScatter([
      {
        id: props.primaryFileId ?? 0,
        name: props.primaryFileName ?? t('analyzer.gg.session'),
        color: categoricalColor(props.primaryFileId ?? 0),
        session: s,
      },
      ...comparisons,
    ], xName, yName, MAX_POINTS, colorChannel.value)
  }

  // Colour-axis feature — resolved once here (not per-lap below) so a stale
  // colorChannel pick from a previously loaded session (channel no longer
  // exists) degrades to "no colour axis" for every series, same as
  // x/yChannel's existing "renders empty until valid" degrade.
  const colorCh = colorChannel.value ? s.get(colorChannel.value) : null

  if (props.selectedLaps.length === 0) {
    if (colorCh) {
      const { points, colorValues } = buildGgPointsWithColor(xCh.data, yCh.data, colorCh.data, {
        scale,
        maxPoints: MAX_POINTS,
      })
      return [{ points, colorValues, color: '#4363d8', name: t('analyzer.gg.session') }]
    }
    const points = buildGgPoints(xCh.data, yCh.data, { scale, maxPoints: MAX_POINTS })
    return [{ points, color: '#4363d8', name: t('analyzer.gg.session') }]
  }

  return props.selectedLaps.map((lap, order) => {
    const name = t('analyzer.gg.lapSeries', { n: lap.index + 1 })
    const color = lapColor(order)
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
        <span class="picker-label">{{ t('analyzer.gg.colorAxis') }}</span>
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
          v-tooltip="t('analyzer.gg.aspectEqualHint')"
          @click="setEqualAspect(true)"
        >
          {{ t('analyzer.gg.aspectEqual') }}
        </button>
        <button
          type="button"
          :class="{ active: !equalAspect }"
          v-tooltip="t('analyzer.gg.aspectAutoHint')"
          @click="setEqualAspect(false)"
        >
          {{ t('analyzer.gg.aspectAuto') }}
        </button>
      </div>
      <button type="button" class="remove" @click="analyzer.removeChart(chart.id)">
        {{ t('analyzer.removeChart') }}
      </button>
    </div>

    <p v-if="!xChannel || !yChannel" class="hint">{{ t('analyzer.gg.pickBoth') }}</p>
    <GgChart
      v-else
      class="chart-fill"
      :series="ggSeries"
      :axis-mode="axisMode"
      :x-name="xChannel"
      :y-name="yChannel"
      :fill-height="fillHeight"
      :equal-aspect="equalAspect"
      :color-channel="colorChannel"
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
.hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
</style>
