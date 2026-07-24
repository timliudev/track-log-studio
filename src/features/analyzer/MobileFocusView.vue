<script setup lang="ts">
/**
 * F5 phase 1 — the mobile "single-focus view": one full-screen visual at a
 * time, chosen via a top tab bar, REPLACING F1's Focus Stack (which stacked
 * several curated cards vertically — see docs/specs/F5-SINGLE-FOCUS-DESIGN.md
 * §1 for why: a tall curated stack still had to scroll, starved the phase-2
 * divider of room to rebalance, and pushed the scrubber off the bottom edge
 * on a many-card stack). Retires MobileFocusStack.vue's divider entirely —
 * there's nothing to divide when only one view renders at a time.
 *
 * AnalyzerView stays the single owner of the visible, ordered id set (`ids` —
 * same source F1's `focusStackIds` was) and of which one is currently shown
 * (`currentViewId`, from useMobileView) — this component only renders the tab
 * bar for that set and the one active body. Tapping a tab is a pure `select`
 * emit; AnalyzerView is the one that persists it (via
 * useMobileView().setCurrentView), same "dumb view, owning composable
 * persists" split MobileScrubber's `scrub` emit already uses for the cursor.
 *
 * Phase 1 was tap-only (§8 of the design doc). Phase 2 (this revision) adds
 * left/right swipe across the body as a SECOND way to switch tabs, opt-in
 * per card id via `consumesHorizontalDrag` — never a blanket "swipe anywhere
 * switches tabs", which would steal the map's own pan and the charts' own
 * zoom/pan (see that predicate's doc in `horizontalGestureCards.ts` for the
 * full accounting of which ids already own a horizontal drag). The tab bar
 * remains the universal, always-available way to switch — swipe is an
 * accelerator on top of it, not a replacement.
 *
 * Gesture shape (touch only — see `onBodyPointerDown`): pointerdown arms
 * tracking only when the CURRENTLY shown id doesn't consume horizontal drag;
 * pointermove resolves 'pending' into either 'horizontal' (commit: capture
 * the pointer, preventDefault so the rest of the drag doesn't also try to
 * become a native gesture) or hands the pointer back to native scroll the
 * moment `pendingTouchIntent` says the motion is dominantly vertical (no
 * further tracking — same "give up early" shape as the chart touch gestures
 * this reuses `pendingTouchIntent` from); pointerup measures net horizontal
 * travel against `SWIPE_TRIGGER_PX` and emits `select` for the next/previous
 * id in `ids` (`resolveSwipeTarget` — no wrap-around past the first/last
 * tab, §7 item 4); pointercancel (OS gesture, unmount, or a second finger
 * arriving mid-drag never restarting tracking) always resets to idle without
 * emitting.
 *
 * Phase 3 (this revision, design doc §8) is polish, not new interaction:
 *  - per-view scroll-position memory (see `scrollPositions` below) — a
 *    single `.focus-view-body` element has its content swapped on every tab
 *    switch, so without this every switch used to reset to the top.
 *  - a scroll "edge fade" on the tab bar (`.focus-tabs-wrap`) so it's
 *    visually obvious there are more tabs off-screen when it's scrollable —
 *    see `computeScrollEdgeFade`. No icon set was added (see that function's
 *    neighbour import comment below) — tab labels stay the existing i18n
 *    `titleFor` strings, unchanged from phase 1.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AnalyzerCardContext } from './analyzerCardContext'
import AnalyzerCardBody from './AnalyzerCardBody.vue'
import { consumesHorizontalDrag } from '@/domain/layout/horizontalGestureCards'
import { pendingTouchIntent, resolveSwipeTarget, SWIPE_SLOP_PX } from '@/domain/layout/mobileSwipeGesture'
import { computeScrollEdgeFade } from '@/domain/layout/scrollEdgeFade'

const props = defineProps<{
  /** Visible card ids in tab order (AnalyzerView's `focusStackIds` —
   *  unchanged from F1: the mobile visible set run through the user's
   *  explicit focus order). */
  ids: string[]
  /** The shared card wiring harness passed straight down to the active body. */
  ctx: AnalyzerCardContext
  /** Card title resolver (AnalyzerView's titleForItemId) — reused verbatim
   *  for tab labels, no new per-card strings needed. */
  titleFor: (id: string) => string
  /** The id AnalyzerView believes is currently selected (from
   *  useMobileView().currentViewId, already reconciled against `ids` there —
   *  but this component defends against a stale value anyway, see
   *  `activeId` below, since the two computeds can be one tick apart). */
  currentViewId: string
}>()

