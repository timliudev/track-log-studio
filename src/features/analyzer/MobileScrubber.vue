<script setup lang="ts">
/**
 * F1 phases 3-4 — the mobile Focus Stack's shared bottom time-scrubber (see
 * docs/specs/F1-MOBILE-STACK-DESIGN.md §5/§6/§10). A persistent bar rendered
 * ONLY in focus mode (AnalyzerView `v-if="showFocusStack"`, alongside
 * `MobileFocusStack`), pinned directly below the stack — `.analyzer.focus-mode`
 * already fills the space between the toolbar and the fixed BottomNav (see
 * that file's own comment), so this component just needs to be a normal
 * `flex: 0 0 auto` flex child after the (flex:1, scrollable) stack; no fixed
 * positioning or manual `--bottom-nav-height` math is needed here.
 *
 * Cursor sync is REUSE, not new state (§6): the thumb's position is a
 * DERIVED view of the `cursorIdx` prop (AnalyzerView passes
 * `analyzer.cursorIdx` straight through), and dragging emits `scrub` with a
 * SESSION SAMPLE INDEX for AnalyzerView to feed into `analyzer.setCursor` —
 * the exact same signal the track map / B31 needle already publish. Every
 * other consumer (including overlay charts, via `TimeSeriesChart.vue`'s
 * EXISTING `effectiveCursor` reverse-link) already follows `cursorIdx` for
 * free, so this component never touches `overlayCursorIdx` itself. Because
 * the thumb is purely `computed` off the `cursorIdx` prop (never watched to
 * re-emit), there's no feedback loop to guard against structurally: this
 * component only ever emits `scrub` from a direct user gesture (pointer drag,
 * keyboard step) or its own play loop, never in reaction to `cursorIdx`
 * changing.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { prefersReducedMotion } from '@/composables/useFlipAnimation'
import { formatLapTime } from '@/domain/analysis/format'
import {
  clampToDomain,
  fractionToSampleIndex,
  sampleIndexToFraction,
  elapsedMsInDomain,
  domainDurationMs,
  advanceByTime,
  type ScrubberDomain,
} from '@/domain/analysis/scrubber'

const props = defineProps<{
  /** The scrub domain — a selected lap's own span, or the full session; see
   *  `scrubberDomain()`. `null` disables the control (no session/samples). */
  domain: ScrubberDomain | null
  /** The session's millisecond time axis (same array `useLaps().timeMs`
   *  exposes), for the `m:ss.mmm` readout and the play loop's real-time
   *  pacing. */
  timeMs: Float64Array | null
  /** The shared session-sample-index cursor (`analyzerStore.cursorIdx`). The
   *  thumb's position is derived from this — see the module doc. */
  cursorIdx: number | null
}>()

const emit = defineEmits<{
  /** A new session sample index from a drag/keyboard step/play tick.
   *  AnalyzerView forwards this straight into `analyzer.setCursor`. */
  scrub: [index: number]
}>()

const { t } = useI18n()

// Real-time-ish playback: the domain plays at 1x against the session's own
// recorded pacing (advanceByTime steps along `timeMs`), matching how a real
// lap would unfold. A speed control is a clean later add (design doc §5/§10),
// intentionally skipped for v1.
const PLAY_SPEED = 1
// Under `prefers-reduced-motion: reduce`, playback still works but steps
// discretely on a fixed interval instead of a continuous rAF loop — the
// simplest compliant behaviour (no smooth per-frame animation against the
// user's stated preference).
const REDUCED_MOTION_STEP_MS = 250

/** The position to show/scrub from when there's no live cursor yet (nothing
 *  hovered anywhere): the domain's own start. */
const effectiveIdx = computed<number>(() => {
  const d = props.domain
  if (!d) return 0
  return props.cursorIdx != null ? clampToDomain(d, props.cursorIdx) : d.startIdx
})

const fraction = computed<number>(() => (props.domain ? sampleIndexToFraction(props.domain, effectiveIdx.value) : 0))

const readout = computed<string>(() => {
  const d = props.domain
  if (!d) return formatLapTime(0)
  const ms = elapsedMsInDomain(d, props.timeMs, effectiveIdx.value)
  return formatLapTime(ms ?? 0)
})

const totalLabel = computed<string>(() => {
  const d = props.domain
  if (!d) return formatLapTime(0)
  const ms = domainDurationMs(d, props.timeMs)
  return formatLapTime(ms ?? 0)
})

const disabled = computed(() => props.domain == null || props.timeMs == null)

// --- drag-to-scrub -----------------------------------------------------

const trackEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
let endActiveDrag: (() => void) | null = null

function fractionFromClientX(clientX: number): number | null {
  const el = trackEl.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return null
  return (clientX - rect.left) / rect.width
}

function scrubToClientX(clientX: number): void {
  const d = props.domain
  if (!d) return
  const f = fractionFromClientX(clientX)
  if (f == null) return
  emit('scrub', fractionToSampleIndex(d, f))
}

/** Pointer drag on the track — one gesture for touch/mouse/pen (§8 input
 *  policy), window-level listeners + pointer capture so the drag survives
 *  moving outside the track's own bounds (same shape as MobileFocusStack's
 *  divider drag / useGridGutters' gutter drag). */
