<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { GridLayout } from 'grid-layout-plus'
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
import { useCardVisibility } from '@/composables/useCardVisibility'
import { useMobileView } from '@/composables/useMobileView'
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
import { scrubberDomain } from '@/domain/analysis/scrubber'
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
  minSizeFor,
  isItemDraggable,
  isItemResizable,
  resizeOptionFor,
  mergeLayoutPositions,
  compactLayoutTopLeft,
  compactVertical,
  resolveOverlaps,
  applyCollapsedHeights,
  sameLayoutPositions,
  COLLAPSED_ROWS,
  type DashboardLayoutItem,
} from '@/domain/layout/dashboardLayout'
import DashboardCard from '@/components/DashboardCard.vue'
import CardMenu from './CardMenu.vue'
import AnalyzerCardBody from './AnalyzerCardBody.vue'
import MobileFocusStack from './MobileFocusStack.vue'
import MobileScrubber from './MobileScrubber.vue'
import type { AnalyzerCardContext } from './analyzerCardContext'

const { t } = useI18n()
const fileStore = useFileStore()
const analyzer = useAnalyzerStore()
const lapStore = useLapStore()
const sectorStore = useSectorStore()
const drivetrainStore = useDrivetrainStore()
const suspensionStore = useSuspensionStore()
const { charts, xAxis, xRange, cursorIdx, mapMaximized, trackChannel, trackColormap, trackColorEnabled, markMinima, markMaxima } =
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

// --- #8: draggable/resizable dashboard grid (grid-layout-plus) ---
const chartIds = computed(() => charts.value.map((c) => c.id))
const { layout, colNum, isMobile, isDraggable, isResizable, gridMargin, resetLayout } =
  useDashboardLayout(chartIds, isLocked)

// --- #9: per-card collapse (all breakpoints) + single cross-breakpoint pin
// (釘選 — see DashboardCard's module doc for the Teleport-based redesign) +
// mobile drag-to-reorder order ---
const { state: panelState, isCollapsed, isPinned, toggleCollapsed, togglePinned, mobileOrder, setMobileOrder } =
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

