<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PIN_FLIP_EASING } from '@/domain/layout/flip'
import { playFlipTransition, prefersReducedMotion, useAutoFlip } from '@/composables/useFlipAnimation'

/**
 * #8/#9 — one grid item's visual chrome on the analyzer dashboard: a header
 * bar (title + collapse/pin toggles + optional extra actions in the
 * `actions` slot) that is the ONLY drag handle for its GridItem (see
 * AnalyzerView's `drag-handle` class wired into GridLayout's
 * `dragAllowFrom`), and a scrollable body below it that fills the remaining
 * grid-item height — so content taller than the card (e.g. the lap table)
 * scrolls internally instead of pushing the grid item's own height around.
 *
 * Content interactions (canvas pan/zoom, table row clicks, form inputs, …)
 * must NOT start a drag — restricting the draggable region to this header
 * (rather than the whole card) is what makes that possible without each
 * child component needing to know about the grid at all.
 *
 * #9 — collapse (chevron) hides the BODY only, at every breakpoint, while
 * leaving the card's own grid slot (x/y/w/h) untouched: the alternative
 * (shrinking the GridItem's own `h` to a header-height value) would need to
 * remember + restore a "pre-collapse height" and would fight grid-layout-
 * plus's own vertical-compaction pass moving OTHER items into the reclaimed
 * space on every collapse/expand — body-hide sidesteps both problems.
 *
 * 釘選 (pin) — redesigned to work at BOTH breakpoints (previously mobile-only,
 * CSS `position: sticky`, which only worked because mobile's single-column
 * layout is normal document flow; desktop's grid items are absolutely
 * positioned via CSS transforms, where `position: sticky` does nothing).
 * Pin is now purely a "which card is this" flag: `pinned` only drives this
 * component's OWN chrome (button active-state, `.pinned` size/shadow
 * styling) — the actual sticky-while-scrolling behaviour lives one level up,
 * in AnalyzerView, which Teleports a pinned card's markup out of the grid
 * into a single sticky anchor and leaves an empty placeholder in the card's
 * original grid slot (so the layout doesn't jump). This component has no
 * idea whether it's currently rendering inside the grid or inside that
 * anchor — same props/emits either way, which is what makes the Teleport
 * possible without DashboardCard itself changing. Only one card may be
 * pinned at a time (enforced by panelState.ts's togglePinned, documented via
 * the pin button's own tooltip) rather than supporting a multi-pin stack.
 *
 * #19 — the Teleport move itself is otherwise an instant DOM jump (Vue's own
 * `<Transition>` can't help here — see flip.ts's module doc for why), so
 * `onTogglePinned` below hand-animates it with FLIP: measure this card's rect
 * synchronously BEFORE emitting (still at its pre-toggle position), then
 * once Vue has relocated it (`nextTick`), invert from the new rect back to
 * the old one and transition to identity — the card visibly slides (and, if
 * its size also changed, resizes) between the grid slot and the pinned
 * anchor instead of teleporting instantly. Skipped entirely under
 * `prefers-reduced-motion: reduce`.
 *
 * #20 — two more instant-jump spots, now smoothed the same way:
 *  - Collapse/expand's own height change (the BODY hide/show — see #9's note
 *    above; the card's grid slot itself still doesn't move, only the body's
 *    own visible height does) is animated via the `<Transition>` JS hooks
 *    below (`onBodyEnter`/`onBodyLeave`), rather than the instant `v-if`
 *    mount/unmount this had before.
 *  - Any OTHER cause of this card's grid slot moving — grid-layout-plus's
 *    compaction settling after a drag/resize/delete, or a breakpoint switch —
 *    is picked up generically by `useAutoFlip` (see useFlipAnimation.ts's
 *    module doc): it watches this card's own `.vgl-item` parent for the
 *    library rewriting its position/size, and FLIP-animates the move the
 *    same way #19's pin-toggle does. It's turned OFF while `pinned` (the
 *    Teleport move above already animates that case explicitly; running
 *    both here would double-animate the same transform).
 */
