/**
 * F1 — the single typed "wiring harness" every analyzer dashboard card body
 * reads from. Historically each card's content lived INLINE inside
 * AnalyzerView's big `#item` v-if/else-if chain, so each branch pulled
 * whatever it needed straight out of AnalyzerView's setup scope. Extracting
 * those bodies into standalone components (`cards/*.vue`) — so the SAME card
 * content can render either inside the desktop grid OR inside the mobile
 * Focus Stack (MobileFocusStack.vue) — needs one explicit contract for "all
 * the reactive data + handlers a card can reach", assembled ONCE in
 * AnalyzerView and passed down through the dispatcher (AnalyzerCardBody.vue).
 *
 * Every reactive VALUE is a `Ref` (a `ComputedRef`/`WritableComputedRef` is a
 * `Ref`, so the assembling side can hand over computeds/store refs unchanged —
 * we deliberately do NOT unwrap/clone the reactivity away). Cards destructure
 * the fields they use in `<script setup>`, so the template auto-unwraps them
 * exactly as if they were locally-declared refs. Every callback/handler
 * travels as a plain function on this same object (per the F1 design's
 * "functions-on-ctx is cleanest given the volume" note), so a card never has
 * to re-emit through the dispatcher.
 */
import type { Ref } from 'vue'
import type { LogSession } from '@/domain/model/LogSession'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from '@/domain/analysis/laps'
import type { AccelSegment } from '@/domain/analysis/accelTest'
import type { ChannelExtremum } from '@/domain/analysis/cornerSpeed'
import type { ColormapId } from '@/domain/analysis/colormap'
import type { TrackOverlayEntry } from '@/domain/analysis/trackOverlay'
import type { TrackDefinitionV1 } from '@/domain/tracks/schema'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import type { ChartConfig } from '@/stores/analyzerStore'

/** One selected-lap map highlight (see TrackMap's `highlightLaps` prop). */
export interface HighlightLap {
  startIdx: number
  endIdx: number
  color: string
  offset?: { x: number; y: number }
}

/** One cross-file selected-lap map highlight (see TrackMap's
 *  `comparisonLapHighlights` prop). */
export interface ComparisonLapHighlight {
  track: GpsTrack
  startIdx: number
  endIdx: number
  color: string
  offset?: { x: number; y: number }
}

/** One track-map extrema marker (see TrackMap's `extremaMarkers` prop). */
export interface ExtremaMarker {
  lat: number
  lon: number
  value: number
  valueFrac: number
  kind: 'min' | 'max'
  label: string
}

/** One COMPARISON lap's row in the map-align panel (#9 comparison half) —
 *  see AnalyzerView's `comparisonAlignLaps` computed for how these are
 *  resolved/filtered. */
export interface ComparisonAlignLap {
  fileId: number
  index: number
  label: string
  color: string
}

export interface AnalyzerCardContext {
  // --- shared session/track/axis data (many cards) ---
  session: Ref<LogSession | null>
  track: Ref<GpsTrack | null>
  xValues: Ref<Float64Array | null>
  xRange: Ref<{ min: number; max: number } | null>
  cursorIdx: Ref<number | null>
  laps: Ref<Lap[]>
  timeMs: Ref<Float64Array | null>
  selectedLaps: Ref<Lap[]>
  hasEcuLaps: Ref<boolean>
  comparisonSessions: Ref<ComparisonSession[]>
  primaryFileId: Ref<number | null>
  primaryFileName: Ref<string>

  // --- charts (dispatcher resolves a `chart-<id>` item id to its config) ---
  charts: Ref<ChartConfig[]>

  // --- map card ---
  mapMaximized: Ref<boolean>
  line: Ref<LapLine | null>
  highlightLaps: Ref<HighlightLap[]>
  comparisonLapHighlights: Ref<ComparisonLapHighlight[]>
  comparisonAlignLaps: Ref<ComparisonAlignLap[]>
  focusRange: Ref<{ startIdx: number; endIdx: number } | null>
  colorValues: Ref<Float64Array | null>
  trackColormap: Ref<ColormapId>
  mapGates: Ref<{ line: LapLine; confirmed: boolean }[]>
  allExtremaMarkers: Ref<ExtremaMarker[]>
  overlayTracks: Ref<TrackOverlayEntry[]>
  heatNorm: Ref<{ min: number; max: number } | null>
  legendGradient: Ref<string>
  trackChannel: Ref<string | null>
  excludedCount: Ref<number>
  hasLapTimeBand: Ref<boolean>
  hasLapDistanceBand: Ref<boolean>
  bandMin: Ref<number | null>
  bandMax: Ref<number | null>
  distBandMin: Ref<number | null>
  distBandMax: Ref<number | null>
  bandExcludedCount: Ref<number>
  distBandExcludedCount: Ref<number>

  // --- sectors card ---
  sectorFailureCount: Ref<number>
  sectorAllFailed: Ref<boolean>

  // --- track-channel card ---
  channelOptions: Ref<{ name: string; description?: string }[]>
  trackExtrema: Ref<ChannelExtremum[] | null>
  trackChannelChosen: Ref<boolean>

  // --- accel-test card ---
  accelResults: Ref<AccelSegment[]>
  speedAvailable: Ref<boolean>

  // --- track-file (setup) card ---
  ambiguousMatches: Ref<TrackDefinitionV1[] | null>
  appliedSharedTrack: Ref<TrackDefinitionV1 | null>

  // --- handlers / actions (functions, not refs) ---
  setCursor: (index: number | null) => void
  setLine: (line: LapLine) => void
  onUpdateGate: (index: number, line: LapLine) => void
  setMapMaximized: (value: boolean) => void
  sessionOffsetOf: (id: number) => { mapX: number; mapY: number }
  setComparisonMapOffset: (id: number, axis: 'mapX' | 'mapY', event: Event) => void
  resetSessionOffset: (id: number, axis: 'mapX' | 'mapY') => void
  fmtVal: (value: number) => string
  resetLine: () => void
  onBandInput: (which: 'min' | 'max', event: Event) => void
  clearLapTimeBand: () => void
  onDistBandInput: (which: 'min' | 'max', event: Event) => void
  clearLapDistanceBand: () => void
  onLapSelect: (index: number | null) => void
  onAccelFocus: (segment: AccelSegment) => void
  onAccelClear: () => void
  onXZoom: (range: { min: number; max: number } | null) => void
  chooseTrack: (track: TrackDefinitionV1) => void
  dismissAmbiguous: () => void
  detachFromSharedTrack: () => void
}