const emit = defineEmits<{
  /** The user tapped a tab — AnalyzerView persists this via
   *  useMobileView().setCurrentView. Emitted even when the tab is already
   *  active (a harmless same-reference no-op downstream, see mobileView.ts's
   *  `setCurrentView`), so this component never needs to know the current
   *  selection to decide whether to emit. */
  select: [id: string]
}>()

const { t } = useI18n()

/** The id to actually render: `currentViewId` if it's still one of `ids`,
 *  else the first id — defensive fallback for a currentViewId that's gone
 *  stale (a chart removed, a card hidden) between AnalyzerView's own
 *  reconciliation and this render, or simply unset (`''`) on first load. */
const activeId = computed<string>(() => {
  if (props.currentViewId && props.ids.includes(props.currentViewId)) return props.currentViewId
  return props.ids[0] ?? ''
})

/** Whether the CURRENTLY shown body already owns a horizontal drag (map/
 *  chart) — drives both the pointerdown gate below and, in the template,
 *  which `touch-action` `.focus-view-body` gets. This has to be dynamic
 *  (not a static class on the wrapper) precisely BECAUSE some bodies (the
 *  echarts scatter/G-G chart) declare no `touch-action` of their own,
 *  relying on the ancestor leaving it at the default `auto` — a blanket
 *  `pan-y` on this wrapper would silently break their touch drag-to-zoom
 *  the moment they became the active view (see `.focus-view-body`'s style
 *  block for the full reasoning, and `horizontalGestureCards.ts` for why the
 *  map is safe regardless: its own canvas already declares `none`). */
const activeConsumesHorizontalDrag = computed(() => consumesHorizontalDrag(activeId.value))

// --- F5 phase 2: swipe-to-switch across `.focus-view-body` ---
// One active touch pointer drives the gesture at a time; `null` = idle.
// `swipeMode` mirrors chartPointerGesture's own shape: 'pending' = inside the
// slop, undecided; 'horizontal' = resolved as a swipe (captured, tracked to
// release). There's no distinct 'scroll' mode to hold onto — the moment
// `pendingTouchIntent` says the motion is dominantly vertical, tracking is
// reset immediately (see `onBodyPointerMove`) and the pointer goes back to
// being just a normal touch the page's own `touch-action: pan-y` scrolls.
const swipePointerId = ref<number | null>(null)
const swipeStart = ref<{ x: number; y: number } | null>(null)
const swipeMode = ref<'pending' | 'horizontal' | null>(null)

function resetSwipe(): void {
  swipePointerId.value = null
  swipeStart.value = null
  swipeMode.value = null
}

function onBodyPointerDown(e: PointerEvent): void {
  // Mouse/pen: tap-only via the tab bar. Unlike most gestures in this
  // codebase (§8 layer 2: pen ≈ mouse), a full-body swipe is deliberately
  // touch-only here — it's a coarse, OS-navigation-shaped gesture (think
  // home-screen paging), and a mouse/pen drag inside the focus view already
  // has an established meaning to preserve (drag-to-select, drag-to-pan on
  // whichever card is shown) with no ambiguity to resolve in swipe's favour.
  // The tab bar is equally reachable by every pointer type, so nothing is
  // lost by restricting the accelerator.
  if (e.pointerType !== 'touch') return
  if (swipePointerId.value !== null) return // a second finger mid-gesture: ignore, don't restart
  if (consumesHorizontalDrag(activeId.value)) return // map/chart already owns this drag — do nothing, let it bubble
  swipePointerId.value = e.pointerId
  swipeStart.value = { x: e.clientX, y: e.clientY }
  swipeMode.value = 'pending'
}

