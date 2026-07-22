<script setup lang="ts">
/**
 * F1 phases 1–2 — the mobile "Focus Stack": a short, curated vertical split of
 * the visible cards (RaceChrono-style, e.g. map on top / chart below) shown
 * INSTEAD of the full single-column grid when the mobile view mode is
 * `focus`. It reuses the exact same card content as the grid — each panel is
 * a slim header (title + an "expand to full" affordance) over
 * <AnalyzerCardBody>, WITHOUT any grid drag/resize/gutter chrome (which is
 * what lets it sidestep the B61/B102 gesture races, see the design doc §7).
 *
 * AnalyzerView stays the single source that computes the visible, ordered id
 * set (`ids`) and the per-panel height weight (`weightFor`, from
 * useMobileView) — this component only lays them out. Phase 1 uses fixed
 * proportional weights; panels flex-grow by weight to fill the viewport, and
 * the stack scrolls as a whole once the curated set is taller than one
 * screen (each panel keeping a sensible minimum height), while lists that
 * already scroll internally (the lap table) keep doing so inside their own
 * body.
 *
 * F1 phase 2 — a draggable horizontal divider between each pair of ADJACENT
 * panels rebalances that pair's flex-grow weights LIVE while dragging (their
 * combined weight stays constant — see `onDividerPointerDown`'s doc), and
 * persists both neighbours' new weights on drag end via the `resize` emit.
 * Positioning uses CSS `order` rather than interleaving panels/dividers in
 * the DOM, so the existing panel `v-for` (and its `:key="id"`) is untouched —
 * dividers are a second, appended `v-for` over `dividerPairs`, each given an
 * odd `order` that slots it between its two neighbours' even `order`s.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalyzerCardContext } from './analyzerCardContext'
import AnalyzerCardBody from './AnalyzerCardBody.vue'

const props = defineProps<{
  /** Visible card ids in focus-stack order (AnalyzerView derives this from
   *  useMobileView().focusStackIds over the mobile visible set). */
  ids: string[]
  /** The shared card wiring harness passed straight down to every body. */
  ctx: AnalyzerCardContext
  /** Card title resolver (AnalyzerView's titleForItemId). */
  titleFor: (id: string) => string
  /** Per-panel flex-grow weight (AnalyzerView wires this to
   *  useMobileView().weightFor with a sensible per-card default). */
  weightFor: (id: string) => number
}>()

const emit = defineEmits<{
  /** The user tapped a panel's "expand to full" affordance — AnalyzerView
   *  switches the mobile view mode back to the full dashboard. */
  expand: []
  /** A divider drag ended — the two neighbouring panels' new weights (keyed
   *  by card id), for AnalyzerView to persist via useMobileView().setWeight.
   *  Not emitted for a drag that never actually moved the divider. */
  resize: [weights: Record<string, number>]
}>()

const { t } = useI18n()

// Must match `.focus-panel`'s CSS `min-height: 180px` below — the floor a
// divider drag clamps each neighbour's rendered height to (converted into
// that pair's weight space, see `onDividerPointerDown`).
const FOCUS_PANEL_MIN_HEIGHT_PX = 180

// Elements for the `.focus-panel` sections, in `ids` order — Vue collects a
// `ref` bound inside a `v-for` into an array in render order (see the
// `ref="panelEls"` binding below), so `panelEls.value[i]` is always the panel
// for `ids[i]` as long as both are driven by the same `ids` array.
const panelEls = ref<HTMLElement[]>([])

/** One entry per shared edge between adjacent panels — `dividerPairs[i]` sits
 *  between `ids[i]` and `ids[i+1]`. `index` doubles as both the lookup index
 *  into `panelEls`/`ids` and the divider's own position for the `order`
 *  placement math (see the template). */
const dividerPairs = computed(() =>
  props.ids.slice(0, -1).map((aboveId, index) => ({
    index,
    aboveId,
    belowId: props.ids[index + 1] as string,
    key: `${aboveId}:${props.ids[index + 1]}`,
  })),
)