const props = defineProps<{
  title: string
  collapsed?: boolean
  pinned?: boolean
  /** #18 fix — the card's own grid slot width/height RATIO (in grid units,
   *  i.e. `layout item.w / item.h`), used ONLY while `pinned` to size the
   *  floating card so it keeps roughly the same shape it had in the grid
   *  instead of every pinned card being squashed into the same fixed
   *  `max-height: 45vh` regardless of whether it was originally short-and-
   *  wide (a control panel) or tall-and-narrow (a chart). Optional: when
   *  omitted (or not finite), falls back to the old fixed-height behaviour —
   *  see the `.pinned` CSS below. */
  aspectRatio?: number
}>()

const emit = defineEmits<{
  (e: 'update:collapsed', value: boolean): void
  (e: 'update:pinned', value: boolean): void
}>()

const { t } = useI18n()

// #19 — FLIP transition for the pin/unpin Teleport move (see flip.ts's
// module doc for why this can't just be a `<Transition>` around the
// `<Teleport>`, and for the maths this delegates to). `rootEl` is the same
// physical DOM node whether it's currently rendered in the grid slot or
// inside #dashboard-pinned-anchor — Teleport relocates it, never remounts
// it, so one ref keeps working across the move. Declared here (rather than
// just above `onTogglePinned` below) because B18's resize handle also reads
// it, above that.
const rootEl = ref<HTMLElement | null>(null)

// B18 — pinned cards can be resized by dragging a corner handle (see
// `.pin-resize-handle` below). This is DELIBERATELY separate from
// grid-layout-plus's own drag/resize (dashboardLayout.ts's isItemResizable
// still returns false while pinned): a pinned card's real content has been
// Teleported OUT of the grid into AnalyzerView's sticky pinned anchor (see
// this component's module doc), so its grid slot is just an inert
// placeholder — the grid library has nothing meaningful to resize there.
// This handle instead resizes the ACTUAL floating card directly, in plain
// pixels, independent of the grid's column/row units. A collapsed card has
// no body to make bigger, so the handle only shows while `!collapsed` — the
// existing "collapsed cards aren't resizable" rule is preserved.
const PINNED_MIN_W = 220
const PINNED_MIN_H = 140
const PINNED_MAX_W_VW = 96
const PINNED_MAX_H_VH = 90
const pinnedSize = ref<{ w: number; h: number } | null>(null)

function clampPinnedSize(w: number, h: number): { w: number; h: number } {
  const maxW = (window.innerWidth * PINNED_MAX_W_VW) / 100
  const maxH = (window.innerHeight * PINNED_MAX_H_VH) / 100
  return {
    w: Math.min(Math.max(w, PINNED_MIN_W), Math.max(maxW, PINNED_MIN_W)),
    h: Math.min(Math.max(h, PINNED_MIN_H), Math.max(maxH, PINNED_MIN_H)),
  }
}

let pinResizeStart: { x: number; y: number; w: number; h: number } | null = null

function onPinResizePointerDown(e: PointerEvent): void {
  const el = rootEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  pinResizeStart = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  window.addEventListener('pointermove', onPinResizePointerMove)
  window.addEventListener('pointerup', onPinResizePointerUp)
}
function onPinResizePointerMove(e: PointerEvent): void {
  if (!pinResizeStart) return
  const dx = e.clientX - pinResizeStart.x
  const dy = e.clientY - pinResizeStart.y
  pinnedSize.value = clampPinnedSize(pinResizeStart.w + dx, pinResizeStart.h + dy)
}
function onPinResizePointerUp(): void {
  pinResizeStart = null
  window.removeEventListener('pointermove', onPinResizePointerMove)
  window.removeEventListener('pointerup', onPinResizePointerUp)
}
/** Double-clicking the handle drops the manual size and reverts to the
 *  automatic aspect-ratio sizing — an easy way back after an experimental drag. */
function onPinResizeReset(): void {
  pinnedSize.value = null
}

// Only feed a POSITIVE finite ratio through to CSS — an unset/zero/NaN
// aspectRatio (e.g. a card whose layout entry momentarily has h:0) must not
// produce an invalid `aspect-ratio: NaN` or a divide-by-zero shape.
const cardStyle = computed(() => {
  if (!props.pinned) return undefined
  if (pinnedSize.value) {
    // A user-dragged size overrides both the aspect-ratio default AND the
    // `.pinned` CSS rule's `max-height: 45vh` / the anchor's `width:
    // min(560px, 100%)` cap — clampPinnedSize already bounds it sensibly, so
    // those class-level ceilings would otherwise silently fight this.
    return {
      width: `${pinnedSize.value.w}px`,
      height: `${pinnedSize.value.h}px`,
      maxWidth: 'none',
      maxHeight: 'none',
    }
  }
  if (props.aspectRatio != null && Number.isFinite(props.aspectRatio) && props.aspectRatio > 0) {
    return { aspectRatio: String(props.aspectRatio) }
  }
  return undefined
})