function onBodyPointerMove(e: PointerEvent): void {
  if (e.pointerId !== swipePointerId.value || !swipeStart.value) return
  const current = { x: e.clientX, y: e.clientY }
  if (swipeMode.value === 'pending') {
    const intent = pendingTouchIntent(swipeStart.value, current, SWIPE_SLOP_PX)
    if (intent === 'pending') return
    if (intent === 'scroll') {
      resetSwipe() // vertical: hand back to native pan-y scroll, stop tracking
      return
    }
    swipeMode.value = 'horizontal'
    // currentTarget, not target: the listener is bound directly on
    // `.focus-view-body` itself (no window-level re-dispatch like
    // DashboardCard's drag handlers use), so currentTarget is reliably this
    // wrapper regardless of which nested element the touch actually started
    // on — capturing there keeps every subsequent pointermove/up routed here
    // even if the finger drifts over a child (e.g. a button inside the
    // active card body).
    ;(e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId)
  }
  e.preventDefault()
}

function onBodyPointerUp(e: PointerEvent): void {
  if (e.pointerId !== swipePointerId.value || !swipeStart.value) return
  if (swipeMode.value === 'horizontal') {
    const dx = e.clientX - swipeStart.value.x
    const target = resolveSwipeTarget(props.ids, activeId.value, dx)
    if (target) emit('select', target)
  }
  resetSwipe()
}

function onBodyPointerCancel(e: PointerEvent): void {
  if (e.pointerId !== swipePointerId.value) return
  resetSwipe()
}

// --- F5 phase 3-ish, cheap enough to include now: keep the active tab
// scrolled into view in the horizontally-scrollable tab bar whenever the
// selection changes (tap OR swipe) — otherwise swiping forward repeatedly
// can leave the active tab off the edge of `.focus-tabs`. `tabsRef` is the
// scroll container itself; `data-tab-id` on each button (below) is how the
// right one is found, same "tag with a data attribute, querySelector it"
// shape as AnalyzerView's own `locateCard` (CardMenu 定位). `scrollIntoView`
// isn't implemented in the test environment (happy-dom) — optional-chained
// like every other DOM capability query in this codebase.
const tabsRef = ref<HTMLElement | null>(null)
watch(activeId, async (id) => {
  if (!id) return
  await nextTick()
  const el = tabsRef.value?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)
  el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  // The active tab moving into view can itself change which edge(s) of the
  // (possibly now differently-scrolled) tab bar have more content hidden —
  // recompute the edge fade after it settles.
  updateTabsEdgeFade()
})

// --- F5 phase 3: per-view scroll-position memory ---
// `.focus-view-body` is a SINGLE shared element whose content is swapped
// whenever `activeId` changes (unlike F1's retired stack, which mounted
// every card body at once, so each kept its own permanent scroll position
// for free) — switching away and back used to always land back at the top.
// This restores each view's own offset.
//
// Deliberately IN-MEMORY ONLY (a plain component-local `Map`) — NOT
// persisted via useMobileView/localStorage. These numbers are tied to
// whatever the CURRENT DOM layout happens to be (chart height, lap count,
// how much data is loaded) — meaningless across a reload where nothing has
// rendered yet, and a fundamentally different kind of state from
// `mode`/`focusOrder`/`currentViewId` (durable, cross-session user
// preferences worth persisting). Session-scoped also means it's fine to
// just drop the whole map on a file switch (see the `primaryFileId` watch
// below) rather than needing any migration/versioning story.
const bodyRef = ref<HTMLElement | null>(null)
const scrollPositions = new Map<string, number>()

function saveScrollPosition(id: string): void {
  if (bodyRef.value) scrollPositions.set(id, bodyRef.value.scrollTop)
}

/** Restores `id`'s remembered offset (0 for a never-visited view — a no-op,
 *  since a freshly rendered body already starts at 0). Called from the
 *  `activeId` watcher below, which runs at Vue's default 'pre' flush timing
 *  — i.e. BEFORE the component re-renders — so `nextTick` first: setting
 *  scrollTop immediately would still hit the OUTGOING body, not the
 *  incoming one. One extra `requestAnimationFrame` retry covers card bodies
 *  that lay out asynchronously (charts, the map): if the content isn't tall
 *  enough yet on the very first attempt, the browser silently clamps
 *  scrollTop back toward 0, and a single restore would stick at the wrong
 *  place. Deliberately ONE retry, not a poll loop — this is polish, not
 *  something worth chasing indefinitely. */
async function restoreScrollPosition(id: string): Promise<void> {
  await nextTick()
  const target = scrollPositions.get(id) ?? 0
  const el = bodyRef.value
  if (!el) return
  el.scrollTop = target
  if (target === 0) return // nothing to retry — 0 is always reachable
  requestAnimationFrame(() => {
    if (activeId.value !== id) return // switched away again before the retry fired
    const retryEl = bodyRef.value
    if (retryEl && retryEl.scrollTop !== target) retryEl.scrollTop = target
  })
}