// Live (not-yet-persisted) weight overrides for the pair currently mid-drag —
// keeps every pointermove purely local/visual instead of writing through
// useMobileView (and localStorage) on every frame; the final values are
// pushed up via `resize` once, on drag end (see `onDividerPointerDown`).
const liveOverride = ref<Record<string, number> | null>(null)
function effectiveWeightFor(id: string): number {
  return liveOverride.value?.[id] ?? props.weightFor(id)
}

const draggingKey = ref<string | null>(null)
let endActiveDrag: (() => void) | null = null

/**
 * Drag model (same window-level-listener + pointer-capture shape
 * AnalyzerView's grid-gutter drag uses, see useGridGutters.ts's
 * `onGutterPointerDown` doc — window-level so the gesture survives the
 * divider's own DOM node re-keying mid-drag): the pair's starting weights and
 * the pair's ACTUAL rendered pixel heights (including each panel's header —
 * i.e. what the user visually sees move) are captured at pointerdown, giving
 * a `pxPerWeight` ratio for that pair. Every subsequent pointermove converts
 * the total pixel delta from the down-point into a weight delta via that
 * ratio (absolute, not incremental — recomputed from the ORIGINAL weights
 * each time, so per-move rounding never compounds) and REBALANCES the pair:
 * `nextAbove + nextBelow` is held equal to the pair's combined starting
 * weight throughout, so growing one shrinks the other by exactly the same
 * amount. Each side is clamped to keep at least `FOCUS_PANEL_MIN_HEIGHT_PX`
 * worth of weight (or, if the pair is currently too short to give both
 * panels that floor, an even 50/50 split instead of a degenerate clamp) so a
 * drag can never weight a panel down to something unusably small. The
 * rebalance is applied live via `liveOverride`; the final pair is only
 * persisted (via `resize`) once, on drag end.
 */
function onDividerPointerDown(
  pair: { index: number; aboveId: string; belowId: string; key: string },
  event: PointerEvent,
): void {
  const aboveEl = panelEls.value[pair.index]
  const belowEl = panelEls.value[pair.index + 1]
  if (!aboveEl || !belowEl) return

  const aboveWeight0 = props.weightFor(pair.aboveId)
  const belowWeight0 = props.weightFor(pair.belowId)
  const pairTotalWeight = aboveWeight0 + belowWeight0
  const pairTotalPx = aboveEl.getBoundingClientRect().height + belowEl.getBoundingClientRect().height
  if (pairTotalWeight <= 0 || pairTotalPx <= 0) return
  const pxPerWeight = pairTotalPx / pairTotalWeight
  const floorWeight = Math.min(FOCUS_PANEL_MIN_HEIGHT_PX / pxPerWeight, pairTotalWeight / 2)
  const loWeight = floorWeight
  const hiWeight = pairTotalWeight - floorWeight

  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
  draggingKey.value = pair.key

  const startY = event.clientY
  const pointerId = event.pointerId
  let finalWeights: { above: number; below: number } | null = null

  function onMove(e: PointerEvent): void {
    const deltaPx = e.clientY - startY
    const deltaWeight = deltaPx / pxPerWeight
    const nextAbove = Math.min(hiWeight, Math.max(loWeight, aboveWeight0 + deltaWeight))
    const nextBelow = pairTotalWeight - nextAbove
    finalWeights = { above: nextAbove, below: nextBelow }
    liveOverride.value = { [pair.aboveId]: nextAbove, [pair.belowId]: nextBelow }
  }

  function endDrag(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return
    target.releasePointerCapture?.(pointerId)
    target.removeEventListener('pointerup', endDrag)
    target.removeEventListener('pointercancel', endDrag)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', endDrag)
    window.removeEventListener('pointercancel', endDrag)
    draggingKey.value = null
    liveOverride.value = null
    endActiveDrag = null
    if (finalWeights) {
      emit('resize', { [pair.aboveId]: finalWeights.above, [pair.belowId]: finalWeights.below })
    }
  }
  target.addEventListener('pointerup', endDrag)
  target.addEventListener('pointercancel', endDrag)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
  endActiveDrag = () => endDrag({ pointerId } as PointerEvent)
}