function onToggleCollapsed(): void {
  emit('update:collapsed', !props.collapsed)
}

let cleanupPinFlip: (() => void) | null = null

function onTogglePinned(): void {
  const el = rootEl.value
  const before = el && !prefersReducedMotion() ? el.getBoundingClientRect() : null
  emit('update:pinned', !props.pinned)
  if (el && before) {
    void nextTick(() => {
      cleanupPinFlip?.()
      cleanupPinFlip = playFlipTransition(el, before)
    })
  }
}

// #20 — generic FLIP for any OTHER cause of this card's grid slot moving
// (compaction settle, drag/resize settle, delete-compaction, breakpoint
// switch) — see useFlipAnimation.ts's module doc. Disabled while pinned: the
// Teleport move above is already animated explicitly, and the pinned anchor
// isn't part of the compacted grid anyway.
useAutoFlip(rootEl, { enabled: computed(() => !props.pinned) })

// #20 — smooth height transition for the collapse/expand body hide/show
// (the card's own grid slot doesn't move — see #9's note — only the body's
// visible height does). Kept as JS `<Transition>` hooks (rather than a pure-
// CSS max-height trick) so the animated height is always the CONTENT's real
// `scrollHeight`, not a guessed/fixed cap. `:css="false"` on the `<Transition>`
// in the template opts out of Vue's own CSS-class-based end detection since
// this hand-rolls it (transitionend + a timeout fallback), matching #19's
// choreography. Skipped entirely under `prefers-reduced-motion: reduce`.
const BODY_TRANSITION_DURATION_MS = 220

function animateBodyHeight(el: HTMLElement, from: number, to: number, done: () => void): void {
  if (prefersReducedMotion()) {
    done()
    return
  }
  // Flex items along the flex-direction's main axis (here: `.body`'s own
  // `flex: 1 1 auto` inside `.dashboard-card`'s column flex) grow/shrink to
  // fill available space regardless of an inline `height` — override that
  // for the DURATION of the animation so the explicit height actually takes
  // visual effect; `onBodyAfterTransition` restores the CSS class's rule.
  el.style.flex = '0 0 auto'
  el.style.overflow = 'hidden'
  el.style.height = `${from}px`
  void el.offsetHeight
  el.style.transition = `height ${BODY_TRANSITION_DURATION_MS}ms ${PIN_FLIP_EASING}`
  el.style.height = `${to}px`

  function onTransitionEnd(e: TransitionEvent): void {
    if (e.target === el && e.propertyName === 'height') finish()
  }
  function finish(): void {
    el.removeEventListener('transitionend', onTransitionEnd)
    done()
  }
  el.addEventListener('transitionend', onTransitionEnd)
  // Belt-and-braces: guarantee `done()` even if `transitionend` never fires
  // (e.g. the element is removed mid-animation, or a test environment with
  // no real layout engine never dispatches a genuine transition event).
  setTimeout(finish, BODY_TRANSITION_DURATION_MS + 100)
}

function onBodyEnter(el: Element, done: () => void): void {
  const body = el as HTMLElement
  animateBodyHeight(body, 0, body.scrollHeight, done)
}
function onBodyLeave(el: Element, done: () => void): void {
  const body = el as HTMLElement
  animateBodyHeight(body, body.scrollHeight, 0, done)
}
/** Common `@after-enter`/`@after-leave`/`@enter-cancelled`/`@leave-cancelled`
 *  cleanup: release every inline style the animation above set, so the CSS
 *  class rules (`flex: 1 1 auto`, `overflow: auto`) govern again once the
 *  body is at its natural resting state. */
function onBodyAfterTransition(el: Element): void {
  const body = el as HTMLElement
  body.style.flex = ''
  body.style.overflow = ''
  body.style.height = ''
  body.style.transition = ''
}