watch(activeId, (newId, oldId) => {
  if (oldId) saveScrollPosition(oldId)
  if (newId) void restoreScrollPosition(newId)
})

// Stale-id cleanup: a card hidden/removed (CardMenu visibility toggle, a
// chart deleted) should drop its remembered offset rather than let the map
// grow forever with ids that can never be revisited.
watch(
  () => props.ids,
  (ids) => {
    const live = new Set(ids)
    for (const id of scrollPositions.keys()) {
      if (!live.has(id)) scrollPositions.delete(id)
    }
  },
)

// Session/file switch: every remembered offset belongs to content that's
// about to be replaced wholesale, so drop the whole map. Cheap to detect —
// `ctx.primaryFileId` is already assembled for other cards — rather than
// plumbing a dedicated "session changed" signal through just for this.
// (Optional-chained: some tests mount with a bare `{}` stub ctx.)
watch(
  () => props.ctx.primaryFileId?.value,
  () => {
    scrollPositions.clear()
  },
)

// --- F5 phase 3: tab bar scroll "edge fade" ---
// Purely visual affordance: when `.focus-tabs` has more tabs scrolled off
// to one side, that edge gets a subtle fade so it reads as "scrollable"
// rather than "this is all of them". See `computeScrollEdgeFade` for the
// arithmetic and `.focus-tabs-wrap`'s style block for the overlay itself.
const canScrollTabsLeft = ref(false)
const canScrollTabsRight = ref(false)

function updateTabsEdgeFade(): void {
  const el = tabsRef.value
  if (!el) {
    canScrollTabsLeft.value = false
    canScrollTabsRight.value = false
    return
  }
  const fade = computeScrollEdgeFade({
    scrollLeft: el.scrollLeft,
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  })
  canScrollTabsLeft.value = fade.canScrollLeft
  canScrollTabsRight.value = fade.canScrollRight
}

// The tab set itself can grow/shrink (cards added/removed, charts added) —
// recompute once the new tab list has actually rendered.
watch(
  () => props.ids,
  async () => {
    await nextTick()
    updateTabsEdgeFade()
  },
)

// Viewport rotation/resize changes how many tabs fit without any of the
// above firing.
function handleWindowResize(): void {
  updateTabsEdgeFade()
}
onMounted(async () => {
  await nextTick()
  updateTabsEdgeFade()
  window.addEventListener('resize', handleWindowResize)
})

// Unmount mid-gesture (e.g. navigating away via BottomNav while a finger is
// still down) must not leave a dangling pointerId around — nothing reads
// these refs once the component is gone, but resetting is cheap and keeps
// the intent of "always end a gesture on cleanup" explicit (same spirit as
// DashboardCard.vue's own drag-teardown handlers).
onBeforeUnmount(() => {
  resetSwipe()
  window.removeEventListener('resize', handleWindowResize)
})
</script>

<template>
  <div class="focus-view">
    <div
      v-if="ids.length > 0"
      class="focus-tabs-wrap"
      :class="{ 'can-scroll-left': canScrollTabsLeft, 'can-scroll-right': canScrollTabsRight }"
    >
      <div
        ref="tabsRef"
        class="focus-tabs"
        role="tablist"
        :aria-label="t('analyzer.mobileView.focusViewTabsAria')"
        @scroll="updateTabsEdgeFade"
      >
        <button
          v-for="id in ids"
          :key="id"
          type="button"
          role="tab"
          class="focus-tab"
          :class="{ active: id === activeId }"
          :aria-selected="id === activeId"
          :data-tab-id="id"
          @click="emit('select', id)"
        >
          {{ titleFor(id) }}
        </button>
      </div>
    </div>
    <div
      ref="bodyRef"
      class="focus-view-body"
      :class="{ 'focus-view-body--swipeable': !activeConsumesHorizontalDrag }"
      @pointerdown="onBodyPointerDown"
      @pointermove="onBodyPointerMove"
      @pointerup="onBodyPointerUp"
      @pointercancel="onBodyPointerCancel"
    >
      <AnalyzerCardBody v-if="activeId" :id="activeId" :ctx="ctx" />
    </div>
  </div>
