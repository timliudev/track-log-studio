<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type uPlot from 'uplot'
import { useAnalyzerStore, type TimeSeriesChartConfig } from '@/stores/analyzerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useLapStore } from '@/stores/lapStore'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import { buildLapOverlay } from '@/domain/analysis/lapOverlay'
import { buildCrossSessionLapOverlay, type CrossSessionLapSource } from '@/domain/analysis/crossSessionLapOverlay'
import { sampleIndexAtGridX, gridIndexAtSampleIndex, lapContaining } from '@/domain/analysis/overlayCursor'
import { formatElapsed, formatDistance, formatClock } from '@/domain/analysis/axisFormat'
import { resolveClockTimezoneOffset, sessionStartAnchor } from '@/domain/analysis/startTime'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import { buildTimelineData, nearestXIndex, type TimelineSource } from '@/domain/analysis/timelineData'
import { planTimeSeriesAxes } from '@/domain/analysis/timeSeriesAxes'
import { channelColor } from '@/domain/analysis/channelPalette'
import {
  availableDerivedAnalyzerChannels,
  isDerivedAnalyzerChannel,
  MEASURED_TOTAL_RATIO_CHANNEL,
  resolveAnalyzerChannel,
} from '@/domain/analysis/analyzerChannels'
import {
  CVT_FRONT_DISPLACEMENT_CHANNEL,
  CVT_FRONT_RADIUS_CHANNEL,
  CVT_REAR_DISPLACEMENT_CHANNEL,
  CVT_REAR_RADIUS_CHANNEL,
  PURE_CVT_RATIO_CHANNEL,
} from '@/domain/analysis/cvtTrace'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import { toCvtTraceConfig, useDrivetrainStore } from '@/stores/drivetrainStore'
import UPlotChart from '@/components/UPlotChart.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import { cachedChannelUpdateRateHz } from '@/composables/channelUpdateRateCache'
import { useDocumentTheme } from '@/composables/useDocumentTheme'

const props = defineProps<{
  /** Persisted dashboard config for a user-added ordinary time-series card.
   * Static hosts such as the gear calculator omit this and supply channelIds. */
  chart?: TimeSeriesChartConfig
  /** Selection owned by a static host such as GearPanel. Values are the same
   * stable raw/virtual channel ids stored by an ordinary chart config. */
  channelIds?: readonly string[]
  /** Static-host channels which are always present and cannot be removed. */
  lockedChannels?: readonly string[]
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
  fixedSeries?: readonly { name: string; data: ArrayLike<number>; unit?: string }[]
  /** Empty-state copy for a fixed derived chart whose prerequisites failed. */
  emptyMessage?: string
  /** #8 — forwarded to UPlotChart: fill the dashboard grid item's height
   *  instead of a fixed pixel height. See UPlotChart's `fillHeight` prop. */
  fillHeight?: boolean
}>()
const emit = defineEmits<{
  cursor: [number | null]
  xZoom: [{ min: number; max: number } | null]
  updateChannels: [string[]]
}>()

const { t } = useI18n()
const analyzer = useAnalyzerStore()
const { xAxis } = storeToRefs(analyzer)
const lapStore = useLapStore()
const settings = useSettingsStore()
const drivetrain = useDrivetrainStore()
const { tzOverride, centreCursorMode } = storeToRefs(settings)
const documentTheme = useDocumentTheme()

const channelStroke = (channelIndex: number): string => channelColor(channelIndex, documentTheme.value)
// Line-dash patterns for overlay mode: style encodes the channel ([] = solid).
const DASHES: number[][] = [[], [6, 4], [2, 3], [8, 3, 2, 3], [12, 4]]
const dash = (i: number): number[] => DASHES[i % DASHES.length]

