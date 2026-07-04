<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { GridLayout } from 'grid-layout-plus'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLaps } from '@/composables/useLaps'
import { useCircuitPersistence } from '@/composables/useCircuitPersistence'
import { useTrackHeatmap } from '@/composables/useTrackHeatmap'
import { useTrackExtrema } from '@/composables/useTrackExtrema'
import { useDashboardLayout } from '@/composables/useDashboardLayout'
import { usePanelState } from '@/composables/usePanelState'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import type { LapLine } from '@/domain/analysis/laps'
import { lapColor } from './lapColors'
import { xRangeToFocusIndices } from '@/domain/analysis/focusRange'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import { fastestDistanceSegment, fastestSpeedSegment, type AccelSegment } from '@/domain/analysis/accelTest'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import {
  STATIC_CARD_IDS,
  chartItemId,
  mobileLayout,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'
import DashboardCard from '@/components/DashboardCard.vue'
import TrackMap from './TrackMap.vue'
import TimeSeriesChart from './TimeSeriesChart.vue'
import LapTable from './LapTable.vue'
import LapAlignPanel from './LapAlignPanel.vue'
import MapAlignPanel from './MapAlignPanel.vue'
import SectorPanel from './SectorPanel.vue'
import TrackChannelPanel from './TrackChannelPanel.vue'
import AccelTestPanel from './AccelTestPanel.vue'
import GearPanel from './GearPanel.vue'
import TrackFilePanel from './TrackFilePanel.vue'
import SessionMergePanel from './SessionMergePanel.vue'
import ScatterChart from './ScatterChart.vue'

const { t } = useI18n()
const fileStore = useFileStore()
const analyzer = useAnalyzerStore()
const lapStore = useLapStore()
const sectorStore = useSectorStore()
const { charts, xAxis, xRange, cursorIdx, trackChannel, trackColormap, trackColorEnabled, markMinima, markMaxima } =
  storeToRefs(analyzer)
const { session, track, xValues } = useActiveSession()
const { laps, timeMs, resetLine } = useLaps()
// Local track-setup persistence (§11 D): auto-restores/saves the start/finish
// line, sector gates and lap-table columns per circuit (GPS-keyed). Registered
// AFTER useLaps() so its restore (async, via store actions) runs after — and
// overrides — useLaps()'s synchronous default-line seeding on file change.
useCircuitPersistence()

const readyFiles = computed(() => fileStore.files.filter((f) => f.status === 'ready'))

const hasEcuLaps = computed(() => session.value?.has('IR_LapNumber') ?? false)

// The selected laps (from the table) resolved to Lap objects, in selection
// order (so each gets a stable color); missing indices are filtered out.
const selectedLaps = computed(() =>
  lapStore.selected
    .map((i) => laps.value.find((l) => l.index === i))
    .filter((l): l is NonNullable<typeof l> => l != null),
)

// The alignment panel only makes sense when laps are being overlaid: at least
// one chart in overlay mode and ≥2 laps selected to compare/align.
const showAlign = computed(
  () =>
    selectedLaps.value.length >= 2 &&
    charts.value.some((c) => c.kind === 'timeseries' && c.mode === 'overlay'),
)

// One colored segment per selected lap; color is assigned by selection order.
// `offset` is the per-lap MAP position nudge (metres east/north) so GNSS-drifted
// racing lines can be aligned on the track map (#9 spatial half).
const highlightLaps = computed(() =>
  selectedLaps.value.map((lap, order) => ({
    startIdx: lap.startIdx,
    endIdx: lap.endIdx,
    color: lapColor(order),
    offset: lapStore.mapOffsetOf(lap.index),
  })),
)

// The map-alignment panel applies to whatever laps are drawn on the map, so it
// shows whenever ≥2 laps are selected (independent of any overlay chart).
const showMapAlign = computed(() => selectedLaps.value.length >= 2)

// #7: derive the track map's chart-zoom-follow focus from the shared xRange.
// xRange is written ONLY by timeline-mode charts (overlay charts live in a
// lap-relative grid and structurally never call setXRange — see
// TimeSeriesChart.vue's onXZoom), so no separate mode flag is needed here;
// xRangeToFocusIndices also treats a (near-)whole-session range as "no focus"
// so the map isn't emphasizing everything. DERIVED, not stored — no
// state-writing watcher.
//
// Precedence: an explicit LAP SELECTION (highlightLaps non-empty) always wins
// over chart-range focus — selecting laps is a deliberate, higher-intent
// choice than an in-progress chart zoom, and the two would otherwise fight
// over the map's single "emphasized segment" visual. Chart-range focus only
// applies when nothing is selected.
const focusRange = computed(() =>
  highlightLaps.value.length > 0 ? null : xRangeToFocusIndices(xRange.value, xValues.value),
)

// Sector gates for the track map: every gate is a real, working gate now (A1+A15
// redesign removed the accept/reject suggestion layer) — all drawn solid/numbered.
const mapGates = computed(() => sectorStore.gates.map((line) => ({ line, confirmed: true })))

// TrackMap emits (index, line) when a gate's handle is dragged; sectorStore.gates
// is the single owner of gate geometry, so forward straight into its action
// rather than mutating anything locally.
function onUpdateGate(index: number, line: LapLine): void {
  sectorStore.setGate(index, line)
}

// Same resolveSpeedChannel useLaps.ts uses to seed the default lap-table
// column (GPS_Speed -> Vehicle_Speed -> unavailable) — still needed here by
// AccelTestPanel.
const speedChannelName = computed(() => (session.value ? resolveSpeedChannel(session.value) : null))
const speedAvailable = computed(() => speedChannelName.value != null)

// --- A9: unified track-channel extrema (generalised from the old speed-only
// corner apexes to ANY channel, min AND/OR max) — see useTrackExtrema.ts. ---

// Multi-lap rule (unchanged from the old corner-apex feature): extrema are
// only meaningful for ONE lap at a time (a numbered marker set doesn't
// generalise to overlaying several laps' extrema on the same points), so this
// is populated only when exactly one lap is selected. With zero or 2+ laps
// selected, extrema is null and the map/panel show their respective "select
// exactly one lap" hints.
const focusedLap = computed(() => (selectedLaps.value.length === 1 ? selectedLaps.value[0] : null))

const { trackExtrema, mapExtremaMarkers, trackChannelChosen } = useTrackExtrema(
  session,
  track,
  trackChannel,
  focusedLap,
  markMinima,
  markMaxima,
)

// --- Acceleration/drag test (Phase 7, 加速測試): whole-SESSION search, not
// a per-lap metric — see accelTest.ts's module doc for why. Speed channel
// resolution reuses the same speedChannelName as corner-speed above. Distance
// is always needed (both search kinds interpolate/report distanceM), so this
// is unavailable without a GPS track even for the speed-threshold condition.
const accelResult = computed<AccelSegment | null>(() => {
  const chName = speedChannelName.value
  const s = session.value
  const tk = track.value
  const tMs = timeMs.value
  if (!chName || !s || !tk || !tMs) return null
  const ch = s.get(chName)
  if (!ch) return null
  const cumDist = cumulativeDistanceM(tk.lat, tk.lon, tk.valid)
  const cond = analyzer.accelCondition
  if (cond.kind === 'distance') {
    if (!(cond.distanceM > 0)) return null
    return fastestDistanceSegment(cumDist, tMs, ch.data, {
      distanceM: cond.distanceM,
      minEntrySpeedKmh: cond.minEntrySpeedKmh ?? undefined,
    })
  }
  return fastestSpeedSegment(tMs, ch.data, cumDist, { fromKmh: cond.fromKmh, toKmh: cond.toKmh })
})

// Focus the found segment: zoom the shared xRange to its span (same
// select->zoom coupling as onLapSelect) and clear any lap selection so the
// zoomed range isn't immediately overridden by the lap-selection focus
// precedence in `focusRange` above.
function onAccelFocus(segment: AccelSegment): void {
  const xs = xValues.value
  if (!xs || segment.startIdx >= xs.length || segment.endIdx >= xs.length) return
  lapStore.clearSelection()
  analyzer.setXRange({ min: xs[segment.startIdx], max: xs[segment.endIdx] })
}

// Channels offered for the picker (all of them, sorted) — this is now the
// ONLY channel picker on the page; TrackChannelPanel owns rendering it.
const channelOptions = computed(() =>
  (session.value?.channels ?? [])
    .map((c) => ({ name: c.name, description: c.description }))
    .sort((a, b) => a.name.localeCompare(b.name)),
)

// --- Track heatmap (#10/#11, now A9-unified): colour the track by the
// SINGLE chosen trackChannel's value, when trackColorEnabled — see
// useTrackHeatmap.ts. ---
const { heatNorm, colorValues, legendGradient, fmtVal } = useTrackHeatmap(
  session,
  track,
  trackChannel,
  trackColormap,
  trackColorEnabled,
)

// Lap selection from the table is routed here so this component (which owns the
// select↔zoom coupling) stays the single place that decides zoom side-effects.
// The zoom rule is applied imperatively right after toggling — no state-writing
// watcher — to keep selection and zoom from fighting each other.
function onLapSelect(index: number | null): void {
  // Explicit clear (clear button) → empty selection + full view.
  if (index == null) {
    lapStore.clearSelection()
    analyzer.setXRange(null)
    return
  }
  lapStore.toggleLap(index)
  const sel = lapStore.selected
  const xs = xValues.value
  if (sel.length === 1 && xs) {
    // Exactly one lap selected → zoom the charts to its span.
    const lap = laps.value.find((l) => l.index === sel[0])
    if (lap) analyzer.setXRange({ min: xs[lap.startIdx], max: xs[lap.endIdx] })
  } else {
    // 0 selected (toggled the last one off) or ≥2 (comparison) → full view so
    // every selected lap is visible at once.
    analyzer.setXRange(null)
  }
}

// Switching the X unit (time↔distance) invalidates any shared zoom range; the
// selected laps' spans are in the old units, so clear the selection too.
watch(xAxis, () => {
  lapStore.clearSelection()
  analyzer.setXRange(null)
})

watch(
  readyFiles,
  (files) => {
    const exists = files.some((f) => f.id === analyzer.activeFileId)
    if (!exists) analyzer.activeFileId = files.length ? files[0].id : null
  },
  { immediate: true },
)

// Fired ONLY on user drag-zoom or double-click-reset (the programmatic
// select→zoom path sets a guard in UPlotChart so it never echoes here).
function onXZoom(r: { min: number; max: number } | null): void {
  analyzer.setXRange(r)
  // A single-lap selection is zoom-coupled (selecting it drove this zoom), so a
  // manual zoom means the user moved off it → deselect. A multi-lap selection is
  // a track comparison that's independent of chart zoom, so leave it intact.
  if (lapStore.selected.length <= 1) lapStore.clearSelection()
}

function onSelect(e: Event): void {
  analyzer.activeFileId = Number((e.target as HTMLSelectElement).value)
}

// A10+A12 — add-chart is now a two-option affordance (時序圖 / XY 散佈圖).
function onAddTimeseries(): void {
  analyzer.addChart('timeseries')
}

// New scatter charts default to TC_Xforce/TC_Yforce when present (the
// friction-circle convenience, ex-GgPanel), else both pickers start empty and
// ScatterChart shows the "pick both" hint.
function onAddScatter(): void {
  const s = session.value
  analyzer.addChart('scatter', {
    xChannel: s?.has('TC_Xforce') ? 'TC_Xforce' : null,
    yChannel: s?.has('TC_Yforce') ? 'TC_Yforce' : null,
  })
}

// --- Valid lap-time band (時間帶過濾): laps whose time is outside [min, max]
// seconds are auto-excluded via the lapStore. Each input is independent; an
// empty field leaves that side open, and clearing both removes the band. ---
const bandMin = computed<number | null>({
  get: () => lapStore.lapTimeBand?.minSec ?? null,
  set: (v) => lapStore.setLapTimeBand({ minSec: v, maxSec: lapStore.lapTimeBand?.maxSec ?? null }),
})
const bandMax = computed<number | null>({
  get: () => lapStore.lapTimeBand?.maxSec ?? null,
  set: (v) => lapStore.setLapTimeBand({ minSec: lapStore.lapTimeBand?.minSec ?? null, maxSec: v }),
})

/** Parse a band <input>'s value to seconds, or null when blank/non-numeric. */
function onBandInput(which: 'min' | 'max', e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  const v = raw === '' ? null : Number(raw)
  const sec = v != null && Number.isFinite(v) ? v : null
  if (which === 'min') bandMin.value = sec
  else bandMax.value = sec
}

// How many laps the band currently excludes (0 when no band) — a quick sanity
// readout so the user can see the filter is doing something.
const bandExcludedCount = computed(() => lapStore.bandExcluded.length)

// --- Valid lap-DISTANCE band (距離帶過濾): mirrors the time band above exactly,
// except the store's unit is METRES while this panel (like LapTable) displays
// km — so get/set convert at the boundary, keeping the store's unit consistent
// with the rest of the app (cumulativeDistanceM / the `distance` lap metric). ---
const M_PER_KM = 1000
const distBandMin = computed<number | null>({
  get: () => {
    const m = lapStore.lapDistanceBand?.minM
    return m != null ? m / M_PER_KM : null
  },
  set: (km) =>
    lapStore.setLapDistanceBand({
      minM: km != null ? km * M_PER_KM : null,
      maxM: lapStore.lapDistanceBand?.maxM ?? null,
    }),
})
const distBandMax = computed<number | null>({
  get: () => {
    const m = lapStore.lapDistanceBand?.maxM
    return m != null ? m / M_PER_KM : null
  },
  set: (km) =>
    lapStore.setLapDistanceBand({
      minM: lapStore.lapDistanceBand?.minM ?? null,
      maxM: km != null ? km * M_PER_KM : null,
    }),
})

/** Parse a distance-band <input>'s value (km), or null when blank/non-numeric. */
function onDistBandInput(which: 'min' | 'max', e: Event): void {
  const raw = (e.target as HTMLInputElement).value.trim()
  const v = raw === '' ? null : Number(raw)
  const km = v != null && Number.isFinite(v) ? v : null
  if (which === 'min') distBandMin.value = km
  else distBandMax.value = km
}

// How many laps the distance band currently excludes (0 when no band).
const distBandExcludedCount = computed(() => lapStore.distanceBandExcluded.length)

// How many laps fail the sector-gate-crossing check (0 when no gates are
// confirmed yet) — mirrors bandExcludedCount, shown next to the sector panel.
const sectorInvalidCount = computed(() => lapStore.sectorInvalid.length)

// --- #8: draggable/resizable dashboard grid (grid-layout-plus) ---
const chartIds = computed(() => charts.value.map((c) => c.id))
const { layout, colNum, isMobile, isDraggable, isResizable, resetLayout } =
  useDashboardLayout(chartIds)

// --- #9: per-card collapse (all breakpoints) + single mobile pin + mobile
// drag-to-reorder order ---
const { isCollapsed, isPinned, toggleCollapsed, togglePinned, mobileOrder, setMobileOrder } =
  usePanelState(chartIds)

// The align panels (mapalign/lapalign) only render when their "≥2 laps
// selected" condition holds (showMapAlign/showAlign, unchanged rules from
// before the grid) — an empty GridItem for a hidden card would otherwise
// leave a draggable blank box on the dashboard. `isVisibleId` is the single
// visibility predicate shared by both the desktop and mobile layout builders.
function isVisibleId(id: string): boolean {
  if (id === STATIC_CARD_IDS.mapAlign) return showMapAlign.value
  if (id === STATIC_CARD_IDS.lapAlign) return showAlign.value
  return true
}

// --- Desktop layout (2-D, persisted to dashboardLayout.v1) ---
// `desktopVisibleLayout` filters the hidden align cards out of what's PASSED
// to GridLayout while `layout` itself (the persisted array) keeps their saved
// position so it's there again the next time laps get selected. GridLayout's
// `update:layout` (drag/resize/compact) fires with the full array of items IT
// knows about (i.e. already only the visible ones), so writing straight back
// into `layout` would drop the hidden entries — instead we merge: keep every
// hidden item from `layout` unchanged, and take every visible item's new
// position from the emitted array.
const desktopVisibleLayout = computed<typeof layout.value>(() =>
  layout.value.filter((it) => isVisibleId(it.i)),
)

// --- Mobile layout (1-D order, persisted to panelState.v1's mobileOrder) ---
// The mobile single-column layout is built by US (not the library's responsive
// reflow) from the persisted `mobileOrder`, filtered to the visible cards and
// with each card's DESKTOP height inherited (see mobileLayout). Because the
// mobile path only ever writes back into `mobileOrder` (never `layout`),
// reordering on a phone can NEVER corrupt the desktop dashboardLayout.v1 — the
// two arrangements are fully independent.
const mobileVisibleLayout = computed<typeof layout.value>(() =>
  mobileLayout(
    mobileOrder.value.filter(isVisibleId),
    layout.value,
  ),
)

// Per-item props the library's OWN GridItem needs (we no longer render a
// GridItem ourselves — see the `#item` slot note). grid-layout-plus spreads
// each layout entry as props onto the GridItem it wraps around the slot, so
// carrying these on the item is how the drag handle / ignore region / the
// mobile-pin non-draggable exception reach that internal GridItem.
interface GridItemDecoration {
  dragAllowFrom: string
  dragIgnoreFrom: string
  isDraggable: boolean
}
function decorateForGrid(
  items: DashboardLayoutItem[],
): (DashboardLayoutItem & GridItemDecoration)[] {
  return items.map((it) => ({
    ...it,
    dragAllowFrom: '.drag-handle',
    dragIgnoreFrom: '.actions',
    isDraggable: itemDraggable(it.i),
  }))
}

// The single array bound to GridLayout via v-model: desktop 2-D on wide
// screens, our 1-column mobileLayout below MOBILE_BREAKPOINT_PX. The getter
// decorates items with the per-GridItem drag props above; the setter reads
// back only `{ i, x, y, w, h }` (the decorations are ignored) and routes the
// library's `update:layout` emission to the RIGHT persistence path for the
// current breakpoint so the other one is never touched.
const activeLayout = computed<(DashboardLayoutItem & GridItemDecoration)[]>({
  get: () =>
    decorateForGrid(isMobile.value ? mobileVisibleLayout.value : desktopVisibleLayout.value),
  set: (next) => {
    if (isMobile.value) {
      // Mobile drag-to-reorder: derive the new top-to-bottom order from the
      // emitted items (sorted by y, then x for determinism) and persist ONLY
      // that order. Hidden align cards keep their stored slot in mobileOrder
      // (they're not in `next`), appended in their existing relative order so
      // toggling laps back on restores them where the user last had them.
      const orderedVisible = [...next]
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((it) => it.i)
      const visibleSet = new Set(orderedVisible)
      const hidden = mobileOrder.value.filter((id) => !visibleSet.has(id))
      setMobileOrder([...orderedVisible, ...hidden])
      return
    }
    // Desktop: merge visible items' new positions back into the full layout,
    // preserving hidden items untouched.
    const nextById = new Map(next.map((it) => [it.i, it]))
    layout.value = layout.value.map((it) => nextById.get(it.i) ?? it)
  },
})

// Pin/drag interplay (mobile): a PINNED card is NOT draggable while pinned —
// dragging a sticky card makes no sense, and it keeps the pinned card anchored
// at the top of the column. The user unpins first (its own header button),
// then it becomes draggable again. Documented here + on the per-item
// `:is-draggable` binding in the template.
function itemDraggable(id: string | number): boolean {
  if (!isDraggable.value) return false
  if (isMobile.value && isPinned(String(id))) return false
  return true
}

function onResetLayout(): void {
  if (window.confirm(t('analyzer.layout.resetLayoutConfirm'))) resetLayout()
}

/** Per-chart card title: numbered by POSITION among same-kind charts (1-based,
 *  in `charts` array order) so titles stay short and stable-looking even
 *  though the underlying grid-item id is keyed by the chart's store id (see
 *  chartItemId) — the two numbering schemes are deliberately independent. */
function chartTitle(chart: (typeof charts.value)[number]): string {
  const sameKind = charts.value.filter((c) => c.kind === chart.kind)
  const n = sameKind.indexOf(chart) + 1
  return chart.kind === 'scatter'
    ? t('analyzer.layout.cardScatterChart', { n })
    : t('analyzer.layout.cardChart', { n })
}
</script>

<template>
  <div class="analyzer">
    <p v-if="readyFiles.length === 0" class="empty">{{ t('analyzer.noFiles') }}</p>

    <template v-else>
      <div class="toolbar">
        <label class="record">
          <span>{{ t('analyzer.record') }}</span>
          <select name="record" :value="analyzer.activeFileId ?? ''" @change="onSelect">
            <option v-for="f in readyFiles" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </label>
        <div class="xaxis">
          <button type="button" :class="{ active: xAxis === 'time' }" @click="analyzer.xAxis = 'time'">
            {{ t('analyzer.time') }}
          </button>
          <button type="button" :class="{ active: xAxis === 'distance' }" @click="analyzer.xAxis = 'distance'">
            {{ t('analyzer.distance') }}
          </button>
        </div>
        <div class="layout-tools">
          <span v-if="!isMobile" class="drag-hint">{{ t('analyzer.layout.dragHint') }}</span>
          <button type="button" class="reset-layout" @click="onResetLayout">
            {{ t('analyzer.layout.resetLayout') }}
          </button>
        </div>
      </div>

      <!-- #8/#9: draggable dashboard grid (grid-layout-plus). Drag is restricted
           to each card's own `.drag-handle` header (DashboardCard's title bar)
           via `dragAllowFrom`, and the header's own buttons (pin/collapse, in
           `.actions`) are excluded via `dragIgnoreFrom` so tapping them toggles
           state instead of starting a drag. `colNum` is driven explicitly by
           breakpoint (GRID_COLS on desktop, 1 on mobile) — we build BOTH the
           desktop 2-D layout and the mobile 1-column layout ourselves (see
           activeLayout), so the library's own `responsive` reflow is off and
           can never write a 1-column arrangement back into dashboardLayout.v1.
           Desktop: free 2-D drag + resize. Mobile: vertical drag-to-REORDER
           only (resize off — a full-width card has nothing to resize), a
           pinned card excepted (itemDraggable). -->
      <GridLayout
        v-model:layout="activeLayout"
        :col-num="colNum"
        :is-draggable="isDraggable"
        :is-resizable="isResizable"
        :responsive="false"
        :row-height="24"
        :margin="[12, 12]"
        :vertical-compact="true"
        :use-css-transforms="true"
      >
        <template #item="{ item }">
          <!-- IMPORTANT: the `#item` slot renders ONLY the card content —
               grid-layout-plus wraps each layout entry in its OWN internal
               GridItem (it iterates `layout` and provides `item`). Nesting a
               second <GridItem> here double-wraps every card in TWO stacked
               .vgl-item elements, compounding their translate3d transforms so
               cards land at ~2× their slot offset while the (single) library
               placeholder stays at the correct slot — the "placeholder wildly
               offset from the card" bug. Per-item drag config
               (drag-allow-from/-ignore-from + the mobile-pin isDraggable
               exception) is carried on each layout item instead (see
               `activeLayout` getter's decoration), which the library spreads
               onto the GridItem it creates. -->
          <DashboardCard
              v-if="item.i === 'map'"
              :title="t('analyzer.layout.cardMap')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <TrackMap
                fill-height
                :track="track"
                :cursor-idx="cursorIdx"
                :line="lapStore.line"
                :highlight-laps="highlightLaps"
                :focus-range="focusRange"
                :color-values="colorValues"
                :colormap="trackColormap"
                :gates="mapGates"
                :extrema-markers="mapExtremaMarkers"
                @cursor="analyzer.setCursor"
                @update:line="lapStore.setLine($event)"
                @update:gate="onUpdateGate"
              />
              <div v-if="heatNorm" class="tc-legend">
                <span class="tc-end">{{ fmtVal(heatNorm.min) }}</span>
                <span class="tc-bar" :style="{ background: legendGradient }" />
                <span class="tc-end">{{ fmtVal(heatNorm.max) }}</span>
                <span class="tc-name">{{ trackChannel }}</span>
              </div>
              <p class="line-hint">{{ t('analyzer.lineHint') }}</p>
              <div class="laps">
                <span class="lap-count">{{
                  lapStore.excluded.length > 0
                    ? t('analyzer.lapCountExcluded', { n: laps.length, x: lapStore.excluded.length })
                    : t('analyzer.lapCount', { n: laps.length })
                }}</span>
                <button type="button" class="reset" @click="resetLine">
                  {{ t('analyzer.resetLine') }}
                </button>
              </div>
              <div class="band" role="group" :aria-label="t('analyzer.lapBand')">
                <span class="band-label">{{ t('analyzer.lapBand') }}</span>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.1"
                  class="band-input"
                  :value="bandMin ?? ''"
                  :placeholder="t('analyzer.lapBandMin')"
                  :aria-label="t('analyzer.lapBandMin')"
                  @input="onBandInput('min', $event)"
                />
                <span class="band-sep">–</span>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.1"
                  class="band-input"
                  :value="bandMax ?? ''"
                  :placeholder="t('analyzer.lapBandMax')"
                  :aria-label="t('analyzer.lapBandMax')"
                  @input="onBandInput('max', $event)"
                />
                <button
                  v-if="lapStore.lapTimeBand"
                  type="button"
                  class="band-clear"
                  @click="lapStore.clearLapTimeBand()"
                >
                  {{ t('analyzer.lapBandClear') }}
                </button>
                <span v-if="bandExcludedCount > 0" class="band-count">
                  {{ t('analyzer.lapBandExcluded', { x: bandExcludedCount }) }}
                </span>
              </div>
              <div class="band" role="group" :aria-label="t('analyzer.lapDistanceBand')">
                <span class="band-label">{{ t('analyzer.lapDistanceBand') }}</span>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.001"
                  class="band-input"
                  :value="distBandMin ?? ''"
                  :placeholder="t('analyzer.lapDistanceBandMin')"
                  :aria-label="t('analyzer.lapDistanceBandMin')"
                  @input="onDistBandInput('min', $event)"
                />
                <span class="band-sep">–</span>
                <input
                  type="number"
                  inputmode="decimal"
                  min="0"
                  step="0.001"
                  class="band-input"
                  :value="distBandMax ?? ''"
                  :placeholder="t('analyzer.lapDistanceBandMax')"
                  :aria-label="t('analyzer.lapDistanceBandMax')"
                  @input="onDistBandInput('max', $event)"
                />
                <button
                  v-if="lapStore.lapDistanceBand"
                  type="button"
                  class="band-clear"
                  @click="lapStore.clearLapDistanceBand()"
                >
                  {{ t('analyzer.lapDistanceBandClear') }}
                </button>
                <span v-if="distBandExcludedCount > 0" class="band-count">
                  {{ t('analyzer.lapDistanceBandExcluded', { x: distBandExcludedCount }) }}
                </span>
              </div>
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'laptable'"
              :title="t('analyzer.layout.cardLapTable')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <LapTable
                :laps="laps"
                :track="track"
                :time-ms="timeMs"
                :session="session"
                :has-ecu-laps="hasEcuLaps"
                @select="onLapSelect"
              />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'sectors'"
              :title="t('analyzer.layout.cardSectors')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <SectorPanel
                :laps="laps"
                :invalid-count="sectorInvalidCount"
                :track="track"
                :time-ms="timeMs"
                :cursor-idx="cursorIdx"
              />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'trackchannel'"
              :title="t('analyzer.layout.cardTrackChannel')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <TrackChannelPanel
                :options="channelOptions"
                :extrema="trackExtrema"
                :channel-chosen="trackChannelChosen"
              />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'acceltest'"
              :title="t('analyzer.layout.cardAccelTest')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <AccelTestPanel :result="accelResult" :speed-available="speedAvailable" @focus="onAccelFocus" />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'gear'"
              :title="t('analyzer.layout.cardGear')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <GearPanel :session="session" />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'trackfile'"
              :title="t('analyzer.layout.cardTrackFile')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <TrackFilePanel :track="track" />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'sessionmerge'"
              :title="t('analyzer.layout.cardSessionMerge')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <SessionMergePanel />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'mapalign' && showMapAlign"
              :title="t('analyzer.layout.cardMapAlign')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <MapAlignPanel :selected-laps="selectedLaps" />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'lapalign' && showAlign"
              :title="t('analyzer.layout.cardLapAlign')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <LapAlignPanel :selected-laps="selectedLaps" />
            </DashboardCard>

            <template v-else>
              <template v-for="c in charts" :key="c.id">
                <DashboardCard
                  v-if="item.i === chartItemId(c.id)"
                  :title="chartTitle(c)"
                  :collapsed="isCollapsed(item.i)"
                  :pinned="isPinned(item.i)"
                  :show-pin="isMobile"
                  @update:collapsed="toggleCollapsed(item.i)"
                  @update:pinned="togglePinned(item.i)"
                >
                  <TimeSeriesChart
                    v-if="c.kind === 'timeseries' && session && xValues"
                    fill-height
                    :chart="c"
                    :session="session"
                    :x-values="xValues"
                    :x-range="xRange"
                    :external-cursor="cursorIdx"
                    :selected-laps="selectedLaps"
                    @cursor="analyzer.setCursor"
                    @x-zoom="onXZoom"
                  />
                  <ScatterChart
                    v-else-if="c.kind === 'scatter'"
                    fill-height
                    :chart="c"
                    :session="session"
                    :selected-laps="selectedLaps"
                  />
                </DashboardCard>
              </template>
            </template>
        </template>
      </GridLayout>

      <div class="add-menu">
        <button type="button" class="add" @click="onAddTimeseries">
          ＋ {{ t('analyzer.addChart') }}
        </button>
        <button type="button" class="add" @click="onAddScatter">
          ＋ {{ t('analyzer.addScatterChart') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.analyzer {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
}
.empty {
  color: var(--color-text-muted);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
.record {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.record select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.xaxis {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.xaxis button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.xaxis button.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
.layout-tools {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.drag-hint {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.reset-layout {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.reset-layout:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.tc-legend {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: var(--space);
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.tc-bar {
  flex: 0 1 200px;
  height: 10px;
  border-radius: 5px;
  border: 1px solid var(--color-border);
}
.tc-name {
  color: var(--color-text);
}
.line-hint {
  margin: calc(var(--space) * 1.5) 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.laps {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: var(--space);
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.reset {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.reset:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.band {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: var(--space);
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.band-label {
  flex: 0 0 auto;
}
.band-input {
  width: 64px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.band-sep {
  color: var(--color-text-muted);
}
.band-clear {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.band-clear:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.band-count {
  color: var(--color-text-muted);
}
.add-menu {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.add {
  align-self: flex-start;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}
.add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* #8 — snap grid items to position instead of easing the library's default
   200ms `transform: translate3d(…)` transition on `.vgl-item`.

   NOTE: this is NOT what fixed the "placeholder wildly offset from the card"
   bug — that was a DOM-structure bug (a redundant <GridItem> nested inside the
   library's `#item` slot double-wrapped every card, compounding its transform;
   see the `#item` slot note in the template). The real fix removed the inner
   GridItem, so item transforms are now single and correct.

   This rule is kept only for its independent cosmetic benefit: the analyzer
   mounts inside App.vue's <Transition mode="out-in"> view slide, and the grid's
   mount-time width-measure → re-layout can land mid-slide; with the 200ms
   transform ease, freshly-mounted items briefly animate from their pre-measure
   position to their final slot, reading as a small "settle" jitter on tab
   entry. Snapping removes that flicker. Drag/resize were never meant to ease
   anyway. `:deep` because .vgl-item is the library's element, out of scope. */
.analyzer :deep(.vgl-item) {
  transition: none;
}
</style>