</template>

<style scoped>
.focus-view {
  display: flex;
  flex-direction: column;
  /* Fill the height AnalyzerView's `.analyzer.focus-mode` hands us (the space
     between the toolbar and BottomNav) — see that class's own comment,
     unchanged from F1. */
  flex: 1;
  min-height: 0;
}
/* F5 phase 3 — scroll "edge fade": a non-scrolling wrapper around the
   actually-scrollable `.focus-tabs`, so the fade overlays below stay
   pinned at the visual edge instead of scrolling away with the tab
   content. `position: relative` here (not on `.focus-tabs` itself) is
   what makes that possible. */
.focus-tabs-wrap {
  position: relative;
  flex: 0 0 auto;
}
.focus-tabs-wrap::before,
.focus-tabs-wrap::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 18px;
  /* Never intercept taps — this is a purely visual affordance, and the real
     tab buttons underneath keep their full §8 44px hit target. */
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.focus-tabs-wrap::before {
  left: 0;
  /* `color-mix` with `--color-text` (not a hardcoded colour) reads as a
     soft vignette in both themes: a dark tint on the light theme's pale
     bg, a light tint on the dark theme's near-black bg — both read as
     "shadow at the edge" without needing a separate dark-mode override. */
  background: linear-gradient(to right, color-mix(in srgb, var(--color-text) 20%, transparent), transparent);
  border-top-left-radius: calc(var(--radius) * 1.5);
  border-bottom-left-radius: calc(var(--radius) * 1.5);
}
.focus-tabs-wrap::after {
  right: 0;
  background: linear-gradient(to left, color-mix(in srgb, var(--color-text) 20%, transparent), transparent);
  border-top-right-radius: calc(var(--radius) * 1.5);
  border-bottom-right-radius: calc(var(--radius) * 1.5);
}
.focus-tabs-wrap.can-scroll-left::before {
  opacity: 1;
}
.focus-tabs-wrap.can-scroll-right::after {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .focus-tabs-wrap::before,
  .focus-tabs-wrap::after {
    transition: none;
  }
}
.focus-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  background: var(--color-border);
}
.focus-tab {
  flex: 0 0 auto;
  /* Segmented-control language mirrored from AnalyzerView's `.xaxis` switch
     (design doc §7) — same colours, same active-state treatment — so the
     tab bar reads as the same kind of control as the rest of the toolbar. */
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  padding: 8px 14px;
  font: inherit;
  font-size: 0.9rem;
  white-space: nowrap;
  cursor: pointer;
}
.focus-tab.active {
  background: var(--color-accent);
  color: var(--color-accent-text);
}
/* §8/B93 — coarse pointers get a real ≥44px tap target; the box itself grows
   (same direct-size-bump pattern as MobileFocusStack's old `.focus-expand`)
   rather than an invisible hit-slop overlay, since a tab's own
   border+background box already reads as its whole hit area. */
:root[data-any-pointer-coarse] .focus-tab {
  min-height: 44px;
}
.focus-view-body {
  flex: 1;
  min-height: 0;
  /* Lets the map's own fill layout and the lap table's internal scroll keep
     working unchanged — same rationale as F1's `.focus-panel-body`. */
  overflow: auto;
}
/* F5 phase 2 — ONLY applied while the active body doesn't already consume
   horizontal drag (see `activeConsumesHorizontalDrag`): vertical scroll
   stays native, horizontal is this component's own swipe gesture to
   resolve. Deliberately NOT unconditional — while the map or a chart is
   active this class is absent and `.focus-view-body` is left at the default
   `auto`, so:
    - TrackMap's own canvas (`touch-action: none`) is unaffected either way
      (intersecting `none` with anything still yields `none`).
    - the echarts scatter/G-G chart (ScatterChart.vue/GgChart.vue) declares
      NO `touch-action` of its own — it relies on the ancestor being `auto`
      for its inside-`dataZoom` touch drag (B46) to work at all. A blanket
      `pan-y` here would silently break that the moment it became the active
      view, which is exactly the failure mode this feature must avoid.
    - the uPlot time-series chart's own wrap already declares `pan-y`
      itself, so this class would be redundant (not harmful) for it anyway —
      it's simply never applied since `chart-*` ids are gated out either way.
*/
.focus-view-body--swipeable {
  touch-action: pan-y;
}
</style>
