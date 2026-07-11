<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { GridLayout } from 'grid-layout-plus'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore, type ChartMode } from '@/stores/analyzerStore'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLaps } from '@/composables/useLaps'
import { useCircuitPersistence } from '@/composables/useCircuitPersistence'
import { useTrackHeatmap } from '@/composables/useTrackHeatmap'
import { useTrackExtrema } from '@/composables/useTrackExtrema'
import { useTrackOverlay } from '@/composables/useTrackOverlay'
import { useSessionComparison } from '@/composables/useSessionComparison'
import { useDashboardLayout } from '@/composables/useDashboardLayout'
import { usePanelState } from '@/composables/usePanelState'
import { useLayoutLock } from '@/composables/useLayoutLock'
import { useGridGutters } from '@/composables/useGridGutters'
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
  STATIC_CARD_TITLE_KEYS,
  GRID_COLS,
  GRID_ROW_HEIGHT,
  GRID_MARGIN,
  chartItemId,
  mobileLayout,
  minSizeFor,
  isItemDraggable,
  isItemResizable,
  mergeLayoutPositions,
  compactLayoutTopLeft,
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
import SuspensionCard from './SuspensionCard.vue'
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
// Local track-setup persistence (§11 D) + SHARED-library auto-apply
// (docs/CLOUD-TRACK-DESIGN.md §4.2): auto-restores/saves the start/finish
// line, sector gates and lap-table columns per circuit (GPS-keyed), and
// auto-applies a matching public track-library entry when there's no local
// override yet. Registered AFTER useLaps() so its restore (async, via store
// actions) runs after — and overrides — useLaps()'s synchronous default-line
// seeding on file change. The returned refs/actions feed TrackFilePanel's
// §4.3 multi-match picker and §4.4 detach affordance.
const { ambiguousMatches, chooseTrack, dismissAmbiguous, appliedSharedTrack, detachFromSharedTrack } =
  useCircuitPersistence()

const readyFiles = computed(() => fileStore.files.filter((f) => f.status === 'ready'))

// One global comparison selection drives every comparison-aware consumer.
// The existing map overlay and Phase 1 timeline charts now share this list;
// primary-only panels continue to consume `session` from useActiveSession().
const { candidates: comparisonCandidates, comparisonSessions, toggle: toggleComparison, clear: clearComparisons } =
  useSessionComparison()
const { overlayTracks } = useTrackOverlay()
const activeFile = computed(() => readyFiles.value.find((file) => file.id === analyzer.activeFileId) ?? null)
const anyComparisonOn = computed(() => comparisonCandidates.value.some((candidate) => candidate.active))

function comparisonOffset(id: number): number {
  const offset = analyzer.sessionOffsetOf(id)
  return analyzer.xAxis === 'distance' ? offset.distM : offset.timeSec
}

function setComparisonOffset(id: number, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  analyzer.setSessionOffset(id, analyzer.xAxis === 'distance' ? 'distM' : 'timeSec', value)
}

function nudgeComparison(id: number, delta: number): void {
  analyzer.nudgeSessionOffset(id, analyzer.xAxis === 'distance' ? 'distM' : 'timeSec', delta)
}

function resetComparisonOffset(id: number): void {
  analyzer.resetSessionOffset(id, analyzer.xAxis === 'distance' ? 'distM' : 'timeSec')
}

const hasEcuLaps = computed(() => session.value?.has('IR_LapNumber') ?? false)

// The selected laps (from the table) resolved to Lap objects, in selection
// order (so each gets a stable color); missing indices are filtered out.
const selectedLaps = computed(() =>
  lapStore.selected
    .map((i) => laps.value.find((l) => l.index === i))
    .filter((l): l is NonNullable<typeof l> => l != null),
)

// The synchronized ratio trace now lives inside the static GearPanel card,
// so its timeline/overlay mode is transient view state rather than another
// persisted/dynamically removable dashboard chart config.
const gearRatioMode = ref<ChartMode>('timeline')