// Mirrors useGridGutters' #1 fix — force-end an in-flight drag (and its
// window-level listeners) if this component unmounts mid-drag (e.g. the user
// taps "expand to full" while dragging), so no leftover listener/highlight
// can survive past the component's own lifetime.
onBeforeUnmount(() => endActiveDrag?.())
</script>

<template>
  <div class="focus-stack">
    <section
      v-for="(id, index) in ids"
      :key="id"
      ref="panelEls"
      class="focus-panel"
      :style="{ flexGrow: effectiveWeightFor(id), order: index * 2 }"
      :data-card-id="id"
    >
      <header class="focus-panel-header">
        <span class="focus-panel-title">{{ titleFor(id) }}</span>
        <button
          type="button"
          class="focus-expand"
          :title="t('analyzer.mobileView.expandToFull')"
          :aria-label="t('analyzer.mobileView.expandToFull')"
          @click="emit('expand')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </header>
      <div class="focus-panel-body">
        <AnalyzerCardBody :id="id" :ctx="ctx" />
      </div>
    </section>
    <!-- F1 phase 2 — one draggable divider per shared edge between adjacent
         panels, positioned between them via `order` (see the module doc)
         rather than being interleaved into the panel `v-for` above. -->
    <div
      v-for="pair in dividerPairs"
      :key="pair.key"
      class="focus-divider"
      :class="{ dragging: draggingKey === pair.key }"
      :style="{ order: pair.index * 2 + 1 }"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="t('analyzer.mobileView.resizeSplit')"
      @pointerdown="onDividerPointerDown(pair, $event)"
    />
  </div>
</template>

<style scoped>
.focus-stack {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
  /* Fill the height AnalyzerView's `.analyzer.focus-mode` hands us (the space
     between the toolbar and BottomNav) and scroll as a whole when the curated
     set is taller than one screen. */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.focus-panel {
  display: flex;
  flex-direction: column;
  /* min-height:0 lets the body's own scroll take over; the floor keeps a
     many-card stack legible (it scrolls the whole stack instead). */
  min-height: 180px;
  flex-basis: 0;
  flex-shrink: 1;
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  background: var(--color-surface);
  overflow: hidden;
}
/* F1 phase 2 — the draggable divider between adjacent panels. It's a normal
   flex-flow item (not an absolutely-positioned overlay like the desktop
   grid's `.grid-gutter`, see AnalyzerView.vue's B93 rules), so its own box is
   what needs to reach the ≥44px coarse-pointer touch target — a thin visible
   line inside a taller invisible hit area, same B93 intent, simpler
   implementation for this layout. */
.focus-divider {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 14px;
  cursor: row-resize;
  /* The stack itself scrolls vertically (`.focus-stack { overflow-y: auto }`)
     — `none` stops that from stealing a touch drag started on the divider,
     same rationale as B93's coarse-pointer override on `.grid-gutter`, but
     unconditional here since the divider only ever performs a vertical
     drag gesture (there is no "narrow desktop strip that shouldn't claim an
     incidental swipe" case to preserve, unlike the 2-D grid gutter). */
  touch-action: none;
}
.focus-divider::after {
  content: '';
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: var(--color-border);
  transition: background-color 0.1s ease;
}
.focus-divider:hover::after,
.focus-divider.dragging::after {
  background: var(--color-accent);
}
:root[data-any-pointer-coarse] .focus-divider {
  height: 44px;
}
.focus-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
}
.focus-panel-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.focus-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
.focus-expand svg {
  width: 16px;
  height: 16px;
}
.focus-expand:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.focus-panel-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow: auto;
}
</style>