onBeforeUnmount(() => {
  cleanupPinFlip?.()
  // Belt-and-braces: a card can be unmounted (or unpinned mid-drag by some
  // other interaction) while a resize gesture is in flight — these listeners
  // are on `window`, not this component's own DOM, so Vue's own teardown
  // would never remove them on its own.
  window.removeEventListener('pointermove', onPinResizePointerMove)
  window.removeEventListener('pointerup', onPinResizePointerUp)
})
</script>

<template>
  <div ref="rootEl" class="dashboard-card" :class="{ pinned, collapsed }" :style="cardStyle">
    <header class="drag-handle">
      <span class="title">{{ title }}</span>
      <span class="actions">
        <slot name="actions" />
        <button
          type="button"
          class="icon-btn pin-btn"
          :class="{ active: pinned }"
          v-tooltip="pinned ? t('analyzer.layout.unpin') : t('analyzer.layout.pin')"
          :aria-label="pinned ? t('analyzer.layout.unpin') : t('analyzer.layout.pin')"
          :aria-pressed="pinned"
          @click="onTogglePinned"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 17v5" />
            <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
          </svg>
        </button>
        <button
          type="button"
          class="icon-btn collapse-btn"
          :class="{ collapsed }"
          v-tooltip="collapsed ? t('analyzer.layout.expand') : t('analyzer.layout.collapse')"
          :aria-label="collapsed ? t('analyzer.layout.expand') : t('analyzer.layout.collapse')"
          :aria-expanded="!collapsed"
          @click="onToggleCollapsed"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </span>
    </header>
    <Transition
      :css="false"
      @enter="onBodyEnter"
      @leave="onBodyLeave"
      @after-enter="onBodyAfterTransition"
      @after-leave="onBodyAfterTransition"
      @enter-cancelled="onBodyAfterTransition"
      @leave-cancelled="onBodyAfterTransition"
    >
      <div v-if="!collapsed" class="body">
        <slot />
      </div>
    </Transition>
    <!-- B18 — pinned-card resize handle: only while pinned (nothing to
         resize otherwise) and not collapsed (a header-only card has no body
         to grow — see this handle's module doc above `pinnedSize`). -->
    <div
      v-if="pinned && !collapsed"
      class="pin-resize-handle"
      v-tooltip="t('analyzer.layout.pinnedResizeHandle')"
      :aria-label="t('analyzer.layout.pinnedResizeHandle')"
      role="separator"
      aria-orientation="horizontal"
      @pointerdown="onPinResizePointerDown"
      @dblclick="onPinResizeReset"
    />
  </div>
</template>

<style scoped>
.dashboard-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  overflow: hidden;
}
/* Collapsed: shrink the card itself to just its header. On desktop the
   GridItem slot (h) is untouched (see module doc), so this leaves the page
   background visible below the card within that slot rather than resizing
   the grid — acceptable and simple; the slot reclaims its full size again
   the moment the card is expanded or the layout is reset. On mobile's plain
   single-column flow there is no fixed-height ancestor, so this simply
   makes the card (and the vertical space it takes in the column) shrink for
   real. */
.dashboard-card.collapsed {
  height: auto;
}
/* On desktop the collapsed card's GridItem slot is ALSO shrunk to
   COLLAPSED_ROWS by the collapse-reflow overlay (see dashboardLayout.ts's
   applyCollapsedHeights / AnalyzerView's activeLayout getter), so `height:
   auto`'s natural (header-only) height leaves a sliver of page background
   visible below the header within that now-small slot — the header itself
   is a bit shorter than 2 grid rows. Filling the slot instead reads as a
   clean, flush collapsed card. Mobile (below the app's existing 768px
   breakpoint — see useDashboardLayout's MOBILE_BREAKPOINT_PX) has no fixed-
   height ancestor to fill, so it keeps `height: auto` there for a real
   shrink of the column. */
