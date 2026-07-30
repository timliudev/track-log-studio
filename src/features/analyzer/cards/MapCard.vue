<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type { AnalyzerCardContext } from '../analyzerCardContext'
import TrackMap from '../TrackMap.vue'
import { prefersReducedMotion } from '@/composables/useFlipAnimation'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  playbackDomain,
  advanceByTime,
  clampPosition,
  type PlaybackDomain,
  type PlaybackPosition,
} from '@/domain/analysis/playback'

/**
 * The track-map card body — the ONLY extracted card whose content is more than
 * a single panel component: TrackMap plus the map's own sibling controls
 * (comparison map-align, heatmap legend, line hint, lap count + reset, and the
 * lap-time / lap-distance band inputs). Moved out of AnalyzerView's `#item`
 * slot verbatim (F1), so the map-specific scoped CSS below moved with it — a
 * parent's scoped styles never reach a child component's own template, so the
 * `.tc-legend`/`.band`/`.laps`/`.map-comparison-align`/… selectors have to
 * live here now.
 *
 * ⑤/⑥ — this card also owns the ▶/⏸ playback control (PC + mobile, both use
 * the same card body): pressing it advances the SHARED cursor in real time
 * along the recording's own pacing (rAF + `performance.now()` deltas, via
 * `domain/analysis/playback.ts` — the same shape as the deleted mobile
 * scrubber's play loop, `git show d5d7c2e:src/features/analyzer/
 * MobileScrubber.vue`), so every other card following `cursorIdx` plays along
 * for free. Between whole samples it also writes `cursorFrac`, which ONLY
 * `TrackMap`'s marker reads, so the marker glides instead of hopping between
 * 10Hz GPS fixes. `prefers-reduced-motion` falls back to discrete stepping
 * (frac forced to 0) — no sub-sample animation against that preference.
 *
 * ⑤ follow-up — the button itself is passed into TrackMap's own
 * `overlay-top-right` named slot (rendered inside TrackMap's top-right
 * control row, alongside "reset view") instead of sitting in its own row
 * above the map: this reclaims a full row of vertical space in the card. All
 * playback STATE and the rAF loop stay right here — only the button's DOM
 * location moved, not its ownership.
 */
const props = defineProps<{ ctx: AnalyzerCardContext }>()
const {
  mapMaximized,
  track,
  cursorIdx,
  cursorFrac,
  line,
  highlightLaps,
  comparisonLapHighlights,
  focusRange,
  colorValues,
  trackColormap,
  mapGates,
  allExtremaMarkers,
  overlayTracks,
  heatNorm,
  legendGradient,
  trackChannel,
  laps,
  selectedLaps,
  timeMs,
  xValues,
  excludedCount,
  bandMin,
  bandMax,
  distBandMin,
  distBandMax,
  bandExcludedCount,
  distBandExcludedCount,
  hasLapTimeBand,
  hasLapDistanceBand,
  setCursor,
  setCursorAt,
  setLine,
  onUpdateGate,
  setMapMaximized,
  sessionOffsetOf,
  setComparisonMapOffset,
  resetSessionOffset,
  fmtVal,
  resetLine,
  onBandInput,
  clearLapTimeBand,
  onDistBandInput,
  clearLapDistanceBand,
} = props.ctx

const { t } = useI18n()

// ⑥ (second half) — the track-line smoothing amount is a global appearance
// preference (settingsStore.trackLineSmoothing), same as centreCursorMode's
// wiring in TimeSeriesChart.vue: read here (the card body) and forwarded
// down to TrackMap as a plain prop, rather than TrackMap reading the store
// itself.
const { trackLineSmoothing } = storeToRefs(useSettingsStore())

// --- ⑤/⑥ playback ---------------------------------------------------------

// Real-time-ish playback: plays at 1x against the session's own recorded
// pacing (advanceByTime steps along `timeMs`), matching how the lap actually
// unfolded. A speed control isn't part of this task — intentionally skipped.
const PLAY_SPEED = 1
// Under `prefers-reduced-motion: reduce`, playback still works but steps
// discretely on a fixed interval (frac forced to 0) instead of a continuous
// rAF-driven glide.
const REDUCED_MOTION_STEP_MS = 250

// The selected lap's own span when exactly one lap is selected, else the
// whole session — same domain rule the deleted mobile scrubber used.
const domain = computed<PlaybackDomain | null>(() =>
  playbackDomain(selectedLaps.value, xValues.value?.length ?? 0),
)

