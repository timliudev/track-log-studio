<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useActiveSession } from '@/composables/useActiveSession'
import { useLaps } from '@/composables/useLaps'
import { useCircuitPersistence } from '@/composables/useCircuitPersistence'
import { useSectorAutoPopulate } from '@/composables/useSectorAutoPopulate'
import { useTrackHeatmap } from '@/composables/useTrackHeatmap'
import { useTrackExtrema } from '@/composables/useTrackExtrema'
import { useTrackOverlay } from '@/composables/useTrackOverlay'
import { useSessionComparison } from '@/composables/useSessionComparison'
import { useDashboardLayout } from '@/composables/useDashboardLayout'
import { usePanelState } from '@/composables/usePanelState'
import { useLayoutLock } from '@/composables/useLayoutLock'
import { useGridGutters } from '@/composables/useGridGutters'
import { useCssGridDashboardDrag } from '@/composables/useCssGridDashboardDrag'
import { useCssGridDashboardResize } from '@/composables/useCssGridDashboardResize'
import { useCardVisibility } from '@/composables/useCardVisibility'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { useSuspensionStore } from '@/stores/suspensionStore'
import { PARTS } from '@/domain/units/suspension'
import { isFlagEnabled } from '@/config/featureFlags'
import { CARD_GROUPS, STATIC_CARD_GROUP } from '@/domain/layout/cardGroups'
import type { CardDataContext } from '@/domain/layout/cardDataAvailability'
import type { LapLine } from '@/domain/analysis/laps'
import { lapColor } from './lapColors'
import { xRangeToFocusIndices } from '@/domain/analysis/focusRange'
import { resolveSpeedChannel } from '@/domain/analysis/cornerSpeed'
import { fastestDistanceFromLaunch, fastestSpeedSegment, type AccelSegment } from '@/domain/analysis/accelTest'
import { cumulativeDistanceM } from '@/domain/analysis/distance'
import { buildComparisonLapHighlights } from '@/domain/analysis/crossSessionLapHighlight'
import { buildComparisonExtremaMarkers } from '@/domain/analysis/crossSessionExtrema'
import {
  STATIC_CARD_IDS,
  STATIC_CARD_TITLE_KEYS,
  GRID_COLS,
  GRID_ROW_HEIGHT,
  GRID_MARGIN,
  chartItemId,
  mobileLayout,
  mergeLayoutPositions,
  compactLayoutTopLeft,
  compactVertical,
  resolveOverlaps,
  applyCollapsedHeights,
  sameLayoutPositions,
  packExcluding,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'
import { mergeMobileOrder } from '@/domain/layout/panelState'
import DashboardCard from '@/components/DashboardCard.vue'
import CardMenu from './CardMenu.vue'
import AnalyzerCardBody from './AnalyzerCardBody.vue'
import CssGridGrid from './CssGridGrid.vue'
import type { AnalyzerCardContext } from './analyzerCardContext'

const { t } = useI18n()
const fileStore = useFileStore()
const analyzer = useAnalyzerStore()
const lapStore = useLapStore()
const sectorStore = useSectorStore()
const drivetrainStore = useDrivetrainStore()
const suspensionStore = useSuspensionStore()
const {
  charts,
  xAxis,
  xRange,
  cursorIdx,
  cursorFrac,
  mapMaximized,
  trackChannel,
  trackColormap,
  trackColorEnabled,
  markMinima,
  markMaxima,
} = storeToRefs(analyzer)
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
const {
  ambiguousMatches,
  chooseTrack,
  dismissAmbiguous,
  appliedSharedTrack,
  detachFromSharedTrack,
  circuitGeometryOrigin,
  circuitRestoreEpoch,
} = useCircuitPersistence()
// B75: persistence/library geometry settles first; only a genuinely fresh
// circuit receives one automatic sector-detection fallback. Root ownership
// keeps card collapse/remount state out of this data lifecycle.
useSectorAutoPopulate(laps, circuitGeometryOrigin, circuitRestoreEpoch)

const readyFiles = computed(() => fileStore.files.filter((f) => f.status === 'ready'))

// One global comparison selection drives every comparison-aware consumer.
// The existing map overlay and Phase 1 timeline charts now share this list;
// primary-only panels continue to consume `session` from useActiveSession().
const { comparisonSessions } = useSessionComparison()
const { overlayTracks } = useTrackOverlay()
const activeFile = computed(() => readyFiles.value.find((file) => file.id === analyzer.activeFileId) ?? null)

function setComparisonMapOffset(id: number, axis: 'mapX' | 'mapY', event: Event): void {
  analyzer.setSessionOffset(id, axis, Number((event.target as HTMLInputElement).value))
}

const hasEcuLaps = computed(() => session.value?.has('IR_LapNumber') ?? false)

// The selected laps (from the table) resolved to Lap objects, in selection
// order (so each gets a stable color); missing indices are filtered out.
const selectedLaps = computed(() =>
  lapStore.selected
    .map((i) => laps.value.find((l) => l.index === i))
    .filter((l): l is NonNullable<typeof l> => l != null),
)

// B8 — every time-series chart (the dashboard ones AND the gear-ratio chart
// embedded in the static GearPanel card) now renders as an overlay whenever
// laps are selected — there's no separate mode to gate on any more, so the
// alignment panel's only real condition is "≥2 laps selected to compare".
const showAlign = computed(() => selectedLaps.value.length >= 2)

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

// Cross-file lap selections (picked from a COMPARISON recording's own per-lap
// table — see SessionLapComparison.vue's `toggleSessionLap`), resolved to
// drawable track-map segments on THEIR OWN session's track. This is the
// track-map counterpart of `highlightLaps` above: same "one bright segment
// per selected lap" idea, but each entry carries its own track (and that
// session's map offset, COMBINED with the lap's own per-lap map offset —
// see crossSessionLapHighlight.ts) instead of indexing into the primary
// `track`. The mapping itself is a pure function (crossSessionLapHighlight.ts,
// unit-tested) so this computed is just the store/composable-shaped adapter.
const comparisonLapHighlights = computed(() =>
  buildComparisonLapHighlights(
    lapStore.selectedAcrossSessions.map((ref) => ({
      ...ref,
      mapOffset: lapStore.sessionLapMapOffsetOf(ref.fileId, ref.index),
    })),
    comparisonSessions.value.map((cs) => ({
      id: cs.id,
      color: cs.color,
      track: cs.track,
      laps: cs.laps,
      offset: { x: analyzer.sessionOffsetOf(cs.id).mapX, y: analyzer.sessionOffsetOf(cs.id).mapY },
    })),
  ),
)

// The per-lap map-align panel's rows for COMPARISON laps (#9): every
// cross-file lap selection that still resolves to a real lap on a CURRENT
// comparison source, adapted to what MapAlignPanel needs to render + label a
// row (file label + that session's identity color) — a stale ref (session no
// longer compared, or its laps re-detected out from under the index) is
// dropped, same rule `buildComparisonLapHighlights` applies for the map itself.
const comparisonAlignLaps = computed(() => {
  const out: { fileId: number; index: number; label: string; color: string }[] = []
  for (const ref of lapStore.selectedAcrossSessions) {
    const cs = comparisonSessions.value.find((s) => s.id === ref.fileId)
    if (!cs) continue
    if (!cs.laps.some((l) => l.index === ref.index)) continue
    out.push({ fileId: ref.fileId, index: ref.index, label: cs.name, color: cs.color })
  }
  return out
})

// The map-alignment panel applies to whatever laps are drawn on the map, so it
// shows whenever ≥2 laps are selected in total across BOTH the primary table
// and comparison tables — e.g. 1 primary + 1 comparison lap is just as much a
// two-line map to align as 2 primary laps.
const showMapAlign = computed(() => selectedLaps.value.length + comparisonAlignLaps.value.length >= 2)

// #7: derive the track map's chart-zoom-follow focus from the shared xRange.
// xRange is written ONLY by charts with NO lap selected (B8 — overlay charts
// with a selection live in a lap-relative grid and structurally never call
// setXRange — see TimeSeriesChart.vue's onXZoom), so no separate mode flag is
// needed here; xRangeToFocusIndices also treats a (near-)whole-session range as "no focus"
// so the map isn't emphasizing everything. DERIVED, not stored — no
// state-writing watcher.
//
// Precedence: an explicit LAP SELECTION (highlightLaps OR comparisonLapHighlights
// non-empty) always wins over chart-range focus — selecting laps is a
// deliberate, higher-intent choice than an in-progress chart zoom, and the two
// would otherwise fight over the map's single "emphasized segment" visual.
// Chart-range focus only applies when nothing is selected (same-file or
// cross-file).
const focusRange = computed(() =>
  highlightLaps.value.length > 0 || comparisonLapHighlights.value.length > 0
    ? null
    : xRangeToFocusIndices(xRange.value, xValues.value),
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

// B33: track-channel min/max markers for a lap selected on a COMPARISON file
// (not just the primary — `focusedLap`/`mapExtremaMarkers` above only ever
// look at the primary session's own `lapStore.selected`, so a comparison
// file's lap selection never lit up markers at all). Same "resolve a
// cross-file lap selection to something drawable on that file's own track"
// shape as `comparisonLapHighlights` below, but for extrema markers — see
// `buildComparisonExtremaMarkers`'s doc for the per-file single-lap rule.
const comparisonExtremaMarkers = computed(() =>
  buildComparisonExtremaMarkers(
    lapStore.selectedAcrossSessions,
    comparisonSessions.value.map((cs) => ({
      fileId: cs.id,
      track: cs.track,
      channelData: trackChannel.value ? (cs.session.get(trackChannel.value)?.data ?? null) : null,
      laps: cs.laps,
    })),
    markMinima.value,
    markMaxima.value,
  ),
)

// Merged marker set actually drawn on the map: the primary session's own
// (lap-scoped or whole-track-fallback) markers plus every qualifying
// comparison file's own lap-scoped markers, side by side.
const allExtremaMarkers = computed(() => [...mapExtremaMarkers.value, ...comparisonExtremaMarkers.value])

// --- Acceleration/drag test (Phase 7, 加速測試): whole-SESSION search, not
// a per-lap metric — see accelTest.ts's module doc for why. Speed channel
// resolution reuses the same speedChannelName as corner-speed above. Distance
// is always needed (both search kinds interpolate/report distanceM), so this
// is unavailable without a GPS track even for the speed-threshold condition.
//
// B14: this is now every qualifying segment found in the session (e.g. every
// launch through a set of traffic lights), not just the single fastest one —
// accelTest.ts's search functions return an array with one element flagged
// `isFastest` for the UI to highlight.
const accelResults = computed<AccelSegment[]>(() => {
  const chName = speedChannelName.value
  const s = session.value
  const tk = track.value
  const tMs = timeMs.value
  if (!chName || !s || !tk || !tMs) return []
  const ch = s.get(chName)
  if (!ch) return []
  const cumDist = cumulativeDistanceM(tk.lat, tk.lon, tk.valid)
  const cond = analyzer.accelCondition
  if (cond.kind === 'distance') {
    if (!(cond.distanceM > 0)) return []
    return fastestDistanceFromLaunch(cumDist, tMs, ch.data, {
      distanceM: cond.distanceM,
      entrySpeedKmh: cond.entrySpeedKmh,
    })
  }
  return fastestSpeedSegment(tMs, ch.data, cumDist, { fromKmh: cond.fromKmh, toKmh: cond.toKmh })
})

// Focus a found segment: zoom the shared xRange to its span (same
// select->zoom coupling as onLapSelect) and clear any lap selection so the
// zoomed range isn't immediately overridden by the lap-selection focus
// precedence in `focusRange` above.
function onAccelFocus(segment: AccelSegment): void {
  const xs = xValues.value
  if (!xs || segment.startIdx >= xs.length || segment.endIdx >= xs.length) return
  lapStore.clearSelection()
  analyzer.setXRange({ min: xs[segment.startIdx], max: xs[segment.endIdx] })
}

// B26: cancel an accel-test focus (re-click the focused segment, or the
// panel's own "clear focus" button) — just drop back to the full-view zoom,
// mirroring onLapSelect's explicit-clear branch below.
function onAccelClear(): void {
  analyzer.setXRange(null)
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
    lapStore.clearAllLapSelections()
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
    const readyIds = new Set(files.map((file) => file.id))
    const comparisons = analyzer.selectedSessions.filter(
      (id) => readyIds.has(id) && id !== analyzer.activeFileId,
    )
    const activeExists = analyzer.activeFileId != null && readyIds.has(analyzer.activeFileId)
    if (!activeExists) {
      const nextPrimary = comparisons[0] ?? files[0]?.id ?? null
      // B55 — the outgoing primary's file is GONE (removed/failed), so
      // there's nothing to fold it back into; but if a comparison recording
      // is being promoted in its place, that recording's own per-lap state
      // should become the new primary-facet state, same as an explicit
      // FileBar makePrimary swap (see lapStore.swapPrimarySession).
      if (nextPrimary != null) lapStore.swapPrimarySession(null, nextPrimary)
      analyzer.activeFileId = nextPrimary
      analyzer.selectedSessions = comparisons.filter((id) => id !== nextPrimary)
    } else if (comparisons.length !== analyzer.selectedSessions.length) {
      analyzer.selectedSessions = comparisons
    }
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

// Raw sector failures remain visible even when B67's all-failed safety policy
// deliberately suppresses effective exclusions. This gives gate edits an
// immediate, truthful result without removing every lap from the analysis.
const sectorFailureCount = computed(() => lapStore.sectorFailureCount)
const sectorAllFailed = computed(() => lapStore.sectorAllFailed)

// --- 鎖定布局: a single global toggle disabling drag+resize for every card,
// independent of per-card pin (see usePanelState below) — folded into
// useDashboardLayout so its isDraggable/isResizable already reflect it. ---
const { isLocked, toggleLocked } = useLayoutLock()

// --- #8: draggable/resizable dashboard grid (CSS Grid — CssGridGrid.vue) ---
const chartIds = computed(() => charts.value.map((c) => c.id))
const { layout, colNum, isMobile, isDraggable, isResizable, gridMargin, resetLayout } =
  useDashboardLayout(chartIds, isLocked)

// --- #9: per-card collapse (all breakpoints) + cross-breakpoint pin (釘選 — a
// pinned card stays in its own grid slot and becomes `position: sticky`, see
// CssGridGrid's module doc) + mobile drag-to-reorder order. B111 — pin is a
// STACK (`pinnedIds`, pin order preserved), not a single card; CssGridGrid's
// own `pinOrderFor`/`pinStackStyle` derive each pinned card's stagger/z-index
// directly from this array's order. ---
const { state: panelState, isCollapsed, isPinned, pinnedIds, toggleCollapsed, togglePinned, mobileOrder, setMobileOrder } =
  usePanelState(chartIds)

// The set of currently-collapsed card ids, fed into the collapse-reflow overlay
// (applyCollapsedHeights) so a collapsed card shrinks its grid slot and its
// neighbours pack up into the reclaimed rows (補位). Canonical (expanded)
// heights stay in `layout` untouched — expanding just drops the id from here.
const collapsedIds = computed(() => new Set(panelState.value.collapsed))

// F2 — cheap, already-computed "does this card have data worth showing"
// signals, folded into one snapshot for cardDataAvailability.ts's
// cardHasData (see useCardVisibility below). Suspension: mirrors
// SuspensionCard.vue's own channelPresent check (an enabled part whose
// source channel actually exists in this session).
const hasSuspensionChannel = computed(() =>
  PARTS.some((part) => {
    const cfg = suspensionStore.config[part]
    return cfg.enabled && !!cfg.sourceChannel && (session.value?.has(cfg.sourceChannel) ?? false)
  }),
)
const cardDataContext = computed<CardDataContext>(() => ({
  hasSectorGates: sectorStore.gates.length > 0,
  hasAccelSegment: accelResults.value.length > 0,
  hasSuspensionChannel: hasSuspensionChannel.value,
  drivetrainKind: drivetrainStore.kind,
}))

// F2 — per-card visibility DEVICE preference (tracklogstudio.cardVisibility.v1),
// replacing B98's hard "always false" for the CVT card with a real show/hide
// store the card menu (CardMenu.vue) writes to. See useCardVisibility.ts.
const cardVisibility = useCardVisibility(chartIds, cardDataContext)

// The align panels (mapalign/lapalign) only render when their "≥2 laps
// selected" condition holds (showMapAlign/showAlign, unchanged rules from
// before the grid) — an empty GridItem for a hidden card would otherwise
// leave a draggable blank box on the dashboard. `isVisibleId` is the single
// visibility predicate shared by both the desktop and mobile layout builders.
//
// F2 — B98's hard `if (id === STATIC_CARD_IDS.cvtDynamics) return false` is
// now the cvtDynamics FEATURE FLAG (featureFlags.ts): completely absent
// until a tester enables it via Settings' dev-options, `?ff=cvtDynamics`, or
// the console. Every other card additionally respects the F2 visibility
// store (cardVisibility above) — a normal device show/hide preference that
// layers UNDER these structural/flag gates (a hidden mapAlign panel stays
// hidden even if the user "shows" it in the menu; it just means the card
// reappears once ≥2 laps are selected).
function isVisibleId(id: string): boolean {
  if (id === STATIC_CARD_IDS.mapAlign && !showMapAlign.value) return false
  if (id === STATIC_CARD_IDS.lapAlign && !showAlign.value) return false
  if (id === STATIC_CARD_IDS.cvtDynamics && !isFlagEnabled('cvtDynamics')) return false
  return cardVisibility.isVisible(id)
}

/**
 * The shared write-back path for a "here is a full array of items with new
 * coordinates" event — the CSS Grid drag-to-reorder commit
 * (`onCssGridDragCommit`, see useCssGridDashboardDrag.ts's `onCommit` option)
 * and the corner-resize/gutter-drag commits below all flow through this SAME
 * function so every desktop coordinate change shares the EXACT same
 * invariants — B52's display-vs-canonical layout split, the echo/no-op guard
 * (`sameLayoutPositions`) that prevents an update→compact→update loop,
 * `packExcluding` keeping pinned cards out of the geometry pass, and
 * `mergeMobileOrder` protecting a pinned card's remembered mobile slot —
 * rather than several independently-maintained copies of this logic silently
 * drifting apart.
 */
function writeBackLayout(next: DashboardLayoutItem[]): void {
  if (isMobile.value) {
    // Mobile drag-to-reorder: derive the new top-to-bottom order from the
    // emitted items (sorted by y, then x for determinism) and merge it back
    // into the full persisted order — an id absent from `next` (a hidden
    // align card, or B112: a currently-PINNED card) keeps its own exact array
    // slot rather than being bumped to the end, so reordering two OTHER cards
    // while a third stays pinned can never silently move the pinned card's
    // remembered position (see mergeMobileOrder's doc).
    const orderedVisible = [...next]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((it) => it.i)
    setMobileOrder(mergeMobileOrder(mobileOrder.value, orderedVisible))
    return
  }
  // Desktop: merge visible items' new positions back into the full layout,
  // preserving hidden items untouched (pure function — only coordinates
  // are copied — see mergeLayoutPositions's doc).
  //
  // Grid-compact fix — this is the ONE code path every desktop coordinate
  // change flows through (a CSS Grid drag-to-reorder commit, a corner-resize
  // commit, or a gutter drag's eventual settle — see useGridGutters' onChange
  // doc), so running compactLayoutTopLeft here closes whatever hole moving/
  // resizing a card just left behind, on both axes, right after the gesture
  // ends. Composing
  // two identity-preserving pure functions keeps the whole chain a genuine
  // no-op once positions converge (same invariant #4's crash fix relies on —
  // see mergeLayoutPositions's doc): an already-compacted layout makes
  // compactLayoutTopLeft hand back the exact same array it was given, so a
  // `layout.value` assignment that changed nothing never re-triggers a
  // pointless re-render.
  //
  // Collapse-reflow: `next` carries collapsed cards at their DISPLAY height
  // (COLLAPSED_ROWS). Revert those to the canonical (expanded) height held in
  // `layout` before persisting, so dragging while a card is collapsed never
  // freezes its header-only height into the saved arrangement — expanding
  // still restores the full height. resolveOverlaps then re-seats the
  // just-restored full-height cards below their neighbours before
  // compaction closes any gap.
  //
  // Which packer runs here matters: while ANY card is collapsed, this write-
  // back path is also where the collapse-reflow display (built by
  // applyCollapsedHeights/compactVertical, see `cssGridDesktopLayout`/
  // `cssGridMobileLayout` below) echoes back through a drag/resize/gutter
  // commit — so it must use the SAME vertical-only packer, or the echo would horizontally
  // re-pack the canonical layout with compactLayoutTopLeft and reintroduce
  // the reported bug (collapsing a row-2 card sideways-yanking a row-3
  // card from a different column). When nothing is collapsed this is just
  // the ordinary drag/resize/delete write-back, which keeps the existing
  // top-left (vertical+horizontal) compaction unchanged.
  const canonicalH = new Map(layout.value.map((it) => [it.i, it.h]))
  const restored = collapsedIds.value.size
    ? next.map((it) =>
        collapsedIds.value.has(it.i) ? { ...it, h: canonicalH.get(it.i) ?? it.h } : it,
      )
    : next
  const pack = collapsedIds.value.size > 0 ? compactVertical : compactLayoutTopLeft
  const merged = mergeLayoutPositions(layout.value, restored)
  // B112 — a currently-pinned card is never draggable/resizable (see
  // dashboardLayout.ts's isItemDraggable/isItemResizable), so `next`/
  // `restored` never mentions one — `merged` already carries its rect through completely untouched
  // (mergeLayoutPositions's "absent = keep unchanged" guarantee). It must
  // ALSO sit out of resolveOverlaps/`pack` themselves: both process the
  // FULL array by reading order and can push a just-dragged card away from
  // a spot that's visually free purely because the pinned card's stale
  // rect still "collides" with it on paper — see packExcluding's doc.
  const packed = packExcluding(merged, new Set(pinnedIds.value), (items) => pack(resolveOverlaps(items)))
  // Echo/no-op guard: a collapse toggle makes the grid re-emit the very
  // display we fed it, which `packed` reconstructs back into the current
  // canonical layout — assigning a fresh-but-equal array would re-run the
  // getter and spin the update→compact→update loop DashboardCard's #9 warns
  // of. resolveOverlaps always allocates, so this value comparison (not a
  // reference check) is what actually breaks the cycle.
  if (!sameLayoutPositions(packed, layout.value)) layout.value = packed
}

// --- F6 — the CSS Grid dashboard renderer (see CssGridGrid.vue's own module
// doc for the full "why": grid-layout-plus's `position: absolute` items were
// incompatible with `position: sticky`, which is why pinning used to fake it
// via Teleport into a separate anchor — the user explicitly rejected that.
// grid-layout-plus is gone entirely now (F6 stage 4) — this is the ONLY
// dashboard renderer.
//
// Unlike the removed legacy renderer's own visible-layout computeds, pinned
// ids are NOT filtered out here — CssGridGrid.vue keeps a pinned card in its
// own grid slot (no Teleport, no reserved-then-reclaimed gap) and makes IT
// `position: sticky` there instead. The collapse-reflow overlay
// (applyCollapsedHeights) still applies uniformly to every visible card
// (pinned or not). ---
const cssGridDesktopLayout = computed<DashboardLayoutItem[]>(() =>
  applyCollapsedHeights(
    layout.value.filter((it) => isVisibleId(it.i)),
    collapsedIds.value,
  ),
)
const cssGridMobileLayout = computed<DashboardLayoutItem[]>(() =>
  applyCollapsedHeights(
    mobileLayout(
      mobileOrder.value.filter((id) => isVisibleId(id)),
      layout.value,
    ),
    collapsedIds.value,
  ),
)
/** The single layout array fed to `<CssGridGrid>` — desktop 2-D on wide
 *  screens, the mobile 1-column build below the breakpoint. This computed
 *  itself has no setter — mutation happens via `writeBackLayout` above,
 *  called from the drag/resize/gutter composables' own commit hooks below. */
const cssGridActiveLayout = computed<DashboardLayoutItem[]>(() =>
  isMobile.value ? cssGridMobileLayout.value : cssGridDesktopLayout.value,
)

// --- F6 stage 2 — CSS Grid drag-to-reorder (see useCssGridDashboardDrag.ts's
// own module doc for the full design: pixel measurement + pointer-event
// coalescing live there, collision/compaction is the SAME pure
// dashboardLayout.ts functions `writeBackLayout` already uses). Wired
// directly to `writeBackLayout` above so a CSS-grid drag commits through the
// EXACT same persistence path every other coordinate change does — same B52
// display/canonical split, echo guard, and pinned/mobile-order handling.
const cssGridDrag = useCssGridDashboardDrag({
  layout: cssGridActiveLayout,
  pinnedIds,
  cols: colNum,
  rowHeight: GRID_ROW_HEIGHT,
  marginX: computed(() => gridMargin.value[0]),
  marginY: GRID_MARGIN[1],
  draggable: isDraggable,
  onCommit: writeBackLayout,
})

// --- F6 stage 3(a) — CSS Grid corner resize (see
// useCssGridDashboardResize.ts's own module doc). Chained ON TOP of the drag
// composable's own preview (`layout: cssGridDrag.previewLayout`, not
// `cssGridActiveLayout` directly): only one gesture can ever be physically
// live at a time (a user can't simultaneously drag a card's header AND its
// own corner handle), so feeding this composable whatever the drag composable
// currently renders — the settled layout when nothing is dragging, or the
// live drag preview otherwise — means the SAME single array flows through
// both gestures without either one needing to know about the other. Wired
// to the SAME shared `writeBackLayout` as the drag commit — see that
// function's own doc for why every desktop coordinate change must flow
// through it (resolveOverlaps/compaction + collapsed-height restore only
// happen there; this composable's own live preview deliberately does NOT
// reflow siblings, see its own module doc). ---
const cssGridResize = useCssGridDashboardResize({
  layout: cssGridDrag.previewLayout,
  pinnedIds,
  collapsedIds,
  cols: colNum,
  rowHeight: GRID_ROW_HEIGHT,
  marginX: computed(() => gridMargin.value[0]),
  marginY: GRID_MARGIN[1],
  resizable: isResizable,
  isMobile,
  onCommit: writeBackLayout,
})

// Top-level consts so Vue's `<script setup>` template compiler auto-unwraps
// these ComputedRefs — a NESTED `cssGridResize.previewLayout` property access written directly in
// the template would NOT auto-unwrap (only a top-level script-setup binding
// does), so the template below reads these names instead.
//
// `cssGridRenderedLayout` is the SINGLE array both `<CssGridGrid>` itself AND
// the CSS-grid gutter overlay below consume — B52's own hard-won lesson
// (gutter overlay and grid must read the exact same DISPLAY layout, or
// gutters end up at stale positions) generalises here to "every overlay that
// visually depends on the grid's rendered rects must derive from this one
// computed, never from `cssGridActiveLayout` directly" — it already carries
// through both the drag preview AND the resize preview.
const cssGridRenderedLayout = cssGridResize.previewLayout
const cssGridDragOffsetPx = cssGridDrag.dragOffsetPx
// A plain component-ref -> composable `containerRef` wiring, pointed at
// CssGridGrid's own root element: drag/resize each need their OWN width
// measurement. Both composables' `containerRef`s are bound to the SAME
// element here — two independent ResizeObservers on one node is a cheap,
// low-risk trade that keeps the two composables independently testable (see
// useCssGridDashboardResize.ts's own containerRef doc).
const cssGridGridRef = ref<{ $el: HTMLElement } | null>(null)
watch(cssGridGridRef, (inst) => {
  const el = (inst?.$el as HTMLElement | undefined) ?? null
  cssGridDrag.containerRef.value = el
  cssGridResize.containerRef.value = el
})

// --- F6 stage 3(b) — CSS Grid gutter-drag. Reuses useGridGutters.ts UNCHANGED
// (see its own module doc: it's already renderer-agnostic pure Vue wiring —
// items/geometry/pointer handling, no assumption about grid-layout-plus
// anywhere in it), pointed at this renderer's own wrapping element
// (`cssGridWrapRef` below).
//
// B52 — `cssGridGutterItems` derives from `cssGridRenderedLayout` (the EXACT
// same array fed to `<CssGridGrid :layout="...">`, see that computed's own
// doc), filtered to drop pinned ids: a pinned card here keeps its own sticky
// grid slot (unlike the removed legacy renderer, where a pinned card had NO
// grid slot at all) — but it still has no resize mechanism (`isItemResizable`
// returns false while pinned, and `disable-pin-resize` hides its own floating
// handle), so a gutter must never be offered along its edge either: dragging
// a vertical gutter changes BOTH neighbours' `w`/`x`, which would silently
// move a pinned card's supposedly-fixed grid slot out from under it.
const cssGridGutterItems = computed<DashboardLayoutItem[]>(() =>
  cssGridRenderedLayout.value.filter((it) => !isPinned(it.i)),
)
const cssGridGutterEnabled = computed(() => !isMobile.value && !isLocked.value)
const cssGridGutters = useGridGutters({
  items: cssGridGutterItems,
  enabled: cssGridGutterEnabled,
  collapsedIds,
  cols: GRID_COLS,
  rowHeight: GRID_ROW_HEIGHT,
  marginX: GRID_MARGIN[0],
  marginY: GRID_MARGIN[1],
  // Unlike the legacy gutter's own bespoke `onChange` (a plain
  // mergeLayoutPositions with no resolveOverlaps/compaction — safe there only
  // because grid-layout-plus's own internal reflow runs a second pass once
  // the prop changes), this renderer has NOTHING else that will ever
  // re-pack an overlap CSS Grid never auto-compacts anything on its own — so
  // routing straight through the shared `writeBackLayout` (which already
  // restores canonical collapsed heights AND runs resolveOverlaps/compaction)
  // is both simpler and correct here.
  onChange: writeBackLayout,
})
const cssGridWrapRef = ref<HTMLElement | null>(null)
watch(cssGridWrapRef, (el) => {
  cssGridGutters.containerRef.value = el
})
// Top-level consts so the template's `v-for`/`:class` reads auto-unwrap these
// two ComputedRefs — same reasoning as `cssGridRenderedLayout`'s own doc
// above: a NESTED `cssGridGutters.gutters` property read directly in the
// template would hand back the Ref object itself, not its unwrapped array.
// `onGutterPointerDown` doesn't need this — it's INVOKED as a function in the
// template, never read as a value.
const cssGridGuttersList = cssGridGutters.gutters
const cssGridDraggingKey = cssGridGutters.draggingKey

function onResetLayout(): void {
  if (window.confirm(t('analyzer.layout.resetLayoutConfirm'))) resetLayout()
}

// B7 — TrackMap's in-card "maximize" toggle is mirrored here (via
// `@update:maximized`) purely so the "map" card can hide its OWN other body
// content (heatmap legend / line hint / lap count+reset / lap-time+distance
// band inputs) while it's active — TrackMap itself only knows about its own
// canvas + buttons, not these sibling elements declared in this template.
// With those hidden, TrackMap's existing `.fill` flex-grow expands to fill
// the whole card body; no special sizing logic is needed here.
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

/** Title for ANY card id (static or chart), used by the pinned-card block
 *  (see template) which renders OUTSIDE the big per-card v-if/else-if chain
 *  and so can't just read whichever branch's own `title` prop happened to
 *  fire. Static ids look up their i18n key in STATIC_CARD_TITLE_KEYS; a chart
 *  id falls back to the same numbered chartTitle() the card itself uses. */
function titleForItemId(id: string): string {
  const key = STATIC_CARD_TITLE_KEYS[id]
  if (key) return t(key)
  const chart = charts.value.find((c) => chartItemId(c.id) === id)
  return chart ? chartTitle(chart) : ''
}

// --- F2: the grouped card menu (CardMenu.vue) — presentation-only data built
// from cardVisibility/isVisibleId above plus cardGroups.ts's static grouping
// table. cvtDynamics is filtered OUT entirely (not just unchecked) when its
// feature flag is off, matching B98's "completely absent" intent. ---
const cardMenuGroups = computed(() =>
  CARD_GROUPS.map((group) => ({
    id: group.id,
    label: t(group.labelKey),
    items: Object.values(STATIC_CARD_IDS)
      .filter((id) => STATIC_CARD_GROUP[id] === group.id)
      .filter((id) => id !== STATIC_CARD_IDS.cvtDynamics || isFlagEnabled('cvtDynamics'))
      .map((id) => ({
        id,
        title: titleForItemId(id),
        checked: cardVisibility.isVisible(id),
        locatable: isVisibleId(id),
      })),
  })),
)

const chartMenuEntries = computed(() =>
  charts.value.map((c) => {
    const itemId = chartItemId(c.id)
    return {
      id: c.id,
      itemId,
      title: chartTitle(c),
      checked: cardVisibility.isVisible(itemId),
      locatable: isVisibleId(itemId),
    }
  }),
)

function onCardMenuToggle(id: string, value: boolean): void {
  cardVisibility.setVisible(id, value)
}

/** 定位 — scroll a card's DOM element (tagged `data-card-id`, see the
 *  template) into view and briefly pulse-highlight it. */
function locateCard(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Restart the pulse animation even if the same card was just located
  // (forces a reflow between removing and re-adding the class).
  el.classList.remove('card-locate-pulse')
  void el.offsetWidth
  el.classList.add('card-locate-pulse')
  window.setTimeout(() => el.classList.remove('card-locate-pulse'), 1000)
}

// --- F1: the shared card context, assembled ONCE from every ref/computed/
// store-action/handler an extracted card body reads. The dispatcher
// (AnalyzerCardBody) passes this straight down so a card's content (a
// standalone component under cards/) renders identically whether it's inside
// the desktop grid's DashboardCard or the mobile grid. A plain object of
// refs + functions: the reactivity is deliberately NOT cloned away (see
// analyzerCardContext.ts). ---
const primaryFileId = computed(() => activeFile.value?.id ?? null)
const primaryFileName = computed(() => activeFile.value?.name ?? '')
const line = computed(() => lapStore.line)
const excludedCount = computed(() => lapStore.excluded.length)
const hasLapTimeBand = computed(() => lapStore.lapTimeBand != null)
const hasLapDistanceBand = computed(() => lapStore.lapDistanceBand != null)

const cardCtx: AnalyzerCardContext = {
  session,
  track,
  xValues,
  xRange,
  cursorIdx,
  cursorFrac,
  laps,
  timeMs,
  selectedLaps,
  hasEcuLaps,
  comparisonSessions,
  primaryFileId,
  primaryFileName,
  charts,
  mapMaximized,
  line,
  highlightLaps,
  comparisonLapHighlights,
  comparisonAlignLaps,
  focusRange,
  colorValues,
  trackColormap,
  mapGates,
  allExtremaMarkers,
  overlayTracks,
  heatNorm,
  legendGradient,
  trackChannel,
  excludedCount,
  hasLapTimeBand,
  hasLapDistanceBand,
  bandMin,
  bandMax,
  distBandMin,
  distBandMax,
  bandExcludedCount,
  distBandExcludedCount,
  sectorFailureCount,
  sectorAllFailed,
  channelOptions,
  trackExtrema,
  trackChannelChosen,
  accelResults,
  speedAvailable,
  ambiguousMatches,
  appliedSharedTrack,
  setCursor: (index) => analyzer.setCursor(index),
  setCursorAt: (index, frac) => analyzer.setCursorAt(index, frac),
  setLine: (nextLine) => lapStore.setLine(nextLine),
  onUpdateGate,
  setMapMaximized: (value) => {
    mapMaximized.value = value
  },
  sessionOffsetOf: (id) => analyzer.sessionOffsetOf(id),
  setComparisonMapOffset,
  resetSessionOffset: (id, axis) => analyzer.resetSessionOffset(id, axis),
  fmtVal,
  resetLine,
  onBandInput,
  clearLapTimeBand: () => lapStore.clearLapTimeBand(),
  onDistBandInput,
  clearLapDistanceBand: () => lapStore.clearLapDistanceBand(),
  onLapSelect,
  onAccelFocus,
  onAccelClear,
  onXZoom,
  chooseTrack,
  dismissAmbiguous,
  detachFromSharedTrack,
}
</script>

<template>
  <div class="analyzer">
    <p v-if="readyFiles.length === 0" class="empty">{{ t('analyzer.noFiles') }}</p>

    <template v-else>
      <div class="toolbar">
        <div class="xaxis">
          <button type="button" :class="{ active: xAxis === 'time' }" @click="analyzer.xAxis = 'time'">
            {{ t('analyzer.time') }}
          </button>
          <button type="button" :class="{ active: xAxis === 'distance' }" @click="analyzer.xAxis = 'distance'">
            {{ t('analyzer.distance') }}
          </button>
        </div>
        <!-- F2 — the card menu (add/remove/show-hide/locate every card) lives
             HERE, grouped with the reset-layout button, so every dashboard-
             level layout action sits in one toolbar cluster. The old
             standalone 新增圖表/新增散佈圖 buttons (T4) moved INTO the menu's
             圖表 section — see CardMenu.vue. -->
        <div class="layout-tools">
          <span class="drag-hint">{{ isMobile ? t('analyzer.layout.dragHintMobile') : t('analyzer.layout.dragHint') }}</span>
          <CardMenu
            :groups="cardMenuGroups"
            :charts="chartMenuEntries"
            :charts-group-label="t('analyzer.cardMenu.groupCharts')"
            @toggle="onCardMenuToggle"
            @locate="locateCard"
            @add-timeseries="onAddTimeseries"
            @add-scatter="onAddScatter"
            @remove-chart="analyzer.removeChart"
          />
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

      <!-- F6 — the CSS-Grid dashboard renderer (see CssGridGrid.vue's module
           doc). Reuses the SAME card markup (DashboardCard + AnalyzerCardBody)
           the grid always has — this is a new renderer, not a new card system.

           `cssGridWrapRef` (stage 3) plays the exact same role as the legacy
           `grid-wrap` div above: a zero-extra-box `position: relative`
           wrapper whose measured width the CSS-grid gutter overlay's pixel
           math is built from (see useGridGutters.ts's own `containerRef`
           doc) — it must wrap `<CssGridGrid>` exactly, no added padding/
           border, for that measurement to agree with the grid's own.

           Pinning here needs no Teleport/anchor at all: `pinned-ids` tells
           CssGridGrid which items to render `position: sticky`, in their OWN
           grid slot (stage 3(c): staggered `top`/z-index when several are
           pinned at once, see that component's own `pinStackStyle` doc).
           `aspect-ratio`/`pinned-width-px`/`pinned-height-px` are
           deliberately NOT passed to `<DashboardCard>` — with none of the
           three set, its `cardStyle` computed contributes no inline
           width/height/aspect-ratio at all while pinned (see that
           component's own doc), so the card keeps its NORMAL grid-slot size
           exactly like the task asks, instead of the old floating-anchor
           sizing path. `disable-pin-resize` hides the pinned-card's own
           floating corner resize handle (DashboardCard.vue) — a pinned card
           has no resize mechanism under this renderer at all (its grid slot
           is fixed at its natural footprint; `resizable` below is already
           false for it via `isItemResizableNow`, so `resize-mode="cssGrid"`'s
           own corner handle is hidden for it too).

           F6 stage 3 — `:layout` is now `cssGridRenderedLayout` (chains the
           drag preview INTO the resize preview — see that computed's own
           doc for why one shared array feeds both the grid and the gutter
           overlay). `:drag-offset-px` carries the dragged card's raw pixel
           follow-offset through to CssGridGrid's own `dragOffsetFor`. Each
           card's `drag-mode="cssGrid"` + `:draggable` + the three
           `@css-grid-drag-*` listeners drive the drag composable exactly as
           stage 2 left them; `resize-mode="cssGrid"` + `:resizable` + the
           three `@css-grid-resize-*` listeners are the NEW stage-3(a)
           equivalent for the corner handle — see DashboardCard.vue's own
           module doc for why both gestures are entirely self-contained (no
           external library to hand off to).
           `ref="cssGridGridRef"` feeds BOTH composables' own container-width
           ResizeObservers (script-side watch, see its own doc). -->
      <div ref="cssGridWrapRef" class="css-grid-wrap">
      <CssGridGrid
        ref="cssGridGridRef"
        :layout="cssGridRenderedLayout"
        :cols="colNum"
        :row-height="GRID_ROW_HEIGHT"
        :margin-x="gridMargin[0]"
        :margin-y="gridMargin[1]"
        :pinned-ids="pinnedIds"
        :drag-offset-px="cssGridDragOffsetPx"
      >
        <template #item="{ item }">
          <DashboardCard
            :data-card-id="String(item.i)"
            :title="titleForItemId(String(item.i))"
            :collapsed="isCollapsed(String(item.i))"
            :pinned="isPinned(String(item.i))"
            :draggable="cssGridDrag.isItemDraggableNow(String(item.i))"
            :resizable="cssGridResize.isItemResizableNow(String(item.i))"
            @update:collapsed="toggleCollapsed(String(item.i))"
            @update:pinned="togglePinned(String(item.i))"
            @css-grid-drag-start="cssGridDrag.onCardDragStart(String(item.i), $event.x, $event.y)"
            @css-grid-drag-move="cssGridDrag.onCardDragMove($event.x, $event.y)"
            @css-grid-drag-end="cssGridDrag.onCardDragEnd($event.committed)"
            @css-grid-resize-start="cssGridResize.onCardResizeStart(String(item.i), $event.x, $event.y)"
            @css-grid-resize-move="cssGridResize.onCardResizeMove($event.x, $event.y)"
            @css-grid-resize-end="cssGridResize.onCardResizeEnd($event.committed)"
          >
            <AnalyzerCardBody :id="String(item.i)" :ctx="cardCtx" />
          </DashboardCard>
        </template>
      </CssGridGrid>
      <!-- 縫隙拖動 overlay: one thin hit-box per shared card edge, drawn
           exactly over the margin gap between two adjacent cards (see
           gridGutter.ts's `gutterRect`) — never over any card's own content,
           so it can't intercept clicks meant for the dashboard. Empty
           (nothing rendered) on mobile / while locked / while nothing is
           adjacent — see useGridGutters's `enabled` gate. -->
      <div
        v-for="g in cssGridGuttersList"
        :key="g.key"
        class="grid-gutter"
        :class="[g.orientation, { dragging: cssGridDraggingKey === g.key }]"
        :style="{ left: `${g.rect.left}px`, top: `${g.rect.top}px`, width: `${g.rect.width}px`, height: `${g.rect.height}px` }"
        role="separator"
        :aria-orientation="g.orientation === 'vertical' ? 'vertical' : 'horizontal'"
        :aria-label="t(g.orientation === 'vertical' ? 'analyzer.layout.resizeAdjacentWidth' : 'analyzer.layout.resizeAdjacentHeight')"
        @pointerdown="cssGridGutters.onGutterPointerDown(g, $event)"
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
/* B36 — App.vue's `.content` zeroes its own horizontal padding on mobile so
   the dashboard grid below (`.css-grid-wrap`, i.e. the actual DashboardCard
   content) can go edge-to-edge — see that file's own comment.
   Loose (non-card) rows that sit directly in `.analyzer` — the toolbar and
   the "no files" message — aren't cards at all, just text/buttons, so they
   get a small inset of their own back rather than sitting flush against the
   true screen edge. */
@media (max-width: 768px) {
  .empty,
  .toolbar {
    padding: 0 calc(var(--space) * 1.5);
  }
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
/* F6 — the positioning context the gutter overlay's absolutely-positioned
   hit-boxes are placed relative to: must wrap `<CssGridGrid>` with zero extra
   box (no padding/border) so its measured width matches `CssGridGrid`'s own
   root element exactly — that root's `clientWidth` (padding included, per how
   `padding: box-sizing` works) is already the SAME `containerWidthPx`
   convention gridGutter.ts's `colWidthPx`/`xPx`/`yPx` formulas expect (see
   cssGridPlacement.ts's own module doc for the pixel-geometry derivation). */
.css-grid-wrap {
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
  /* The narrow desktop strip must not claim an incidental finger swipe. */
  touch-action: pan-y;
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
/* B93 — the pink strip itself IS the resize affordance; the always-visible
   circular grip B90 added on top of it was redundant and got removed. Coarse
   pointers still need a real ≥44px hit target though, so an invisible
   `::before` overlay widens/heightens ONLY the narrow axis (the strip's own
   length already spans the full shared edge) without touching the strip's
   visible size. A horizontal gutter's drag is a VERTICAL gesture, so
   `pan-y` (fine for the base rule, which fine pointers never read anyway)
   would hand that exact motion to page scroll instead of the drag — coarse
   pointers get `touch-action: none` on the gutter itself so its own drag
   always wins; scrolling that starts on card content, outside the gutter's
   hit box, is untouched. */
:root[data-any-pointer-coarse] .grid-gutter {
  touch-action: none;
}
:root[data-any-pointer-coarse] .grid-gutter::before {
  content: '';
  position: absolute;
}
:root[data-any-pointer-coarse] .grid-gutter.vertical::before {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 44px;
  transform: translateX(-50%);
}
:root[data-any-pointer-coarse] .grid-gutter.horizontal::before {
  left: 0;
  right: 0;
  top: 50%;
  height: 44px;
  transform: translateY(-50%);
}

/* CSS Grid renderer's own corner resize handle (DashboardCard.vue's
   `.css-grid-resize-handle`) is themed off these three custom properties,
   declared here on `.analyzer` (an ancestor of every DashboardCard instance
   regardless of grid position) so every card's handle picks up the same
   size/color/mobile touch-target bump with zero per-card CSS. Named
   `--vgl-resizer-*` for historical continuity with the grid-layout-plus
   `.vgl-item__resizer` these tokens used to theme (removed in the F6 stage 4
   migration) — kept as-is rather than renamed, since the css-grid resize
   handle's own `<style>` already references these exact names. */
.analyzer {
  --vgl-resizer-size: 10px;
  --vgl-resizer-border-color: var(--color-accent);
  --vgl-resizer-border-width: 2px;
}
/* B110 — the handle's real audience is whatever pointer is actually driving
   the drag, not the viewport size: a desktop mouse user who narrows the
   window below 768px shouldn't get the chunky 30px target, while a touch
   tablet running the full desktop layout (coarse pointer, but wide viewport)
   still needs it. §8/B35 solved exactly this class of problem for
   `.grid-gutter` above via the `any-pointer: coarse` capability signal
   mirrored onto `<html>` by useInputCapabilities.ts; reuse the same
   `:root[data-any-pointer-coarse]` selector here — NEVER wrap that
   `:root[...]` prefix in the Vue scoped-CSS global-escape helper (see B92:
   doing so drops scoping for the WHOLE selector, not just the `:root[...]`
   part). */
:root[data-any-pointer-coarse] .analyzer {
  --vgl-resizer-size: 30px;
}

/* F2 — card-menu 定位 (locate): a brief outline pulse on the card the user
   just jumped to via scrollIntoView (see `locateCard`). Applied imperatively
   (classList.add/remove, not a template binding) since it's a one-shot,
   timer-driven effect rather than persistent state — but this selector still
   lives in AnalyzerView's OWN scoped style block because a parent's scoped
   CSS reaches a directly-instantiated child component's ROOT element (every
   DashboardCard tag here IS such a child), same reasoning as this file's
   other `:deep`-free rules that theme DashboardCard elements. `prefers-
   reduced-motion: reduce` swaps the animated fade for a
   static outline shown for the same duration (see `locateCard`'s timeout) —
   matches this app's existing reduced-motion convention (useFlipAnimation.ts,
   App.vue, CurrentValuesPanel.vue). */
.analyzer :deep(.card-locate-pulse) {
  animation: card-locate-pulse 1s ease-out;
}
@keyframes card-locate-pulse {
  0% {
    outline: 3px solid var(--color-accent);
    outline-offset: 2px;
  }
  100% {
    outline: 3px solid transparent;
    outline-offset: 2px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .analyzer :deep(.card-locate-pulse) {
    animation: none;
    outline: 3px solid var(--color-accent);
    outline-offset: 2px;
  }
}
</style>