const xUnit = computed(() => (xAxis.value === 'distance' ? 'm' : 's'))
const laps = computed<Lap[]>(() => props.selectedLaps ?? [])
function derivedContextFor(fileId?: number | null) {
  return {
    wheelCircumferenceMm: drivetrain.kind === 'mt'
      ? drivetrain.inversionWheelCircumferenceMm
      : drivetrain.activeCvtProfile.wheelCircumferenceMm,
    fileId: fileId ?? 'unassigned',
    cvtConfig: drivetrain.kind === 'cvt' ? toCvtTraceConfig(drivetrain.activeCvtProfile) : null,
  }
}
const derivedContext = computed(() => derivedContextFor(props.primaryFileId))

function channelLabel(id: string): string {
  const keys: Record<string, string> = {
    [MEASURED_TOTAL_RATIO_CHANNEL]: 'analyzer.gear.ratioSeriesLabel',
    [PURE_CVT_RATIO_CHANNEL]: 'analyzer.gear.pureCvtRatioSeriesLabel',
    [CVT_FRONT_RADIUS_CHANNEL]: 'analyzer.gear.frontPitchRadiusSeriesLabel',
    [CVT_REAR_RADIUS_CHANNEL]: 'analyzer.gear.rearPitchRadiusSeriesLabel',
    [CVT_FRONT_DISPLACEMENT_CHANNEL]: 'analyzer.gear.frontSheaveDisplacementSeriesLabel',
    [CVT_REAR_DISPLACEMENT_CHANNEL]: 'analyzer.gear.rearSheaveDisplacementSeriesLabel',
  }
  return keys[id] ? t(keys[id]) as string : id
}

function channelDescription(id: string): string {
  return id === MEASURED_TOTAL_RATIO_CHANNEL
    ? t('analyzer.gear.measuredRatioChannelDescription') as string
    : t('analyzer.gear.cvtDerivedChannelDescription') as string
}

const selectedChannelIds = computed<readonly string[]>(() => {
  if (props.fixedSeries) return props.fixedSeries.map((series) => series.name)
  return props.chart?.channels ?? props.channelIds ?? []
})
const canEditChannels = computed(() => props.chart != null || props.channelIds != null)

const allChannels = computed<Array<{ name: string; value?: string; description?: string }>>(() =>
  [
    ...props.session.channels.map((c) => ({ name: c.name, description: c.description })),
    ...availableDerivedAnalyzerChannels(props.session, derivedContext.value).map((id) => ({
      name: channelLabel(id),
      value: id,
      description: channelDescription(id),
    })),
  ]
    .sort((a, b) => a.name.localeCompare(b.name)),
)
const pickerOptions = computed(() =>
  allChannels.value.filter(
    (c) => !selectedChannelIds.value.includes(c.value ?? c.name),
  ),
)
const presentSources = computed<Array<{ name: string; data: ArrayLike<number>; unit?: string }>>(() => {
  if (props.fixedSeries) return [...props.fixedSeries]
  if (selectedChannelIds.value.length === 0) return []
  const sources: Array<{ name: string; data: ArrayLike<number>; unit?: string }> = []
  for (const name of selectedChannelIds.value) {
    const resolution = resolveAnalyzerChannel(props.session, name, derivedContext.value)
    if (resolution.data) sources.push({ name, data: resolution.data, unit: resolution.unit })
  }
  return sources
})
const present = computed(() => presentSources.value.map((source) => source.name))
// Source units are resolved with the selected channels/session, never while a
// cursor moves. The raw channel id remains the scale key below; B81 can use
// this map to group compatible units without changing persisted channel ids.
const unitsByChannel = computed(() => new Map(
  presentSources.value.flatMap((source) => source.unit ? [[source.name, source.unit] as const] : []),
))
function channelDisplayLabel(id: string): string {
  const unit = unitsByChannel.value.get(id)
  const label = channelLabel(id)
  return unit ? `${label} (${unit})` : label
}
const valueAxes = computed(() => planTimeSeriesAxes(
  present.value.map((id) => ({
    id,
    label: channelDisplayLabel(id),
    unit: unitsByChannel.value.get(id),
  })),
))
const updateRateHz = computed<number | null>(() => {
  let highest: number | null = null
  for (const source of presentSources.value) {
    const rate = cachedChannelUpdateRateHz(props.session, source.name, source.data)
    if (rate != null && (highest == null || rate > highest)) highest = rate
  }
  return highest
})
const updateRateLabel = computed(() =>
  updateRateHz.value == null ? null : `${updateRateHz.value.toFixed(1)} Hz`,
)
const unavailableDerivedMessage = computed<string | null>(() => {
  for (const id of selectedChannelIds.value) {
    if (!isDerivedAnalyzerChannel(id)) continue
    const resolution = resolveAnalyzerChannel(props.session, id, derivedContext.value)
    if (resolution.error === 'rpm') return t('analyzer.gear.noRpmChannel') as string
    if (resolution.error === 'speed') return t('analyzer.gear.noSpeedChannel') as string
    if (resolution.error === 'circumference') return t('analyzer.gear.invalidCircumference') as string
    if (resolution.error === 'fixed-reduction') return t('analyzer.gear.cvtMissingFixedReduction') as string
    if (resolution.error === 'belt-length') return t('analyzer.gear.cvtMissingBeltLength') as string
    if (resolution.error === 'center-distance') return t('analyzer.gear.cvtMissingCenterDistance') as string
    if (resolution.error === 'sheave-angle') return t('analyzer.gear.cvtMissingSheaveAngle') as string
    if (resolution.error === 'radius-bounds') return t('analyzer.gear.cvtMissingRadiusBounds') as string
    if (resolution.data) {
      let finite = false
      for (let i = 0; i < resolution.data.length; i++) {
        if (Number.isFinite(resolution.data[i])) { finite = true; break }
      }
      if (!finite) return t('analyzer.gear.noRatioSamples') as string
    }
  }
  return null
})