function onTrackPointerDown(event: PointerEvent): void {
  if (!props.domain) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
  const pointerId = event.pointerId
  dragging.value = true
  scrubToClientX(event.clientX)

  function onMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return
    scrubToClientX(e.clientX)
  }
  function endDrag(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return
    target.releasePointerCapture?.(pointerId)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
    dragging.value = false
    endActiveDrag = null
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  endActiveDrag = () => endDrag({ pointerId } as PointerEvent)
}

function onTrackKeydown(event: KeyboardEvent): void {
  const d = props.domain
  if (!d) return
  const cur = effectiveIdx.value
  let next: number | null = null
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = clampToDomain(d, cur - 1)
  else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = clampToDomain(d, cur + 1)
  else if (event.key === 'Home') next = d.startIdx
  else if (event.key === 'End') next = d.endIdx
  if (next == null) return
  event.preventDefault()
  emit('scrub', next)
}

// --- play / auto-advance (phase 4) --------------------------------------

const playing = ref(false)
let playCursor = 0
let rafId: number | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let lastFrameTime = 0

function stepPlay(deltaMs: number): void {
  const d = props.domain
  const tm = props.timeMs
  if (!d || !tm) {
    stopPlay()
    return
  }
  const next = advanceByTime(d, tm, playCursor, deltaMs, PLAY_SPEED)
  playCursor = next
  emit('scrub', next)
  if (next >= d.endIdx) stopPlay()
}

function rafLoop(now: number): void {
  if (!playing.value) return
  const delta = now - lastFrameTime
  lastFrameTime = now
  stepPlay(delta)
  if (playing.value) rafId = requestAnimationFrame(rafLoop)
}

function startPlay(): void {
  const d = props.domain
  if (!d || !props.timeMs || playing.value) return
  playing.value = true
  playCursor = effectiveIdx.value
  // Already at (or past) the end — restart from the domain start so ▶ reads
  // as "play again" rather than a no-op.
  if (playCursor >= d.endIdx) playCursor = d.startIdx
  if (prefersReducedMotion()) {
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

// Stop playback if the domain itself changes (a different lap selected, or
// the session/domain otherwise goes away) — an in-flight play loop stepping
// against a now-stale domain would be meaningless at best, out of bounds at
// worst.
watch(
  () => props.domain,
  () => stopPlay(),
)

// Unmounting (leaving focus mode, or the whole analyzer tab) always stops any
// in-flight play loop / pointer drag — same cleanup discipline as
// MobileFocusStack's divider drag.
onBeforeUnmount(() => {
  stopPlay()
  endActiveDrag?.()
})
</script>

<template>
  <div class="scrubber" :class="{ disabled }">
    <button
      type="button"
      class="scrubber-play"
      :disabled="disabled"
      :aria-label="playing ? t('analyzer.mobileView.scrubberPause') : t('analyzer.mobileView.scrubberPlay')"
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

    <div class="scrubber-main">
      <div
        ref="trackEl"
        class="scrubber-track"
        role="slider"
        :aria-label="t('analyzer.mobileView.scrubberAria')"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-valuenow="Math.round(fraction * 100)"
        :aria-disabled="disabled"
        :tabindex="disabled ? -1 : 0"
        @pointerdown="onTrackPointerDown"
        @keydown="onTrackKeydown"
      >
        <div class="scrubber-fill" :style="{ width: `${fraction * 100}%` }" />
        <div class="scrubber-thumb" :class="{ dragging }" :style="{ left: `${fraction * 100}%` }" />
      </div>
      <div class="scrubber-readout">
        <span class="scrubber-time">{{ readout }}</span>
        <span class="scrubber-total">/ {{ totalLabel }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scrubber {
  display: flex;
  align-items: center;
  gap: calc(var(--space) * 1.5);
  flex: 0 0 auto;
  padding: 8px 4px;
}
.scrubber.disabled {
  opacity: 0.5;
}
.scrubber-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  padding: 0;
  color: var(--color-text);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  cursor: pointer;
}
.scrubber-play:disabled {
  cursor: not-allowed;
}
.scrubber-play svg {
  width: 18px;
  height: 18px;
}
:root[data-any-pointer-coarse] .scrubber-play {
  width: 44px;
  height: 44px;
}
.scrubber-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scrubber-track {
  position: relative;
  height: 20px;
  display: flex;
  align-items: center;
  /* One touch/mouse/pen drag gesture (§8) — `none` so a drag started on the
     track never gets stolen by the page's own vertical scroll. */
  touch-action: none;
  cursor: pointer;
}
.scrubber-track::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--color-border);
}
.scrubber-fill {
  position: absolute;
  left: 0;
  height: 4px;
  border-radius: 999px;
  background: var(--color-accent);
  pointer-events: none;
}
.scrubber-thumb {
  position: absolute;
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--color-accent);
  border: 2px solid var(--color-surface);
  box-shadow: 0 0 0 1px var(--color-border);
  pointer-events: none;
}
.scrubber-thumb.dragging {
  transform: translate(-50%, -50%) scale(1.15);
}
/* Coarse-pointer (touch) hit target: the visible thumb stays 16px, but the
   track's own effective touch height grows to the 44px minimum (same B93
   intent as MobileFocusStack's divider) — a taller invisible hit area around
   a slim visible line/thumb, rather than an oversized visible control. */
:root[data-any-pointer-coarse] .scrubber-track {
  height: 44px;
}
.scrubber-readout {
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
}
.scrubber-time {
  color: var(--color-text);
  font-weight: 600;
}
.scrubber-total {
  color: var(--color-text-muted);
}
</style>
