<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type uPlot from 'uplot'
import {
  useAnalyzerStore,
  type TimeSeriesChartConfig,
  type GearRatioChartConfig,
  type ChartMode,
} from '@/stores/analyzerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLapStore } from '@/stores/lapStore'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import { buildLapOverlay } from '@/domain/analysis/lapOverlay'
import { formatElapsed, formatDistance, formatClock } from '@/domain/analysis/axisFormat'
import { sessionStartAnchor } from '@/domain/analysis/startTime'
import { lapColor } from './lapColors'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import { buildTimelineData, nearestXIndex, type TimelineSource } from '@/domain/analysis/timelineData'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import UPlotChart from '@/components/UPlotChart.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'

const props = defineProps<{
  chart: TimeSeriesChartConfig | GearRatioChartConfig
  session: LogSession
  xValues: Float64Array
  xRange?: { min: number; max: number } | null
  externalCursor?: number | null
  comparisonSessions?: ComparisonSession[]
  primaryFileId?: number | null
  primaryFileName?: string
  /** Selected laps (in colour order) for overlay mode. */
  selectedLaps?: Lap[]
  /** Fixed derived series (e.g. drivetrain ratio). When supplied, the chart
   *  uses the same plot/overlay/cursor pipeline but hides the channel picker. */
  fixedSeries?: readonly { name: string; data: ArrayLike<number> }[]
  /** Empty-state copy for a fixed derived chart whose prerequisites failed. */
  emptyMessage?: string
  /** #8 — forwarded to UPlotChart: fill the dashboard grid item's height
   *  instead of a fixed pixel height. See UPlotChart's `fillHeight` prop. */
  fillHeight?: boolean
}>()
const emit = defineEmits<{
  cursor: [number | null]
  xZoom: [{ min: number; max: number }]
}>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()
const { xAxis } = storeToRefs(analyzer)
const lapStore = useLapStore()
const settings = useSettingsStore()
const { tzOverride } = storeToRefs(settings)

const PALETTE = ['#e23b3b', '#3b82e2', '#2ea043', '#e2a33b', '#9b3be2', '#3bd6e2']
const color = (i: number): string => PALETTE[i % PALETTE.length]
// Line-dash patterns for overlay mode: style encodes the channel ([] = solid).
const DASHES: number[][] = [[], [6, 4], [2, 3], [8, 3, 2, 3], [12, 4]]
const dash = (i: number): number[] => DASHES[i % DASHES.length]

const mode = computed<ChartMode>(() => props.chart.mode)
const xUnit = computed(() => (xAxis.value === 'distance' ? 'm' : 's'))
const laps = computed<Lap[]>(() => props.selectedLaps ?? [])
const comparisonActive = computed(() => (props.comparisonSessions?.length ?? 0) > 0)