@media (min-width: 769px) {
  .dashboard-card.collapsed {
    height: 100%;
  }
}
.drag-handle {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px calc(var(--space) * 1.5);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  cursor: move;
  /* Prevent the browser's own touch scroll/select from fighting the grid's
     own pointer-based drag handling on touch devices (desktop-only feature,
     but harmless to set unconditionally). */
  touch-action: none;
  user-select: none;
}
.dashboard-card.collapsed .drag-handle {
  border-bottom: none;
}
.title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  /* Actions (e.g. a chart's own remove button lives in its body, not here —
     this slot is for card-level chrome only) shouldn't inherit the header's
     drag behaviour. */
  cursor: default;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--color-text-muted);
  cursor: pointer;
  /* Buttons live inside the drag-handle header, which sets touch-action:none
     for the grid's own drag gesture — undo that here so tapping a button on
     a touch device isn't swallowed by the drag handler. */
  touch-action: manipulation;
}
.icon-btn svg {
  width: 16px;
  height: 16px;
}
.icon-btn:hover {
  color: var(--color-text);
  border-color: var(--color-border);
}
.pin-btn.active {
  color: var(--color-accent);
}
.collapse-btn svg {
  transition: transform 0.15s ease;
}
.collapse-btn.collapsed svg {
  transform: rotate(-90deg);
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: calc(var(--space) * 1.5);
  /* T1 — the body is a flex COLUMN so a fill-height chart/map child can take
     `flex: 1 1 auto` (the remaining space) while its sibling text rows
     (legend/hints/inputs) keep their natural height and stay VISIBLE at any
     card size. Previously the chart claimed `height: 100%` OF THE BODY and
     pushed every text row below the fold, where `overflow: auto` hid it
     unless the user thought to scroll — and growing the window only widened
     the chart, never revealed the text. Non-fill cards are unaffected: block
     children simply become full-width column flex items with auto height. */
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* 釘選 (pin) chrome: the STICKY positioning itself now lives on AnalyzerView's
   pinned-card anchor (see its module doc) — a pinned card's markup is
   Teleported there, so this class only needs to bound its own size/shape
   once it's inside that anchor (an unbounded body could otherwise grow to
   dominate the screen) and add a visual "floating" cue. Applies identically
   at both breakpoints now.
   #18 fix — `aspect-ratio` (set inline via `cardStyle`, from the card's own
   grid w/h ratio) now drives the card's HEIGHT from its width, so a pinned
   card keeps roughly the shape it had in the grid instead of every pinned
   card — short control panel or tall chart alike — being squashed into the
   exact same 45vh box. `max-height: 45vh` stays as a SAFETY CEILING (a very
   tall/narrow card's aspect-ratio-derived height could otherwise still push
   past a comfortable viewport share) rather than the primary sizing rule;
   when `aspectRatio` isn't supplied, this falls back to the old behaviour
   unchanged. */
.dashboard-card.pinned {
  /* Override the base rule's `height: 100%` — that fills the (100%-height)
     GRID slot the un-pinned card normally lives in, but the pinned anchor
     it's Teleported into has no fixed height of its own, and `height: 100%`
     would otherwise WIN over `aspect-ratio` (a percentage height is a used
     value the aspect-ratio calculation must respect, not override) and
     silently defeat the whole fix above. */
  height: auto;
  max-height: 45vh;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
  /* B18 — positioning context for `.pin-resize-handle` below. */
  position: relative;
}
.dashboard-card.pinned .body {
  /* Cap the body so the whole sticky card respects max-height instead of
     overflowing it — the header stays fixed-size, the body scrolls/clips
     internally beyond that (TrackMap's own fillHeight mode already fills
     whatever height its host gives it, verified against this constraint). */
  min-height: 0;
}

/* B18 — pinned-card resize handle: a small corner grip, bottom-right, shown
   only while pinned + not collapsed (see the template's `v-if`). Dragging it
   sets an explicit pixel width/height on the card (`pinnedSize`/`cardStyle`
   above), overriding both the aspect-ratio default and the `max-height: 45vh`
   / anchor `width: min(560px, 100%)` ceilings — `clampPinnedSize` keeps the
   result sane instead. */
.pin-resize-handle {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 18px;
  height: 18px;
  cursor: nwse-resize;
  touch-action: none;
  border-radius: 0 0 calc(var(--radius) * 1.5) 0;
}
.pin-resize-handle::after {
  content: '';
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--color-text-muted);
  border-bottom: 2px solid var(--color-text-muted);
  opacity: 0.6;
}
.pin-resize-handle:hover::after {
  opacity: 1;
}
</style>
