<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type uPlot from 'uplot'
import { useAnalyzerStore, type ChartConfig, type ChartMode } from '@/stores/analyzerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLapStore } from '@/stores/lapStore'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import { buildLapOverlay } from '@/domain/analysis/lapOverlay'
import { formatElapsed, formatDistance, formatClock } from '@/domain/analysis/axisFormat'
import { sessionStartAnchor } from '@/domain/analysis/startTime'
import { lapColor } from './lapColors'
import UPlotChart from '@/components/UPlotChart.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'

const props = defineProps<{
  chart: ChartConfig
  session: LogSession
  xValues: Float64Array
  xRange?: { min: number; max: number } | null
  externalCursor?: number | null
  /** Selected laps (in colour order) for overlay mode. */
  selectedLaps?: Lap[]
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

const allChannels = computed(() =>
  props.session.channels
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const pickerOptions = computed(() =>
  allChannels.value.filter((c) => !props.chart.channels.includes(c.name)),
)
const present = computed(() => props.chart.channels.filter((n) => props.session.get(n)))

// --- Timeline mode: each channel over the full session on a shared X. ---
const timelineData = computed<uPlot.AlignedData>(
  () =>
    [props.xValues, ...present.value.map((n) => props.session.get(n)!.data)] as unknown as uPlot.AlignedData,
)

// Each series gets its own scale key (= channel name) → independent auto-ranging,
// so a small-range channel isn't flattened by a large-range one.
const timelineSeries = computed<uPlot.Series[]>(() => [
  { label: xUnit.value },
  ...present.value.map((n, i) => ({ label: n, stroke: color(i), width: 1, scale: n })),
])

// --- Overlay mode: selected laps re-based to a lap-relative X (from 0). ---
// Colour encodes the lap, line style encodes the channel; same-channel laps
// share a scale (= channel name) so they're directly comparable.
const overlay = computed(() =>
  buildLapOverlay({
    xValues: props.xValues,
    channels: present.value.map((n) => ({ name: n, data: props.session.get(n)!.data })),
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
  const xSpace = showClock ? 80 : undefined
  const xAxes: uPlot.Axis[] = [{ scale: 'x', space: xSpace, values: xValuesFmt }]
  if (showClock) {
    const startMs = anchor.value!.startUtcMs
    const offset = effectiveOffset.value
    xAxes.push({
      scale: 'x',
      side: 2,
      space: xSpace,
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
      ...(mode.value === 'overlay' ? { label: n } : { stroke: color(i) }),
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
  mode.value === 'overlay' ? analyzer.overlayCursorIdx : (props.externalCursor ?? null),
)
function onCursor(idx: number | null): void {
  if (mode.value === 'overlay') analyzer.setOverlayCursor(idx)
  else emit('cursor', idx)
}
function onXZoom(r: { min: number; max: number }): void {
  if (mode.value === 'timeline') emit('xZoom', r)
}

function setMode(m: ChartMode): void {
  analyzer.setChartMode(props.chart.id, m)
}

function addChannel(name: string | null): void {
  if (name && !props.chart.channels.includes(name)) {
    analyzer.setChartChannels(props.chart.id, [...props.chart.channels, name])
  }
}
function removeChannel(name: string): void {
  analyzer.setChartChannels(
    props.chart.id,
    props.chart.channels.filter((n) => n !== name),
  )
}
</script>

<template>
  <section class="chart">
    <div class="toolbar">
      <div class="picker">
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
          :class="{ line: mode === 'overlay' }"
          :style="mode === 'overlay' ? {} : { background: color(i) }"
        />
        {{ name }}
        <button type="button" class="x" @click="removeChannel(name)">×</button>
      </span>
      <span v-if="present.length === 0" class="muted">{{ t('analyzer.pickChannel') }}</span>
    </div>

    <UPlotChart
      v-if="canRender"
      :data="data"
      :series="series"
      :axes="axes"
      :x-range="mode === 'timeline' ? xRange : null"
      :external-cursor="effectiveCursor"
      @cursor="onCursor"
      @x-zoom="onXZoom"
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