// --- No-selection fallback: each channel over the FULL session on a shared
// X (B8 — this is what renders whenever no lap is selected; see
// `hasSelection` below for the switch to the lap-relative overlay). ---
const plotWidth = ref(1200)
const pointBudget = computed(() => Math.max(300, Math.ceil(plotWidth.value * 2)))
const timelineSources = computed<TimelineSource[]>(() => {
  const primaryId = props.primaryFileId ?? -1
  const primaryChannels = props.fixedSeries
    ? new Map(props.fixedSeries.map((series) => [series.name, series.data]))
    : new Map(presentSources.value.map((source) => [source.name, source.data]))
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
      channels: new Map(present.value.flatMap((id) => {
        const data = resolveAnalyzerChannel(comparison.session, id, derivedContextFor(comparison.id)).data
        return data ? [[id, data] as const] : []
      })),
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
    label: `${entry.sourceLabel} · ${channelDisplayLabel(entry.channel)}`,
    stroke: channelStroke(entry.channelIndex),
    dash: dash(entry.channelIndex),
    width: entry.primary ? 1.5 : 1,
    scale: valueAxes.value.scaleFor(entry.channel),
    spanGaps: true,
  })),
])

// --- Overlay: selected laps re-based to a lap-relative X (from 0). ---
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
const crossLapSources = computed<CrossSessionLapSource[]>(() => {
  // Both persisted dashboard charts and static hosts use stable channel ids,
  // so their cross-session overlays can resolve raw and virtual channels by
  // the exact same path.
  if (selectedChannelIds.value.length === 0 || lapStore.selectedAcrossSessions.length === 0) return []
  const sources: CrossSessionLapSource[] = []
  const primaryId = props.primaryFileId ?? -1
  const primaryColor = categoricalColor(primaryId)
  for (const lap of laps.value) {
    sources.push({
      fileId: primaryId,
      sessionName: props.primaryFileName ?? 'Primary',
      color: primaryColor,
      xValues: props.xValues,
      channels: presentSources.value,
      lap,
      offset: lapStore.offsetOf(lap.index, xAxis.value),
    })
  }
  for (const ref of lapStore.selectedAcrossSessions) {
    const comparison = props.comparisonSessions?.find((entry) => entry.id === ref.fileId)
    const lap = comparison?.laps.find((entry) => entry.index === ref.index)
    if (!comparison || !lap) continue
    const channels = present.value.map((name) => {
      const data = resolveAnalyzerChannel(comparison.session, name, derivedContextFor(comparison.id)).data
      return { name, data: data ?? new Float32Array(comparison.session.rowCount).fill(NaN) }
    })
    sources.push({
      fileId: comparison.id,
      sessionName: comparison.name,
      color: comparison.color,
      xValues: comparison.xValues,
      channels,
      lap,
      offset: lapStore.sessionLapOffsetOf(comparison.id, lap.index, xAxis.value),
    })
  }
  return sources
})
const crossOverlay = computed(() => buildCrossSessionLapOverlay(crossLapSources.value))
const useCrossOverlay = computed(() => crossLapSources.value.some((source) => source.fileId !== (props.primaryFileId ?? -1)))
// B8 — overlay is now the ONLY display mode (the old "timeline" mode toggle
// was removed). With no laps selected (same-session AND cross-session), there
// is nothing to re-base onto a lap-relative grid, so the chart falls back to
// showing the full session (every selected channel over the whole session's
// time/distance axis — exactly what the removed "timeline" mode used to
// render). `hasSelection` is that single switch every other computed below
// keys off instead of the old `mode === 'overlay'` check.
const hasSelection = computed(() => laps.value.length > 0 || crossLapSources.value.length > 0)
// The shared lap-relative X grid the overlay plots against — same array whether
// cross-session or single-session. Backs the overlay↔map cursor conversion.
const overlayGridX = computed<Float64Array>(() =>
  useCrossOverlay.value ? crossOverlay.value.x : overlay.value.x,
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
      useCrossOverlay.value ? crossOverlay.value.x : overlay.value.x,
      ...(useCrossOverlay.value ? crossOverlay.value.series : overlay.value.series)
        .map((s) => Array.from(s.y, (v) => (Number.isFinite(v) ? v : null))),
    ] as unknown as uPlot.AlignedData,
)
const overlaySeries = computed<uPlot.Series[]>(() => {
  if (useCrossOverlay.value) {
    return [
      { label: xUnit.value },
      ...crossOverlay.value.series.map((s) => ({
        label: `${s.sessionName} · #${s.lap.index + 1} · ${channelDisplayLabel(present.value[s.channelIndex])}`,
        stroke: channelStroke(s.channelIndex),
        dash: dash(s.channelIndex),
        width: 1 + (s.lapOrder % 3) * 0.35,
        scale: valueAxes.value.scaleFor(present.value[s.channelIndex]),
      })),
    ]
  }
  return [
    { label: xUnit.value },
    ...overlay.value.series.map((s) => ({
      label: `#${s.lap.index + 1} · ${channelDisplayLabel(present.value[s.channelIndex])}`,
      stroke: channelStroke(s.channelIndex),
      dash: dash(s.channelIndex),
      width: 1,
      scale: valueAxes.value.scaleFor(present.value[s.channelIndex]),
    })),
  ]
})