const allChannels = computed(() =>
  props.session.channels
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const pickerOptions = computed(() =>
  allChannels.value.filter(
    (c) => props.chart.kind === 'timeseries' && !props.chart.channels.includes(c.name),
  ),
)
const presentSources = computed<Array<{ name: string; data: ArrayLike<number> }>>(() => {
  if (props.fixedSeries) return [...props.fixedSeries]
  if (props.chart.kind !== 'timeseries') return []
  const sources: Array<{ name: string; data: ArrayLike<number> }> = []
  for (const name of props.chart.channels) {
    const data = props.session.get(name)?.data
    if (data) sources.push({ name, data })
  }
  return sources
})
const present = computed(() => presentSources.value.map((source) => source.name))

// --- Timeline mode: each channel over the full session on a shared X. ---
const plotWidth = ref(1200)
const pointBudget = computed(() => Math.max(300, Math.ceil(plotWidth.value * 2)))
const timelineSources = computed<TimelineSource[]>(() => {
  const primaryId = props.primaryFileId ?? -1
  const primaryChannels = props.fixedSeries
    ? new Map(props.fixedSeries.map((series) => [series.name, series.data]))
    : new Map(props.session.channels.map((channel) => [channel.name, channel.data]))
  const sources: TimelineSource[] = [{
    id: primaryId,
    label: props.primaryFileName ?? 'Primary',
    color: categoricalColor(primaryId),
    primary: true,
    xValues: props.xValues,
    channels: primaryChannels,
  }]
  for (const comparison of props.comparisonSessions ?? []) {
    sources.push({
      id: comparison.id,
      label: comparison.name,
      color: comparison.color,
      primary: false,
      xValues: comparison.xValues,
      channels: new Map(comparison.session.channels.map((channel) => [channel.name, channel.data])),
    })
  }
  return sources
})
const timeline = computed(() => buildTimelineData(
  timelineSources.value,
  present.value,
  props.xRange ?? null,
  pointBudget.value,
))
const timelineData = computed<uPlot.AlignedData>(
  () => timeline.value.data as unknown as uPlot.AlignedData,
)

// Each series gets its own scale key (= channel name) → independent auto-ranging,
// so a small-range channel isn't flattened by a large-range one.
const timelineSeries = computed<uPlot.Series[]>(() => [
  { label: xUnit.value },
  ...timeline.value.series.map((entry) => ({
    label: `${entry.sourceLabel} · ${entry.channel}`,
    stroke: entry.color,
    dash: dash(entry.channelIndex),
    width: entry.primary ? 1.5 : 1,
    scale: entry.channel,
    spanGaps: true,
  })),
])

// --- Overlay mode: selected laps re-based to a lap-relative X (from 0). ---
// Colour encodes the lap, line style encodes the channel; same-channel laps
// share a scale (= channel name) so they're directly comparable.
const overlay = computed(() =>
  buildLapOverlay({
    xValues: props.xValues,
    channels: presentSources.value,
    laps: laps.value,
    // Per-lap alignment nudges, resolved to the current axis' units (#9).
    offsets: laps.value.map((l) => lapStore.offsetOf(l.index, xAxis.value)),
  }),
)
// uPlot seeds a scale's range from a series' first in-range sample and treats
// only `null` (not NaN) as a gap. Once a lap is nudged off grid-0 its trace
// starts with a NaN, which would poison the shared channel scale to
// [null, null] and hide EVERY line (the data is still there — the cursor
// readout works — but nothing draws). Convert gaps to null so uPlot skips them
// in both range and path. (Only the y series carry gaps; the x grid is finite.)
const overlayData = computed<uPlot.AlignedData>(
  () =>
    [
      overlay.value.x,
      ...overlay.value.series.map((s) => Array.from(s.y, (v) => (Number.isFinite(v) ? v : null))),
    ] as unknown as uPlot.AlignedData,
)
const overlaySeries = computed<uPlot.Series[]>(() => [
  { label: xUnit.value },
  ...overlay.value.series.map((s) => ({
    label: `#${s.lap.index + 1} · ${present.value[s.channelIndex]}`,
    stroke: lapColor(s.lapOrder),
    dash: dash(s.channelIndex),
    width: 1,
    scale: present.value[s.channelIndex],
  })),
])

const data = computed<uPlot.AlignedData>(() =>
  mode.value === 'overlay' ? overlayData.value : timelineData.value,
)
const series = computed<uPlot.Series[]>(() =>
  mode.value === 'overlay' ? overlaySeries.value : timelineSeries.value,
)

// Absolute start instant (elapsed=0) of this session, for the clock-time axis.
const anchor = computed(() => sessionStartAnchor(props.session))

// Effective timezone offset (minutes east of UTC) for clock labels. 'auto' uses
// the browser zone for GPS-derived anchors, but 0 for created-date anchors (whose
// wall-clock components were reinterpreted as UTC). Reading the browser offset here
// is display-only — it never becomes stored state.
const effectiveOffset = computed<number>(() => {
  if (tzOverride.value !== 'auto') return tzOverride.value
  if (anchor.value?.source === 'gpsUtc') return -new Date().getTimezoneOffset()
  return 0
})

// Label for the clock axis, e.g. 'UTC+8', 'UTC-3:30', 'UTC'.
const clockAxisLabel = computed<string>(() => {
  const off = effectiveOffset.value
  if (off === 0) return 'UTC'
  const sign = off > 0 ? '+' : '-'
  const abs = Math.abs(off)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  return `UTC${sign}${hours}${mins ? ':' + mins.toString().padStart(2, '0') : ''}`
})

// x axis + up to two value axes; in timeline mode they're coloured per series,
// in overlay mode colour means "lap" so the channel axes stay theme-neutral.
// In timeline + time mode an extra bottom x-axis shows absolute clock time.
const axes = computed<uPlot.Axis[]>(() => {
  const xValuesFmt = (_u: uPlot, splits: number[]): string[] =>
    splits.map((v) => (xAxis.value === 'distance' ? formatDistance(v) : formatElapsed(v)))
  const showClock = mode.value === 'timeline' && xAxis.value === 'time' && anchor.value != null
  // Clock labels (HH:mm:ss) are ~2.5× wider than the elapsed labels. Widen the
  // tick spacing on BOTH x-axes so they pick the same coarser splits — the two
  // time rows then line up and the clock labels stop colliding.
  //
  // IMPORTANT: only set `space` when we actually want to override uPlot's
  // default (showClock). uPlot merges axis options with `Object.assign`-style
  // `for...in`, which copies an explicitly-present `space: undefined` key too
  // (unlike an absent key) — that clobbers uPlot's numeric default (50) with
  // `undefined`, which after its `fnOrSelf` wrap becomes a function that always
  // returns `undefined`. Every `foundSpace >= minSpace` tick-increment check
  // then compares against `undefined` (always false), so uPlot never finds a
  // fitting increment and gives up on this axis' ticks entirely — rendering it
  // with no splits/labels (the axis line may still show, but blank). This is
  // exactly the reported "X axis disappears in overlay mode" bug: overlay mode
  // always has showClock = false, so the un-conditional `space: xSpace` always
  // shipped this poisoned `undefined`. Timeline+distance mode hit the same bug
  // for the same reason, just less noticed. Spreading the key in only when it
  // has a real value avoids ever handing uPlot an explicit `undefined`.
  const xSpace = showClock ? 80 : undefined
  const spaceOverride = xSpace != null ? { space: xSpace } : {}
  const xAxes: uPlot.Axis[] = [{ scale: 'x', ...spaceOverride, values: xValuesFmt }]
  if (showClock) {
    const startMs = anchor.value!.startUtcMs
    const offset = effectiveOffset.value
    xAxes.push({
      scale: 'x',
      side: 2,
      ...spaceOverride,
      // The primary x-axis already draws the gridlines; suppress this one's so the
      // chart isn't double-gridded.
      grid: { show: false },
      label: clockAxisLabel.value,
      values: (_u: uPlot, splits: number[]): string[] =>
        splits.map((v) => formatClock(startMs + v * 1000, offset)),
    })
  }
  return [
    ...xAxes,
    ...present.value.slice(0, 2).map((n, i) => ({
      scale: n,
      side: i === 0 ? 3 : 1,
      ...(mode.value === 'overlay' || comparisonActive.value ? { label: n } : { stroke: color(i) }),
    })),
  ]
})

// Overlay's X is a lap-relative grid index space, unrelated to the session-wide
// cursor/zoom. Overlay charts share a SEPARATE cursor (overlayCursorIdx) — all
// overlay charts build the same grid so the index aligns across them — while
// timeline charts (and the track map) stay on the session-index cursor/zoom.
const canRender = computed(() =>
  mode.value === 'overlay' ? present.value.length > 0 && laps.value.length > 0 : present.value.length > 0,
)
const effectiveCursor = computed<number | null>(() =>
  mode.value === 'overlay'
    ? analyzer.overlayCursorIdx
    : props.externalCursor == null
      ? null
      : nearestXIndex(timeline.value.data[0], props.xValues[props.externalCursor]),
)
function onCursor(idx: number | null): void {
  if (mode.value === 'overlay') analyzer.setOverlayCursor(idx)
  else if (idx == null) emit('cursor', null)
  else emit('cursor', nearestXIndex(props.xValues, timeline.value.data[0][idx]))
}
function onXZoom(r: { min: number; max: number }): void {
  if (mode.value === 'timeline') emit('xZoom', r)
}

function setMode(m: ChartMode): void {
  analyzer.setChartMode(props.chart.id, m)
}

function addChannel(name: string | null): void {
  if (props.chart.kind === 'timeseries' && name && !props.chart.channels.includes(name)) {
    analyzer.setChartChannels(props.chart.id, [...props.chart.channels, name])
  }
}
function removeChannel(name: string): void {
  if (props.chart.kind !== 'timeseries') return
  analyzer.setChartChannels(
    props.chart.id,
    props.chart.channels.filter((n) => n !== name),
  )
}
</script>

<template>
  <section class="chart" :class="{ fill: fillHeight }">
    <div class="toolbar">
      <div v-if="chart.kind === 'timeseries'" class="picker">
        <SearchableSelect :model-value="null" :options="pickerOptions" @update:model-value="addChannel" />
      </div>
      <div class="mode">
        <button type="button" :class="{ active: mode === 'timeline' }" @click="setMode('timeline')">
          {{ t('analyzer.modeTimeline') }}
        </button>
        <button type="button" :class="{ active: mode === 'overlay' }" @click="setMode('overlay')">
          {{ t('analyzer.modeOverlay') }}
        </button>
      </div>
      <button type="button" class="remove" @click="analyzer.removeChart(chart.id)">
        {{ t('analyzer.removeChart') }}
      </button>
    </div>

    <div class="chips">
      <span v-for="(name, i) in present" :key="name" class="chip">
        <span
          class="dot"
          :class="{ line: mode === 'overlay' || comparisonActive }"
          :style="mode === 'overlay' || comparisonActive ? {} : { background: color(i) }"
        />
        {{ name }}
        <button v-if="chart.kind === 'timeseries'" type="button" class="x" @click="removeChannel(name)">×</button>
      </span>
      <span v-if="present.length === 0" class="muted">{{ emptyMessage ?? t('analyzer.pickChannel') }}</span>
    </div>

    <UPlotChart
      v-if="canRender"
      class="chart-fill"
      :data="data"
      :series="series"
      :axes="axes"
      :x-range="mode === 'timeline' ? xRange : null"
      :external-cursor="effectiveCursor"
      :fill-height="fillHeight"
      :x-bounds="xValues.length > 1 ? { min: xValues[0], max: xValues[xValues.length - 1] } : null"
      @cursor="onCursor"
      @x-zoom="onXZoom"
      @plot-width="plotWidth = $event"
    />
    <p v-else-if="mode === 'overlay' && present.length > 0" class="muted overlay-hint">
      {{ t('analyzer.overlayHint') }}
    </p>
  </section>
</template>

<style scoped>
.chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* #8/T1 — inside a dashboard grid item's card body (a flex COLUMN — see
   DashboardCard's `.body`): grow into the remaining space as a flex item
   (`flex: 1`, not the old `height: 100%`, which overflowed the body once any
   sibling text existed) and let UPlotChart's own .fill (via fillHeight)
   claim the remaining space below the toolbar/chips. */
.chart.fill {
  flex: 1 1 auto;
  min-height: 0;
}
.chart.fill .chart-fill {
  /* Basis 0 (not auto): the host's content is a canvas whose height is set
     FROM the host's measured height (UPlotChart's targetHeight), so a
     content-based flex basis would feed the canvas's current size back into
     its own layout. Basis 0 + grow 1 sizes the host purely from the space
     left over after the toolbar/chips rows. */
  flex: 1 1 0;
  /* Keep enough room that the plot area never collapses to nothing — the
     uPlot legend inside is subtracted from this by targetHeight(), see
     UPlotChart.vue. Past this minimum the card body scrolls instead. */
  min-height: 60px;
}
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.picker {
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.mode {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.mode button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.mode button.active {
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
}
.remove:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 0.82rem;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
/* In overlay mode colour means "lap", so the chip shows the channel's line
   STYLE (a neutral dash sample) instead of a colour. */
.dot.line {
  width: 16px;
  height: 0;
  border-radius: 0;
  border-top: 2px dashed var(--color-text-muted);
}
.chip .x {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
.muted {
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.overlay-hint {
  margin: 8px 0 0;
}
</style>