const playing = ref(false)
let rafId: number | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let lastFrameTime = 0
let playPos: PlaybackPosition = { idx: 0, frac: 0 }
let reducedMotion = false

/** Where to resume from: the shared cursor (with its current frac) if it's
 *  live, else the domain's own start. */
function currentPosition(d: PlaybackDomain): PlaybackPosition {
  const idx = cursorIdx.value != null ? cursorIdx.value : d.startIdx
  const frac = cursorIdx.value != null ? cursorFrac.value : 0
  return clampPosition(d, { idx, frac })
}

function stepPlay(deltaMs: number): void {
  const d = domain.value
  const tm = timeMs.value
  if (!d || !tm) {
    stopPlay()
    return
  }
  const next = advanceByTime(d, tm, playPos, deltaMs, PLAY_SPEED)
  playPos = next
  setCursorAt(next.idx, reducedMotion ? 0 : next.frac)
  if (next.idx >= d.endIdx) stopPlay()
}

function rafLoop(now: number): void {
  if (!playing.value) return
  const delta = now - lastFrameTime
  lastFrameTime = now
  stepPlay(delta)
  if (playing.value) rafId = requestAnimationFrame(rafLoop)
}

function startPlay(): void {
  const d = domain.value
  if (!d || !timeMs.value || playing.value) return
  playing.value = true
  playPos = currentPosition(d)
  // Already at (or past) the end — restart from the domain start so ▶ reads
  // as "play again" rather than a no-op.
  if (playPos.idx >= d.endIdx) playPos = { idx: d.startIdx, frac: 0 }
  reducedMotion = prefersReducedMotion()
  if (reducedMotion) {
    intervalId = setInterval(() => stepPlay(REDUCED_MOTION_STEP_MS), REDUCED_MOTION_STEP_MS)
  } else {
    lastFrameTime = performance.now()
    rafId = requestAnimationFrame(rafLoop)
  }
}