const data = computed<uPlot.AlignedData>(() =>
  hasSelection.value ? overlayData.value : timelineData.value,
)
const series = computed<uPlot.Series[]>(() =>
  hasSelection.value ? overlaySeries.value : timelineSeries.value,
)

// Absolute start instant (elapsed=0) of this session, for the clock-time axis.
const anchor = computed(() => sessionStartAnchor(props.session))

// Effective timezone offset (minutes east of UTC) for the absolute clock axis.
// `auto` always follows the app's established local-time policy, irrespective of
// whether the absolute anchor came from GPS UTC or a header created date. The
// primary axis, uPlot legend, and cursor readout remain elapsed time/distance and
// therefore deliberately have no timezone conversion to apply.
const effectiveOffset = computed<number>(() => {
  return resolveClockTimezoneOffset(tzOverride.value, -new Date().getTimezoneOffset())
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

// x axis + one value axis per selected channel; in the no-selection full-session
// view they're coloured per series, when laps are selected colour means "lap"
// so the channel axes stay theme-neutral. In the no-selection view + time axis,
// an extra bottom x-axis shows absolute clock time.
const axes = computed<uPlot.Axis[]>(() => {
  const xValuesFmt = (_u: uPlot, splits: number[]): string[] =>
    splits.map((v) => (xAxis.value === 'distance' ? formatDistance(v) : formatElapsed(v)))
  const showClock = !hasSelection.value && xAxis.value === 'time' && anchor.value != null
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
    ...valueAxes.value.axes.map((axis) => ({
      scale: axis.scale,
      side: axis.side,
      label: axis.label,
      show: axis.show,
    })),
  ]
})

// Overlay's X is a lap-relative grid space, unrelated to the session-wide
// cursor/zoom. Overlay charts share `overlayCursorIdx` (a grid index) so their
// cursor aligns across charts even when there's no primary lap to anchor on
// (a comparison-only overlay). On TOP of that, the grid index is now bridged to
// the primary session's SAMPLE index (overlayCursor.ts) so a hover also drives
// the track map / timeline cursor, and a map/timeline hover drives the overlay
// cursor back — the "共同 X ↔ 各圈樣本 index" linking.
// B8 — with no laps selected there's no lap-relative grid to render against,
// so `canRender` no longer requires a selection: it falls back to the
// full-session view (`present.value.length > 0` is the only gate, same as
// the old timeline mode).
const canRender = computed(() => present.value.length > 0)
const effectiveCursor = computed<number | null>(() => {
  if (!hasSelection.value) {
    return props.externalCursor == null
      ? null
      : nearestXIndex(timeline.value.data[0], props.xValues[props.externalCursor])
  }
  // Reverse link (map/timeline → overlay): map the shared session cursor onto
  // this overlay's grid via whichever selected primary lap contains it, so the
  // overlay follows a hover made elsewhere. Falls back to the overlay's own
  // shared cursor when the session cursor isn't over a selected primary lap
  // (e.g. a comparison-only overlay, where there's no primary sample to map).
  const ci = props.externalCursor
  const grid = overlayGridX.value
  if (ci != null && grid.length > 0) {
    const lap = lapContaining(laps.value, ci)
    if (lap) {
      const g = gridIndexAtSampleIndex(props.xValues, lap, lapStore.offsetOf(lap.index, xAxis.value), grid, ci)
      if (g != null) return g
    }
  }
  return analyzer.overlayCursorIdx
})
function onCursor(idx: number | null): void {
  if (hasSelection.value) {
    // Keep the overlay charts' shared cursor in sync (works with no primary lap
    // too), and forward-link it to the map/timeline by converting the grid
    // index to a primary-session sample index via the first selected primary
    // lap. No primary lap ⇒ emit null so a stale map marker doesn't linger.
    analyzer.setOverlayCursor(idx)
    if (idx == null) {
      emit('cursor', null)
      return
    }
    const primaryLap = laps.value[0] ?? null
    const gx = overlayGridX.value[idx]
    const mapped = primaryLap != null && gx != null
      ? sampleIndexAtGridX(props.xValues, primaryLap, lapStore.offsetOf(primaryLap.index, xAxis.value), gx)
      : null
    emit('cursor', mapped)
    return
  }
  if (idx == null) emit('cursor', null)
  else emit('cursor', nearestXIndex(props.xValues, timeline.value.data[0][idx]))
}
// The no-selection full-session view is the only rendering that shares the
// session-wide xRange (overlay's lap-relative grid is structurally unrelated
// to it — see focusRange.ts) — so xZoom (including a reset-to-null from
// UPlotChart's own reset-zoom control) only propagates up while there's no
// lap selection. A selection-mode chart's local zoom/reset stays purely
// local to that chart (see UPlotChart.vue's `resetZoomLocal`).
function onXZoom(r: { min: number; max: number } | null): void {
  if (!hasSelection.value) emit('xZoom', r)
}

function addChannel(name: string | null): void {
  if (name && !selectedChannelIds.value.includes(name)) {
    const next = [...selectedChannelIds.value, name]
    if (props.chart) analyzer.setChartChannels(props.chart.id, next)
    else emit('updateChannels', next)
  }
}
function removeChannel(name: string): void {
  if (!canEditChannels.value || props.lockedChannels?.includes(name)) return
  const next = selectedChannelIds.value.filter((n) => n !== name)
  if (props.chart) analyzer.setChartChannels(props.chart.id, next)
  else emit('updateChannels', next)
}
</script>

<template>
  <section class="chart" :class="{ fill: fillHeight }">
    <div class="toolbar">
      <div v-if="canEditChannels" class="picker">
        <SearchableSelect :model-value="null" :options="pickerOptions" @update:model-value="addChannel" />
      </div>
      <div class="toolbar-meta">
        <span v-if="updateRateLabel" class="update-rate">{{ updateRateLabel }}</span>
        <button v-if="chart" type="button" class="remove" @click="analyzer.removeChart(chart.id)">
          {{ t('analyzer.removeChart') }}
        </button>
      </div>
    </div>

    <div class="chips">
      <span v-for="(name, i) in present" :key="name" class="chip">
        <span
          class="dot"
          :style="{ background: channelStroke(i) }"
        />
        {{ channelDisplayLabel(name) }}
        <button v-if="canEditChannels && !lockedChannels?.includes(name)" type="button" class="x" @click="removeChannel(name)">×</button>
      </span>
      <span v-if="present.length === 0" class="muted">{{ unavailableDerivedMessage ?? emptyMessage ?? t('analyzer.pickChannel') }}</span>
    </div>

    <p v-if="present.length > 0 && unavailableDerivedMessage" class="muted derived-warning">
      {{ unavailableDerivedMessage }}
    </p>

    <!-- B28 fix: xBounds must describe THIS chart's own data extent, not the
         session's. UPlotChart's applyXRange() falls back to xBounds (via
         dataXBounds()) whenever xRange is null (B9) — and xRange IS null
         whenever hasSelection is true (see the x-range binding below), since
         the overlay's lap-relative grid is structurally unrelated to the
         shared session xRange. Passing the full SESSION span here
         unconditionally (as before) made that B9 fallback re-zoom every
         selection-mode chart out to the whole session on every lap
         (re)selection — the overlay data (only ~lap-duration wide) then
         rendered as a sliver, i.e. "the chart didn't zoom to the lap" (B28).
         Only the no-selection full-session view's `data` is a
         downsampled/visible-range SUBSET of the session that genuinely needs
         this session-wide clamp for touch pan/pinch and the null-xRange
         fallback; the overlay view's `data` already IS its own full extent,
         so dataXBounds() should derive straight from `props.data[0]` there
         (its no-xBounds path) instead. -->
    <UPlotChart
      v-if="canRender"
      class="chart-fill"
      :data="data"
      :series="series"
      :axes="axes"
      :x-range="!hasSelection ? xRange : null"
      :external-cursor="effectiveCursor"
      :fill-height="fillHeight"
      :centre-cursor-mode="centreCursorMode"
      :x-bounds="!hasSelection && xValues.length > 1 ? { min: xValues[0], max: xValues[xValues.length - 1] } : null"
      @cursor="onCursor"
      @x-zoom="onXZoom"
      @plot-width="plotWidth = $event"
    />
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
.toolbar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}
.update-rate {
  color: var(--color-text-muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
/* B35 — §8 layer 3: capability signal (useInputCapabilities.ts, mirrored onto
   <html data-any-pointer-coarse>), not a viewport-width guess — grows the
   remove-chart button ("close" this card's content) to a >=44px touch
   target on any coarse-pointer device. */
:root[data-any-pointer-coarse] .remove {
  min-height: 44px;
  padding: 12px 16px;
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
</style>