// B52 fix — the collapse-reflow DISPLAY layout (see applyCollapsedHeights),
// shared by `activeLayout`'s getter below AND `gutterItems`: the gutter
// overlay must be detected/positioned from the exact same rects the grid
// actually renders, not the canonical (pre-collapse) `desktopVisibleLayout`.
// Before this fix, `gutterItems` was built straight from
// `desktopVisibleLayout`, so once any card collapsed, every gutter below/
// beside it stayed at its stale pre-collapse position/size — the reported
// "pink gutter indicator doesn't follow a collapsed card" bug.
const desktopDisplayLayout = computed<typeof layout.value>(() =>
  applyCollapsedHeights(desktopVisibleLayout.value, collapsedIds.value),
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

// --- F1: mobile Focus Stack view mode (聚焦/完整) ---
// A DEVICE preference (tracklogstudio.mobileView.v1): `focus` = the new
// curated vertical stack (mobile default), `full` = the existing
// full-dashboard single-column grid. Never shown/consulted on desktop — the
// toggle is `v-if="isMobile"` and the grid path is what mounts otherwise.
const mobileView = useMobileView(chartIds)
const mobileMode = mobileView.mode
function setMobileMode(mode: 'focus' | 'full'): void {
  mobileView.setMode(mode)
}
// The curated, ordered id set the Focus Stack renders: the SAME visible
// mobile set the mobile grid uses (mobileOrder filtered to `isVisibleId`),
// run through the user's explicit focus order (resolveFocusStackOrder inside
// useMobileView). Keeping AnalyzerView the single owner of the visible set is
// deliberate — the stack and the grid can never disagree about which cards
// are visible.
const focusStackIds = computed(() => mobileView.focusStackIds(mobileOrder.value.filter(isVisibleId)))
// Whether the Focus Stack (not the grid) is what should mount right now — the
// two are mutually exclusive so they never both render.
const showFocusStack = computed(() => isMobile.value && mobileMode.value === 'focus')
// Per-panel height weight: the persisted splitWeights (set by the phase-2
// draggable divider, see onFocusResize below) fall back to a map-heavy
// default (design §3: map ~55% / the rest ~45%, i.e. the map/chart pairing
// reads 55/45) until the user has actually dragged a divider.
function focusWeightFor(id: string): number {
  return mobileView.weightFor(id, id === STATIC_CARD_IDS.map ? 55 : 45)
}
// F1 phase 2 — MobileFocusStack emits `resize` once per divider drag, with
// BOTH neighbours' new weights (keyed by card id); persist each through the
// same useMobileView setter the store owns (see mobileView.ts's
// `setSplitWeight` — synchronous multiple assignments within one tick are
// coalesced into a single persist-watch flush, so this doesn't double-write).
function onFocusResize(weights: Record<string, number>): void {
  for (const [id, weight] of Object.entries(weights)) {
    mobileView.setWeight(id, weight)
  }
}

// F1 phase 3 — the Focus Stack's shared bottom scrubber's domain: exactly one
// selected lap -> that lap's own sample span, else -> the full session (see
// scrubber.ts's `scrubberDomain` doc). Derived here (not owned by the
// scrubber) so AnalyzerView stays the single source for what "the current
// selection" means, same as `selectedLaps`/`focusRange` above.
const focusScrubberDomain = computed(() => scrubberDomain(selectedLaps.value, xValues.value?.length ?? 0))
// The scrubber only ever CALLS the store's existing cursor setter — see
// analyzerStore.ts's `setCursor` and this file's own `cardCtx.setCursor` —
// it never invents new cursor state (design doc §6). Every other cursor
// consumer (map, timeline charts, and overlay charts via TimeSeriesChart's
// own reverse-link) already follows `cursorIdx` for free.
function onScrubberScrub(index: number): void {
  analyzer.setCursor(index)
}

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
  /** B59 — 手機單欄下鎖成只能改高度的 resize 邊界設定;桌面 `undefined`(用
   *  GridItem 自己的預設,四邊都可拖)。見 dashboardLayout.ts 的
   *  `resizeOptionFor`/`VERTICAL_ONLY_RESIZE_OPTION` doc。 */
  resizeOption?: Record<string, unknown>
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
  mobile: boolean,
): (DashboardLayoutItem & GridItemDecoration)[] {
  // B59 — computed ONCE per call (not per item): the same vertical-only
  // resize-edge override applies to every card on mobile, none on desktop.
  const resizeOption = resizeOptionFor(mobile)
  return items.map((it) => {
    const collapsed = isCollapsed(it.i)
    const min = minSizeFor(it.i)
    return {
      ...it,
      dragAllowFrom: '.drag-handle',
      dragIgnoreFrom: '.actions',
      isDraggable: isItemDraggable(isDraggable.value, isPinned(it.i)),
      // A collapsed card is header-only: resizing a headerbar is meaningless,
      // and (more importantly) letting the grid clamp its height back up to the
      // card's normal minH would defeat the reflow — so collapsed cards are not
      // resizable and their minH drops to the collapsed row count.
      isResizable: isItemResizable(isResizable.value, isPinned(it.i)) && !collapsed,
      minW: min.minW,
      minH: collapsed ? COLLAPSED_ROWS : min.minH,
      resizeOption,
    }
  })
}