function stopPlay(): void {
  playing.value = false
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (intervalId != null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function togglePlay(): void {
  if (playing.value) stopPlay()
  else startPlay()
}

// A different lap selection (domain changes) or a different session/track
// loaded — an in-flight loop stepping against a now-stale span is meaningless
// at best, out of bounds at worst.
watch(domain, () => stopPlay())
watch(() => track.value, () => stopPlay())

onBeforeUnmount(() => stopPlay())
</script>

<template>
  <TrackMap
    fill-height
    :maximized="mapMaximized"
    :track="track"
    :cursor-idx="cursorIdx"
    :cursor-frac="cursorFrac"
    :line="line"
    :highlight-laps="highlightLaps"
    :comparison-lap-highlights="comparisonLapHighlights"
    :focus-range="focusRange"
    :color-values="colorValues"
    :colormap="trackColormap"
    :gates="mapGates"
    :extrema-markers="allExtremaMarkers"
    :overlay-tracks="overlayTracks"
    :line-smoothing="trackLineSmoothing"
    @cursor="setCursor"
    @update:line="setLine"
    @update:gate="onUpdateGate"
    @update:maximized="setMapMaximized"
  >
    <template #overlay-top-right>
      <button
        type="button"
        class="play-toggle"
        :disabled="!domain"
        :aria-label="playing ? t('analyzer.mapPause') : t('analyzer.mapPlay')"
        v-tooltip="playing ? t('analyzer.mapPause') : t('analyzer.mapPlay')"
        @click="togglePlay"
      >
        <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <polygon points="6 4 20 12 6 20" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="5" y="4" width="5" height="16" rx="1" />
          <rect x="14" y="4" width="5" height="16" rx="1" />
        </svg>
      </button>
    </template>
  </TrackMap>
  <details v-if="!mapMaximized && overlayTracks.length" class="map-comparison-align">
    <summary>{{ t('analyzer.comparisonMapAlign') }}</summary>
    <div v-for="entry in overlayTracks" :key="entry.id" class="map-offset-row">
      <span class="comparison-swatch" :style="{ background: entry.color }" />
      <span class="comparison-name" :title="entry.label">{{ entry.label }}</span>
      <label>
        {{ t('analyzer.comparisonMapEast') }}
        <input
          type="number"
          step="0.5"
          :value="sessionOffsetOf(entry.id).mapX"
          @change="setComparisonMapOffset(entry.id, 'mapX', $event)"
        />
      </label>
      <label>
        {{ t('analyzer.comparisonMapNorth') }}
        <input
          type="number"
          step="0.5"
          :value="sessionOffsetOf(entry.id).mapY"
          @change="setComparisonMapOffset(entry.id, 'mapY', $event)"
        />
      </label>
      <span>m</span>
      <button
        type="button"
        @click="resetSessionOffset(entry.id, 'mapX'); resetSessionOffset(entry.id, 'mapY')"
      >
        {{ t('analyzer.comparisonReset') }}
      </button>
    </div>
  </details>
  <div v-if="!mapMaximized && heatNorm" class="tc-legend">
    <span class="tc-end">{{ fmtVal(heatNorm.min) }}</span>
    <span class="tc-bar" :style="{ background: legendGradient }" />
    <span class="tc-end">{{ fmtVal(heatNorm.max) }}</span>
    <span class="tc-name">{{ trackChannel }}</span>
  </div>
  <p v-if="!mapMaximized" class="line-hint">{{ t('analyzer.lineHint') }}</p>
  <div v-if="!mapMaximized" class="laps">
    <span class="lap-count">{{
      excludedCount > 0
        ? t('analyzer.lapCountExcluded', { n: laps.length, x: excludedCount })
        : t('analyzer.lapCount', { n: laps.length })
    }}</span>
    <button type="button" class="reset" @click="resetLine">
      {{ t('analyzer.resetLine') }}
    </button>
  </div>
  <div v-if="!mapMaximized" class="band" role="group" :aria-label="t('analyzer.lapBand')">
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
      v-if="hasLapTimeBand"
      type="button"
      class="band-clear"
      @click="clearLapTimeBand()"
    >
      {{ t('analyzer.lapBandClear') }}
    </button>
    <span v-if="bandExcludedCount > 0" class="band-count">
      {{ t('analyzer.lapBandExcluded', { x: bandExcludedCount }) }}
    </span>
  </div>
  <div v-if="!mapMaximized" class="band" role="group" :aria-label="t('analyzer.lapDistanceBand')">
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
      v-if="hasLapDistanceBand"
      type="button"
      class="band-clear"
      @click="clearLapDistanceBand()"
    >
      {{ t('analyzer.lapDistanceBandClear') }}
    </button>
    <span v-if="distBandExcludedCount > 0" class="band-count">
      {{ t('analyzer.lapDistanceBandExcluded', { x: distBandExcludedCount }) }}
    </span>
  </div>
</template>

<style scoped>
/* ⑤ follow-up — play/pause is now passed into TrackMap's own
   `overlay-top-right` slot (see TrackMap.vue's `.map-controls-tr` row), so it
   floats over the map canvas itself instead of occupying a dedicated row in
   this card's layout — reclaiming that vertical space. It's rendered
   unconditionally (not gated by `!mapMaximized` like the rest of this card's
   controls below) so it stays usable both in the normal card layout and in
   the in-card "maximized" state (B7 — maximized never leaves the card or
   covers the viewport; TrackMap's own top-left maximize/close toggle leaves
   the top-right corner free in both states). Sized/coloured to match
   TrackMap's own overlay buttons (`.maximize-toggle`) — same 32px box,
   `--color-surface`/`--color-border`/`var(--radius)` — rather than the
   pill shape this used before it moved onto the map's own imagery. */
.play-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
.play-toggle:hover {
  border-color: var(--color-text-muted);
}
.play-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.play-toggle svg {
  width: 16px;
  height: 16px;
}
/* §8 touch-target convention: grow the hit target to >=44px on coarse
   pointers by writing the :root[...] attribute selector directly (never
   wrapped in the Vue scoped-CSS global-selector escape hatch) — see
   test/lint/scopedCssGlobalBan.test.ts. */
:root[data-any-pointer-coarse] .play-toggle {
  min-width: 44px;
  min-height: 44px;
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
.map-comparison-align {
  margin-top: var(--space);
  padding: 7px 9px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.8rem;
}
.map-comparison-align summary {
  cursor: pointer;
  font-weight: 600;
}
.map-offset-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  padding-top: 7px;
  color: var(--color-text-muted);
}
.map-offset-row label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.map-offset-row input {
  width: 68px;
  padding: 3px 5px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  color: var(--color-text);
}
.map-offset-row button {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 3px 8px;
  font: inherit;
  cursor: pointer;
}
.map-offset-row button:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
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
</style>