// The alignment panel only makes sense when laps are being overlaid: at least
// one chart in overlay mode and ≥2 laps selected to compare/align.
const showAlign = computed(
  () =>
    selectedLaps.value.length >= 2 &&
    (gearRatioMode.value === 'overlay' ||
      charts.value.some((c) => c.kind === 'timeseries' && c.mode === 'overlay')),
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

// --- 鎖定布局: a single global toggle disabling drag+resize for every card,
// independent of per-card pin (see usePanelState below) — folded into
// useDashboardLayout so its isDraggable/isResizable already reflect it. ---
const { isLocked, toggleLocked } = useLayoutLock()

// --- #8: draggable/resizable dashboard grid (grid-layout-plus) ---
const chartIds = computed(() => charts.value.map((c) => c.id))
const { layout, colNum, isMobile, isDraggable, isResizable, resetLayout } =
  useDashboardLayout(chartIds, isLocked)

// --- #9: per-card collapse (all breakpoints) + single cross-breakpoint pin
// (釘選 — see DashboardCard's module doc for the Teleport-based redesign) +
// mobile drag-to-reorder order ---
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
// pinned-card non-draggable-non-resizable exception reach that internal
// GridItem.
interface GridItemDecoration {
  dragAllowFrom: string
  dragIgnoreFrom: string
  isDraggable: boolean
  isResizable: boolean
  minW: number
  minH: number
}
// B6 — per-card minimum size (see dashboardLayout.ts's minSizeFor) is carried
// on the layout item the same way drag config is, so grid-layout-plus's OWN
// resize handle refuses to shrink a card past the point a chart/map/table
// stops being usable.
//
// isDraggable/isResizable per item fold in BOTH the grid-wide toggle (isDraggable/
// isResizable from useDashboardLayout, which already account for 鎖定布局 and
// the current breakpoint — mobile resize is now allowed too, see that
// composable's doc) AND the pinned-card exception (isItemDraggable/
// isItemResizable, dashboardLayout.ts): a pinned card's real content has been
// Teleported out of the grid (see the template's pinned-anchor note), so its
// slot is just an empty placeholder that shouldn't be draggable or resizable.
function decorateForGrid(
  items: DashboardLayoutItem[],
): (DashboardLayoutItem & GridItemDecoration)[] {
  return items.map((it) => ({
    ...it,
    dragAllowFrom: '.drag-handle',
    dragIgnoreFrom: '.actions',
    isDraggable: isItemDraggable(isDraggable.value, isPinned(it.i)),
    isResizable: isItemResizable(isResizable.value, isPinned(it.i)),
    ...minSizeFor(it.i),
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
    // preserving hidden items untouched (pure function — only coordinates
    // are copied, decoration fields like dragAllowFrom/minW never leak into
    // the persisted array — see mergeLayoutPositions's doc).
    //
    // Grid-compact fix — this is the ONE code path every desktop coordinate
    // change flows through (native drag/resize end via onLayoutUpdated below,
    // AND a gutter drag's eventual settle — see useGridGutters' onChange doc),
    // so running compactLayoutTopLeft here closes whatever hole moving/
    // resizing a card just left behind, on both axes, right after the
    // gesture ends. Composing two identity-preserving pure functions keeps
    // the whole chain a genuine no-op once positions converge (same
    // invariant #4's crash fix relies on — see mergeLayoutPositions's doc):
    // an already-compacted layout makes compactLayoutTopLeft hand back the
    // exact same array it was given, so a `layout.value` assignment that
    // changed nothing never re-triggers GridLayout's own prop watcher.
    layout.value = compactLayoutTopLeft(mergeLayoutPositions(layout.value, next))
  },
})

// #1 fix — grid-layout-plus's `update:layout` (our v-model, handled by
// activeLayout's setter above) only fires on initial MOUNT and on a
// responsive BREAKPOINT change. A drag or resize ENDING instead fires
// `layout-updated` (confirmed by reading grid-layout-plus's own source:
// dragend/resizeend call `emit("layout-updated", ...)`, never
// `emit("update:layout", ...)`) — so without this listener, a drag/resize's
// new position was rendered by the library's OWN internal state but never
// written back into `layout.value` (and so never persisted to
// localStorage). The very next action that makes `activeLayout`'s getter
// re-run (鎖定布局/釘選/收合/新增圖表/斷點切換all change SOMETHING that
// activeLayout's getter reads) would then re-derive `:layout` from that
// STALE `layout.value`, and grid-layout-plus's own `watch(() => [a.layout,
// ...])` would forcibly reset its internal state back to it — the "layout
// resets itself" bug. Routing this event through the SAME writable
// `activeLayout` computed as the v-model reuses its existing merge/mobile-
// order logic, so there's exactly one code path deciding how a raw
// grid-layout-plus payload gets persisted, regardless of which event fired.
function onLayoutUpdated(next: (DashboardLayoutItem & GridItemDecoration)[]): void {
  activeLayout.value = next
}

// --- #2/#5: draggable gutters between adjacent cards — dragging a gap
// resizes the card whose edge that gap is (the OTHER side reflows, it isn't
// traded against — see gridGutter.ts's module doc for the domain math and
// the #5 revision note) via useGridGutters.ts for the DOM/pointer wiring
// this just calls into. Desktop-only (isMobile has no side-by-side pairs)
// and disabled while the dashboard is locked, same two conditions that
// already gate the grid's own drag/resize (isDraggable/isResizable in
// useDashboardLayout). The currently-pinned card is excluded from
// `gutterItems` — its grid slot is an inert Teleport placeholder (see the
// template's pin-placeholder note), so a gutter touching it would visibly do
// nothing.
const gutterItems = computed<DashboardLayoutItem[]>(() =>
  desktopVisibleLayout.value.filter((it) => !isPinned(it.i)),
)
const gutterEnabled = computed(() => !isMobile.value && !isLocked.value)
const gridGutters = useGridGutters({
  items: gutterItems,
  enabled: gutterEnabled,
  cols: GRID_COLS,
  rowHeight: GRID_ROW_HEIGHT,
  marginX: GRID_MARGIN[0],
  marginY: GRID_MARGIN[1],
  // Same persistence path as onLayoutUpdated above (#1's fix) — a gutter drag
  // is just another source of new coordinates for the ONE resized card,
  // merged back into the full layout the identical way a corner-resize's
  // `layout-updated` is. Everything ELSE that needs to reflow around it
  // (#5) arrives here too, but via a SEPARATE round trip: this writes
  // `layout.value`, which flows out through `activeLayout` to
  // `<GridLayout>`'s `layout` prop, whose own vertical-compaction reacts and
  // re-emits `layout-updated` with the reflowed positions, which
  // `onLayoutUpdated` merges back in — see gridGutter.ts's module doc for
  // why this round trip is safe (doesn't loop) rather than a hand-rolled
  // reflow living here.
  onChange: (next) => {
    layout.value = mergeLayoutPositions(layout.value, next)
  },
})
const gutters = gridGutters.gutters
const draggingKey = gridGutters.draggingKey
const onGutterPointerDown = gridGutters.onGutterPointerDown
// A plain local template ref, forwarded into the composable's own
// containerRef via watch — kept as a separate binding (rather than the
// template pointing `ref="..."` straight at `gridGutters.containerRef`)
// because a template ref attribute must name a binding vue-tsc can see
// genuinely READ somewhere in this component's own <script>; the watch
// below is that read.
const gridWrapRef = ref<HTMLElement | null>(null)
watch(gridWrapRef, (el) => {
  gridGutters.containerRef.value = el
})

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
  if (chart.kind === 'scatter') return t('analyzer.layout.cardScatterChart', { n })
  return t('analyzer.layout.cardChart', { n })
}

/** Title for ANY card id (static or chart), used by the pinned-card
 *  placeholder (see template) which renders OUTSIDE the big per-card
 *  v-if/else-if chain and so can't just read whichever branch's own `title`
 *  prop happened to fire. Static ids look up their i18n key in
 *  STATIC_CARD_TITLE_KEYS; a chart id falls back to the same numbered
 *  chartTitle() the card itself uses. */
function titleForItemId(id: string): string {
  const key = STATIC_CARD_TITLE_KEYS[id]
  if (key) return t(key)
  const chart = charts.value.find((c) => chartItemId(c.id) === id)
  return chart ? chartTitle(chart) : ''
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
        <details v-if="comparisonCandidates.length > 0" class="comparison-panel">
          <summary>{{ t('analyzer.comparisonTitle') }}</summary>
          <p class="comparison-hint">{{ t('analyzer.comparisonHint') }}</p>
          <div v-for="candidate in comparisonCandidates" :key="candidate.id" class="comparison-row">
            <label class="comparison-select">
              <input
                type="checkbox"
                :checked="candidate.active"
                @change="toggleComparison(candidate.id)"
              />
              <span class="comparison-swatch" :style="{ background: candidate.color }" />
              <span class="comparison-name" :title="candidate.name">{{ candidate.name }}</span>
            </label>
            <div v-if="candidate.active" class="comparison-offset">
              <button type="button" @click="nudgeComparison(candidate.id, xAxis === 'time' ? -0.1 : -1)">−</button>
              <input
                type="number"
                :step="xAxis === 'time' ? 0.1 : 1"
                :value="comparisonOffset(candidate.id)"
                :aria-label="t('analyzer.comparisonOffset')"
                @change="setComparisonOffset(candidate.id, $event)"
              />
              <span>{{ xAxis === 'time' ? 's' : 'm' }}</span>
              <button type="button" @click="nudgeComparison(candidate.id, xAxis === 'time' ? 0.1 : 1)">＋</button>
              <button type="button" class="comparison-reset" @click="resetComparisonOffset(candidate.id)">
                {{ t('analyzer.comparisonReset') }}
              </button>
            </div>
          </div>
          <button v-if="anyComparisonOn" type="button" class="comparison-clear" @click="clearComparisons">
            {{ t('analyzer.comparisonClear') }}
          </button>
        </details>
        <!-- T4 — the add-chart buttons live HERE, grouped with the reset-layout
             button, so every dashboard-level layout action (add cards / reset
             arrangement) sits in one toolbar cluster instead of the add
             buttons floating below the grid. -->
        <div class="layout-tools">
          <span class="drag-hint">{{ isMobile ? t('analyzer.layout.dragHintMobile') : t('analyzer.layout.dragHint') }}</span>
          <button type="button" class="add" @click="onAddTimeseries">
            ＋ {{ t('analyzer.addChart') }}
          </button>
          <button type="button" class="add" @click="onAddScatter">
            ＋ {{ t('analyzer.addScatterChart') }}
          </button>
          <!-- 鎖定布局: global drag+resize toggle for every card — distinct
               icon (padlock) and wording from the per-card 📌 pin button so
               the two features never read as "the same thing". -->
          <button
            type="button"
            class="lock-layout"
            :class="{ active: isLocked }"
            :title="isLocked ? t('analyzer.layout.unlockLayoutHint') : t('analyzer.layout.lockLayoutHint')"
            :aria-label="isLocked ? t('analyzer.layout.unlockLayout') : t('analyzer.layout.lockLayout')"
            :aria-pressed="isLocked"
            @click="toggleLocked"
          >
            <svg v-if="isLocked" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 7.65-1.65" />
            </svg>
            <span>{{ isLocked ? t('analyzer.layout.unlockLayout') : t('analyzer.layout.lockLayout') }}</span>
          </button>
          <button type="button" class="reset-layout" @click="onResetLayout">
            {{ t('analyzer.layout.resetLayout') }}
          </button>
        </div>
      </div>

      <!-- 釘選 (pin) anchor: a single sticky slot that a pinned card's markup
           is Teleported into (see the #item slot below and DashboardCard's
           module doc). Placed here — right after the toolbar, before the
           grid — so at scroll position 0 it just sits inline (no visual
           jump), then sticks to the viewport top once the page scrolls past
           it, exactly like the card's own former mobile-only sticky trick,
           generalised to work regardless of the grid's absolute-positioned
           desktop items. `:empty` hides it when nothing is pinned so it never
           reserves space or shows a stray border. Works identically at both
           breakpoints — this IS the mobile pin mechanism now, not a
           duplicate of it (see DashboardCard's module doc for the
           consolidation rationale). -->
      <div id="dashboard-pinned-anchor" class="pinned-anchor" />

      <!-- #8/#9: draggable dashboard grid (grid-layout-plus). Drag is restricted
           to each card's own `.drag-handle` header (DashboardCard's title bar)
           via `dragAllowFrom`, and the header's own buttons (pin/collapse, in
           `.actions`) are excluded via `dragIgnoreFrom` so tapping them toggles
           state instead of starting a drag. `colNum` is driven explicitly by
           breakpoint (GRID_COLS on desktop, 1 on mobile) — we build BOTH the
           desktop 2-D layout and the mobile 1-column layout ourselves (see
           activeLayout), so the library's own `responsive` reflow is off and
           can never write a 1-column arrangement back into dashboardLayout.v1.
           Desktop: free 2-D drag + resize. Mobile: vertical drag-to-REORDER +
           resize (height only — a full-width card can't usefully resize its
           width). A pinned card's own slot is always non-draggable/
           non-resizable regardless of breakpoint (decorateForGrid). -->
      <!-- #2 縫隙拖動: gridWrapRef is the positioning context (`position:
           relative`) the gutter overlay's absolutely-positioned hit-boxes
           are placed relative to — it must wrap `<GridLayout>` exactly (no
           extra padding/border) so its measured width matches the library's
           own colWidth math (see useGridGutters.ts's `containerRef` doc). -->
      <div ref="gridWrapRef" class="grid-wrap">
      <GridLayout
        v-model:layout="activeLayout"
        :col-num="colNum"
        :is-draggable="isDraggable"
        :is-resizable="isResizable"
        :responsive="false"
        :row-height="GRID_ROW_HEIGHT"
        :margin="GRID_MARGIN"
        :vertical-compact="true"
        :use-css-transforms="true"
        @layout-updated="onLayoutUpdated"
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
               (drag-allow-from/-ignore-from + the pinned non-draggable/
               non-resizable exception) is carried on each layout item instead
               (see `activeLayout` getter's decoration), which the library
               spreads onto the GridItem it creates. -->

          <!-- 釘選 placeholder: when THIS item is the pinned one, its real
               DashboardCard below is Teleported out into #dashboard-pinned-
               anchor (see that div's doc, above the grid) — this placeholder
               fills the vacated grid slot so the layout doesn't jump, and
               tells the user where the card went. Unpinning removes the
               Teleport's `disabled` override and the card simply re-renders
               here on the next tick. -->
          <div v-if="isPinned(String(item.i))" class="pin-placeholder">
            <span class="pin-placeholder-icon" aria-hidden="true">📌</span>
            <span class="pin-placeholder-title">{{ titleForItemId(String(item.i)) }}</span>
            <span class="pin-placeholder-text">{{ t('analyzer.layout.pinnedPlaceholder') }}</span>
          </div>

          <Teleport to="#dashboard-pinned-anchor" :disabled="!isPinned(String(item.i))" defer>
          <DashboardCard
              v-if="item.i === 'map'"
              :title="t('analyzer.layout.cardMap')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :aspect-ratio="item.w / item.h"
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
                :overlay-tracks="overlayTracks"
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
              :aspect-ratio="item.w / item.h"
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
              :aspect-ratio="item.w / item.h"
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
              :aspect-ratio="item.w / item.h"
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
              :aspect-ratio="item.w / item.h"
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
              :aspect-ratio="item.w / item.h"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <GearPanel
                :session="session"
                :x-values="xValues"
                :x-range="xRange"
                :external-cursor="cursorIdx"
                :selected-laps="selectedLaps"
                :gear-ratio-mode="gearRatioMode"
                @cursor="analyzer.setCursor"
                @x-zoom="onXZoom"
                @update-gear-ratio-mode="gearRatioMode = $event"
              />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'trackfile'"
              :title="t('analyzer.layout.cardTrackFile')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :aspect-ratio="item.w / item.h"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <TrackFilePanel
                :track="track"
                :ambiguous-matches="ambiguousMatches"
                :applied-shared-track="appliedSharedTrack"
                @choose-track="chooseTrack"
                @dismiss-ambiguous="dismissAmbiguous"
                @detach="detachFromSharedTrack"
              />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'sessionmerge'"
              :title="t('analyzer.layout.cardSessionMerge')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :aspect-ratio="item.w / item.h"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <SessionMergePanel />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'suspension'"
              :title="t('analyzer.layout.cardSuspension')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :aspect-ratio="item.w / item.h"
              :show-pin="isMobile"
              @update:collapsed="toggleCollapsed(item.i)"
              @update:pinned="togglePinned(item.i)"
            >
              <SuspensionCard :session="session" />
            </DashboardCard>

            <DashboardCard
              v-else-if="item.i === 'mapalign' && showMapAlign"
              :title="t('analyzer.layout.cardMapAlign')"
              :collapsed="isCollapsed(item.i)"
              :pinned="isPinned(item.i)"
              :aspect-ratio="item.w / item.h"
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
              :aspect-ratio="item.w / item.h"
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
                  :aspect-ratio="item.w / item.h"
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
                    :comparison-sessions="comparisonSessions"
                    :primary-file-id="activeFile?.id"
                    :primary-file-name="activeFile?.name"
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
          </Teleport>
        </template>
      </GridLayout>
      <!-- #2 縫隙拖動 overlay: one thin hit-box per shared card edge, drawn
           exactly over the margin gap between two adjacent cards (see
           gridGutter.ts's `gutterRect`) — never over any card's own content,
           so it can't intercept clicks meant for the dashboard. Empty
           (nothing rendered) on mobile / while locked / while nothing is
           adjacent — see useGridGutters's `enabled` gate. -->
      <div
        v-for="g in gutters"
        :key="g.key"
        class="grid-gutter"
        :class="[g.orientation, { dragging: draggingKey === g.key }]"
        :style="{ left: `${g.rect.left}px`, top: `${g.rect.top}px`, width: `${g.rect.width}px`, height: `${g.rect.height}px` }"
        @pointerdown="onGutterPointerDown(g, $event)"
      />
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
  /* T4 — now holds add-chart + reset-layout; allow wrapping on narrow
     viewports instead of overflowing the toolbar row. */
  flex-wrap: wrap;
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
/* 鎖定布局 — deliberately styled like reset-layout (same neutral pill) rather
   than DashboardCard's small icon-only pin button: this is a toolbar-level,
   text+icon action, not a per-card header affordance, so it should read as
   "a different kind of control" even before the padlock-vs-pushpin icon
   registers. `.active` (locked) gets the accent treatment other toggled
   states in this file use (e.g. .xaxis button.active) for a consistent
   "this is currently on" language. */
.lock-layout {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.lock-layout svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
.lock-layout:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.lock-layout.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-color: var(--color-accent);
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
/* One global comparison picker/legend shared by every comparison-aware card. */
.comparison-panel {
  min-width: min(360px, 100%);
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.82rem;
}
.comparison-panel summary {
  cursor: pointer;
  color: var(--color-text);
  font-weight: 600;
}
.comparison-hint {
  margin: 8px 0;
  color: var(--color-text-muted);
  line-height: 1.4;
}
.comparison-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 5px 0;
}
.comparison-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--color-text);
  max-width: 100%;
}
.comparison-select input {
  accent-color: var(--color-accent);
  margin: 0;
}
.comparison-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 0 1px var(--color-surface);
}
.comparison-name {
  max-width: 16em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.comparison-offset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--color-text-muted);
}
.comparison-offset input {
  width: 72px;
  padding: 3px 5px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
}
.comparison-offset button,
.comparison-clear {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 3px 8px;
  font: inherit;
  cursor: pointer;
}
.comparison-offset button:hover,
.comparison-clear:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.comparison-reset {
  margin-left: 3px;
}
.comparison-clear {
  margin-top: 6px;
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
/* T4 — add-chart buttons live in the toolbar's .layout-tools cluster next to
   reset-layout; sized to match its neighbours (the dashed border keeps their
   established "add" affordance). */
.add {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* #2 縫隙拖動 — the positioning context the gutter overlay's absolutely-
   positioned hit-boxes are placed relative to (see the template's doc on
   gridWrapRef). Must wrap `<GridLayout>` with zero extra box (no padding/
   border) so ITS measured width is exactly what grid-layout-plus itself
   lays cards out against. */
.grid-wrap {
  position: relative;
}
/* One draggable hit-box per shared card edge, sized/positioned to exactly
   fill the margin gap between two touching cards (gridGutter.ts's
   `gutterRect`) — invisible by default (a visible line there all the time
   would read as a stray grid rule), with a themed highlight only on
   hover/active so the affordance discovers itself without adding permanent
   visual noise to the dashboard.

   #2 fix — `border-radius` now matches DashboardCard's own corner rounding
   (`calc(var(--radius) * 1.5)`, see DashboardCard.vue's `.dashboard-card`)
   instead of a near-square 2px, so the highlight reads as "part of the same
   rounded-card visual language" rather than a stray right-angle box; on the
   gutter's own thin strip this naturally rounds into a soft pill shape.
   The highlight itself uses `color-mix(..., transparent)` — the same
   translucent-accent pattern already used elsewhere in this app (see
   FileBar.vue/GearPanel.vue/VboChannelMap.vue) — instead of a flat
   `background: var(--color-accent); opacity: 0.45`, which read as a harsh,
   overly-saturated "pink block" (the opacity also dims anything else drawn
   on the element, not just the fill). color-mix blends the accent directly
   into a transparent layer over the page, landing as a much softer tint. */
.grid-gutter {
  position: absolute;
  z-index: 25;
  touch-action: none;
  background: transparent;
  border-radius: calc(var(--radius) * 1.5);
  transition: background-color 0.1s ease;
}
.grid-gutter.vertical {
  cursor: col-resize;
}
.grid-gutter.horizontal {
  cursor: row-resize;
}
.grid-gutter:hover,
.grid-gutter.dragging {
  background: color-mix(in srgb, var(--color-accent) 30%, transparent);
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

/* 釘選 (pin) anchor + placeholder — see the template's doc comments above the
   anchor div and the #item slot's Teleport for the full mechanism. */
.pinned-anchor {
  position: sticky;
  top: 0;
  z-index: 30;
}
.pinned-anchor:empty {
  display: none;
}
/* Bound the Teleported card so a tall body (e.g. an overlay chart) can't grow
   to dominate the screen once it's floating above the grid — matches
   DashboardCard's own `.pinned` max-height so the two agree on how big a
   pinned card is allowed to get. `width: min(560px, 100%)` is a DESKTOP-only
   choice (a floating centered card looks intentional on a wide screen); on
   mobile (#9 fix) the 560px cap left dead space on either side of the card
   on any viewport wider than 560px — including exactly 768px, the phone
   breakpoint itself — so the mobile media query below overrides back to a
   full-width card, matching every other card's edge-to-edge mobile layout. */
.pinned-anchor :deep(.dashboard-card) {
  width: min(560px, 100%);
  margin: 0 auto calc(var(--space) * 1.5);
}
@media (max-width: 768px) {
  .pinned-anchor :deep(.dashboard-card) {
    width: 100%;
  }
}
.pin-placeholder {
  height: 100%;
  min-height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: var(--space);
  border: 1px dashed var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  background: var(--color-bg);
  color: var(--color-text-muted);
  text-align: center;
}
.pin-placeholder-icon {
  font-size: 1.1rem;
  line-height: 1;
}
.pin-placeholder-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text);
}
.pin-placeholder-text {
  font-size: 0.75rem;
}

/* #3 — theme the resize handle (grid-layout-plus's `.vgl-item__resizer`,
   bottom-right corner of every card). The library draws it as a plain
   right-angle "⌐" made of two straight border edges (`border-right-width` +
   `border-bottom-width` on its `:before`, see grid-layout-plus's built-in
   CSS) in a hardcoded dark grey (`--vgl-resizer-border-color: #444`) — this
   reads as an abrupt, unstyled corner against the rest of the app's rounded,
   theme-colored chrome (same mismatch the tooltip directive fixed for the
   native `title` box). Recolor to the theme accent and round the corner
   where the two border edges meet (`border-radius` on the bottom-right,
   matching the card's own `--radius`) so it reads as a deliberate grab
   affordance rather than a stray box corner. */
.analyzer :deep(.vgl-layout) {
  --vgl-resizer-border-color: var(--color-accent);
  --vgl-resizer-border-width: 2px;
}
.analyzer :deep(.vgl-item__resizer)::before {
  border-radius: 0 0 var(--radius) 0;
}

/* Touch resize (mobile task): the resize handle is grid-layout-plus's own
   `.vgl-item__resizer` (bottom-right corner), sized via its `--vgl-resizer-
   size` CSS var (10px default — comfortable with a mouse, far too small a
   touch target on a phone). Mobile resize is now enabled (see
   useDashboardLayout's isResizable), so the handle needs to actually be
   tappable there; `touch-action: none` stops the browser's own scroll
   gesture from hijacking the drag before interactjs sees it (grid-layout-plus
   only sets this at the ITEM level for Android — see grid-item.vue's
   `no-touch` class — not on the resizer itself, and not for iOS at all). */
@media (max-width: 768px) {
  .analyzer :deep(.vgl-layout) {
    --vgl-resizer-size: 30px;
  }
  .analyzer :deep(.vgl-item__resizer) {
    touch-action: none;
  }
}
</style>