// The single array bound to GridLayout via v-model: desktop 2-D on wide
// screens, our 1-column mobileLayout below MOBILE_BREAKPOINT_PX. The getter
// decorates items with the per-GridItem drag props above; the setter reads
// back only `{ i, x, y, w, h }` (the decorations are ignored) and routes the
// library's `update:layout` emission to the RIGHT persistence path for the
// current breakpoint so the other one is never touched.
const activeLayout = computed<(DashboardLayoutItem & GridItemDecoration)[]>({
  get: () =>
    // Collapse-reflow overlay: collapsed cards shrink to COLLAPSED_ROWS and the
    // layout re-packs top-left so neighbours fill the reclaimed rows (補位). The
    // canonical (expanded) heights stay in `layout` — this is display-only.
    // Desktop reuses `desktopDisplayLayout` (also fed to `gutterItems` below)
    // so the grid and the gutter overlay never disagree on where a card
    // actually is.
    decorateForGrid(
      isMobile.value
        ? applyCollapsedHeights(mobileVisibleLayout.value, collapsedIds.value)
        : desktopDisplayLayout.value,
      isMobile.value,
    ),
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
    // applyCollapsedHeights/compactVertical, see the getter above) echoes back
    // through the grid's `update:layout`/`layout-updated` events — so it must
    // use the SAME vertical-only packer, or the echo would horizontally
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
    const packed = pack(resolveOverlaps(mergeLayoutPositions(layout.value, restored)))
    // Echo/no-op guard: a collapse toggle makes the grid re-emit the very
    // display we fed it, which `packed` reconstructs back into the current
    // canonical layout — assigning a fresh-but-equal array would re-run the
    // getter and spin the update→compact→update loop DashboardCard's #9 warns
    // of. resolveOverlaps always allocates, so this value comparison (not a
    // reference check) is what actually breaks the cycle.
    if (!sameLayoutPositions(packed, layout.value)) layout.value = packed
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
// resizes the card whose edge that gap is. A left/right gap exchanges width
// with its adjacent right card; a top/bottom gap retains the existing reflow
// model. See gridGutter.ts for the domain math. useGridGutters.ts owns DOM/pointer wiring
// this just calls into. Desktop-only (isMobile has no side-by-side pairs)
// and disabled while the dashboard is locked, same two conditions that
// already gate the grid's own drag/resize (isDraggable/isResizable in
// useDashboardLayout). The currently-pinned card is excluded from
// `gutterItems` — its grid slot is an inert Teleport placeholder (see the
// template's pin-placeholder note), so a gutter touching it would visibly do
// nothing.
//
// B52 fix — built from `desktopDisplayLayout` (the collapse-reflow DISPLAY
// layout, same one fed to `<GridLayout>` by `activeLayout`'s getter), not the
// canonical `desktopVisibleLayout`: pinned filtering now happens AFTER the
// collapse overlay so it matches exactly what's on screen, whether or not
// the pinned card is also collapsed.
const gutterItems = computed<DashboardLayoutItem[]>(() =>
  desktopDisplayLayout.value.filter((it) => !isPinned(it.i)),
)
const gutterEnabled = computed(() => !isMobile.value && !isLocked.value)
const gridGutters = useGridGutters({
  items: gutterItems,
  enabled: gutterEnabled,
  // B52 — lets useGridGutters drop a gutter along a collapsed card's DISPLAY-
  // only bottom edge (see gridGutter.ts's filterCollapsedGutters) so dragging
  // never targets a height that's about to be reverted below.
  collapsedIds,
  cols: GRID_COLS,
  rowHeight: GRID_ROW_HEIGHT,
  marginX: GRID_MARGIN[0],
  marginY: GRID_MARGIN[1],
  // Same persistence path as onLayoutUpdated above (#1's fix). A vertical
  // split already supplies both changed cards, so it reaches GridLayout as a
  // non-overlapping layout and the right card stays on its row. Horizontal
  // gutters keep their existing reflow through the normal grid round trip.
  //
  // B52 fix — `next` is the FULL `gutterItems` array (display heights), so
  // EVERY currently-collapsed card in it still carries its COLLAPSED_ROWS
  // display height, not just the one card the drag actually resized. Without
  // restoring those back to `layout.value`'s canonical height first,
  // `mergeLayoutPositions` would see every collapsed card's `h` "changed"
  // (COLLAPSED_ROWS vs. its real height) and freeze COLLAPSED_ROWS into the
  // persisted layout for ALL of them — same canonical-height restore
  // `activeLayout`'s setter already does for the native drag/resize path.
  onChange: (next) => {
    const canonicalH = new Map(layout.value.map((it) => [it.i, it.h]))
    const restored = collapsedIds.value.size
      ? next.map((it) => (collapsedIds.value.has(it.i) ? { ...it, h: canonicalH.get(it.i) ?? it.h } : it))
      : next
    layout.value = mergeLayoutPositions(layout.value, restored)
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
 *  template) into view and briefly pulse-highlight it. A pinned card's real
 *  content lives in `#dashboard-pinned-anchor` (Teleported — see that div's
 *  doc), so this query finds it there too, same `data-card-id` attribute. */
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
// (AnalyzerCardBody) — and, on mobile, MobileFocusStack — pass this straight
// down so a card's content (now a standalone component under cards/) renders
// identically whether it's inside the desktop grid's DashboardCard or the
// mobile Focus Stack. A plain object of refs + functions: the reactivity is
// deliberately NOT cloned away (see analyzerCardContext.ts). ---
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
  <div class="analyzer" :class="{ 'focus-mode': showFocusStack }">
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
          <!-- F1 — mobile-only 聚焦/完整 view toggle: Focus Stack vs the full
               dashboard grid. Never rendered on desktop (the grid is the only
               desktop presentation). Two-way bound to useMobileView().mode. -->
          <div
            v-if="isMobile"
            class="view-mode"
            role="group"
            :aria-label="t('analyzer.mobileView.toggleAria')"
          >
            <button
              type="button"
              :class="{ active: mobileMode === 'focus' }"
              :aria-pressed="mobileMode === 'focus'"
              @click="setMobileMode('focus')"
            >
              {{ t('analyzer.mobileView.focus') }}
            </button>
            <button
              type="button"
              :class="{ active: mobileMode === 'full' }"
              :aria-pressed="mobileMode === 'full'"
              @click="setMobileMode('full')"
            >
              {{ t('analyzer.mobileView.full') }}
            </button>
          </div>
          <!-- F1 — drag-to-reorder doesn't apply in the Focus Stack (no grid,
               no drag handles), so the hint would be misleading there; the
               full dashboard (desktop always, or mobile's 完整 mode) keeps it. -->
          <span v-if="!showFocusStack" class="drag-hint">{{ isMobile ? t('analyzer.layout.dragHintMobile') : t('analyzer.layout.dragHint') }}</span>
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
      <!-- F1 — the mobile Focus Stack replaces the grid entirely when the
           mobile view mode is `focus`. The two are mutually exclusive (v-if/
           v-else) so the grid and the stack never both mount. On desktop, or
           in mobile `full` mode, the existing GridLayout path below is
           unchanged. -->
      <template v-if="showFocusStack">
        <MobileFocusStack
          :ids="focusStackIds"
          :ctx="cardCtx"
          :title-for="titleForItemId"
          :weight-for="focusWeightFor"
          @expand="setMobileMode('full')"
          @resize="onFocusResize"
        />
        <!-- F1 phases 3-4 — the shared bottom scrubber. A normal flex child
             right after the (flex:1, scrollable) stack, so it naturally sits
             pinned above BottomNav within `.analyzer.focus-mode`'s own
             height (see that class's comment) — no fixed positioning needed. -->
        <MobileScrubber
          :domain="focusScrubberDomain"
          :time-ms="timeMs"
          :cursor-idx="cursorIdx"
          @scrub="onScrubberScrub"
        />
      </template>
      <div v-else ref="gridWrapRef" class="grid-wrap">
      <GridLayout
        v-model:layout="activeLayout"
        :col-num="colNum"
        :is-draggable="isDraggable"
        :is-resizable="isResizable"
        :responsive="false"
        :row-height="GRID_ROW_HEIGHT"
        :margin="gridMargin"
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
            :data-card-id="String(item.i)"
            :title="titleForItemId(String(item.i))"
            :collapsed="isCollapsed(String(item.i))"
            :pinned="isPinned(String(item.i))"
            :aspect-ratio="item.w / item.h"
            :show-pin="String(item.i) === 'suspension' ? isMobile : undefined"
            @update:collapsed="toggleCollapsed(String(item.i))"
            @update:pinned="togglePinned(String(item.i))"
          >
            <AnalyzerCardBody :id="String(item.i)" :ctx="cardCtx" />
          </DashboardCard>
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
        role="separator"
        :aria-orientation="g.orientation === 'vertical' ? 'vertical' : 'horizontal'"
        :aria-label="t(g.orientation === 'vertical' ? 'analyzer.layout.resizeAdjacentWidth' : 'analyzer.layout.resizeAdjacentHeight')"
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
/* F1 — in the mobile Focus Stack mode the analyzer fills App.vue's `.content`
   height (which is `flex: 1` inside the app shell, so it has a definite
   height) so the stack below the toolbar can flex-grow to fill the space
   between the toolbar and the fixed BottomNav rather than being content-sized.
   Scoped to `focus-mode` (mobile + `focus`) so the desktop/full-grid layout —
   where the page itself scrolls a tall content-sized grid — is untouched. */
.analyzer.focus-mode {
  height: 100%;
  min-height: 0;
}
/* B36 — App.vue's `.content` zeroes its own horizontal padding on mobile so
   the dashboard grid below (`.grid-wrap`/`.pinned-anchor`, i.e. the actual
   DashboardCard content) can go edge-to-edge — see that file's own comment.
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
/* F1 — the 聚焦/完整 mobile view toggle: same segmented-control language as
   the time/distance `.xaxis` switch above so the two read as the same kind of
   control. */
.view-mode {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.view-mode button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
.view-mode button.active {
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
/* #2 縫隙拖動 — the positioning context the gutter overlay's absolutely-
   positioned hit-boxes are placed relative to (see the template's doc on
   gridWrapRef). Must wrap `<GridLayout>` with zero extra box (no padding/
   border) so ITS measured width is exactly what grid-layout-plus itself
   lays cards out against. */
.grid-wrap {
  position: relative;
}
/* B63 — grid-layout-plus does not write `touch-action` inline: its GridItem
   adds `.vgl-item--no-touch` on Android whenever an item is draggable or
   resizable, and the library's injected stylesheet gives that ancestor
   `touch-action: none`. The browser intersects a target's touch-action with
   every ancestor, so DashboardCard's `pan-y` header rule could never restore
   native scrolling during B61's pending long-press window. Scope the override
   to dashboard grid items. Explicit gesture surfaces (map/chart) and the
   resize handle retain their own `touch-action: none`, while a fast swipe
   beginning on a title can once again be claimed by native vertical scroll. */
.grid-wrap :deep(.vgl-item--no-touch) {
  touch-action: pan-y;
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
   full-width card. */
.pinned-anchor :deep(.dashboard-card) {
  width: min(560px, 100%);
  margin: 0 auto calc(var(--space) * 1.5);
}
@media (max-width: 768px) {
  .pinned-anchor :deep(.dashboard-card) {
    width: 100%;
    margin-bottom: calc(var(--space) * 1.5);
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
   affordance rather than a stray box corner.

   B18b — these three `--vgl-resizer-*` values are also the shared "resize
   handle" design tokens DashboardCard.vue's `.pin-resize-handle` reuses (see
   its own CSS doc) so the pinned floating card's resize grip looks and sizes
   IDENTICALLY to every grid card's, instead of the bespoke 90°-corner icon it
   used to draw. grid-layout-plus's own `.vgl-layout{...}` rule sets its OWN
   `--vgl-resizer-size`/`--vgl-resizer-border-color`/`--vgl-resizer-border-
   width` directly on that element, which shadows whatever `.analyzer` would
   otherwise inherit down to it — so the `:deep(.vgl-layout)` overrides below
   stay (they're what the GRID's own resizer actually sees). The pinned card
   lives in `#dashboard-pinned-anchor`, a SIBLING of `.vgl-layout` (see the
   template, above the grid) rather than a descendant of it, so it can't pick
   up those `:deep(.vgl-layout)`-scoped values through inheritance either —
   this second copy on plain `.analyzer` (an ancestor of BOTH the grid and the
   pinned anchor) is what the pinned handle actually inherits. Duplicated
   rather than restructured because overriding a value a descendant element
   re-declares itself isn't expressible as a single CSS custom-property rule. */
.analyzer {
  --vgl-resizer-size: 10px;
  --vgl-resizer-border-color: var(--color-accent);
  --vgl-resizer-border-width: 2px;
}
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
   `no-touch` class — not on the resizer itself, and not for iOS at all).
   B18b — the plain `.analyzer` override (not just `:deep(.vgl-layout)`) is
   what lets the pinned handle grow to the same 30px touch target here too. */
@media (max-width: 768px) {
  .analyzer {
    --vgl-resizer-size: 30px;
  }
  .analyzer :deep(.vgl-layout) {
    --vgl-resizer-size: 30px;
  }
  .analyzer :deep(.vgl-item__resizer) {
    touch-action: none;
  }
}

/* F2 — card-menu 定位 (locate): a brief outline pulse on the card the user
   just jumped to via scrollIntoView (see `locateCard`). Applied imperatively
   (classList.add/remove, not a template binding) since it's a one-shot,
   timer-driven effect rather than persistent state — but this selector still
   lives in AnalyzerView's OWN scoped style block because a parent's scoped
   CSS reaches a directly-instantiated child component's ROOT element (every
   DashboardCard tag here IS such a child), same reasoning as this file's
   other `:deep`-free rules that theme DashboardCard/grid-layout-plus
   elements. `prefers-reduced-motion: reduce` swaps the animated fade for a
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
