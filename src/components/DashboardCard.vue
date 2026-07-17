<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PIN_FLIP_EASING } from '@/domain/layout/flip'
import { playFlipTransition, prefersReducedMotion, useAutoFlip } from '@/composables/useFlipAnimation'
import {
  DEFAULT_TOUCH_DRAG_DELAY,
  advanceOnMove,
  advanceOnTimeout,
  type TouchDragDelayState,
} from '@/domain/layout/touchDragDelay'

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
 *
 * B61 — touch on `.drag-handle` used to hand off straight to grid-layout-
 * plus's own interactjs-driven drag exactly like a mouse press, which fights
 * a finger trying to SCROLL the page starting from a card's title (a natural
 * place to start a scroll swipe once cards stack full-width on mobile — see
 * B36). Mouse/pen still start dragging immediately (`onDragHandlePointerDown`
 * returns early for anything but `pointerType === 'touch'` — §8 layer 2:
 * branch per-event on pointerType, never on breakpoint/device). For touch,
 * this component now runs its own long-press gate BEFORE grid-layout-plus's
 * interactjs ever sees the gesture:
 *
 *  1. `touch-action` on `.drag-handle` was `none` (blocks ALL native touch
 *     handling unconditionally, including scroll) — changed to `pan-y` below
 *     so a finger that starts moving vertically before the hold completes
 *     scrolls the page completely natively (we never call `preventDefault`
 *     during the pending window, so the browser is free to do so).
 *  2. `onDragHandlePointerDown` calls `event.stopPropagation()` on a
 *     qualifying touch pointerdown — verified by reading interactjs's own
 *     source (node_modules/interactjs/dist/interact.js): it listens for
 *     `pointerdown` on `document`, in the BUBBLE phase (`onDocSignal`'s
 *     `eventMethod(doc, type, listener, eventOptions)`, no `capture: true`
 *     anywhere in that path) — a `stopPropagation()` called on this
 *     DESCENDANT element during the event's target phase therefore keeps the
 *     event from ever reaching interactjs's listener at all, regardless of
 *     Vue's own (deferred-by-a-tick) reactivity timing. Interactjs simply
 *     never learns this touch happened until step 4.
 *  3. A `setTimeout(DEFAULT_TOUCH_DRAG_DELAY.delayMs)` starts, tracked
 *     against real `pointermove`/`pointerup`/`pointercancel` on `window` and
 *     fed through touchDragDelay.ts's pure state machine
 *     (`advanceOnMove`/`advanceOnTimeout`) — movement past the threshold
 *     cancels (this was scroll intent all along, and since step 1 never
 *     blocked native scrolling, the page is already scrolling normally by
 *     this point); an early `pointerup` cancels too (a tap, not a hold).
 *  4. If the timer wins (finger held still long enough): a synthetic
 *     `pointerdown` `PointerEvent`, carrying the SAME `pointerId` and the
 *     latest tracked coordinates, is dispatched on the drag handle itself —
 *     this time WITHOUT `stopPropagation()`, so it bubbles normally and
 *     interactjs (confirmed via the same source read to have no `isTrusted`
 *     check anywhere) picks it up as a brand-new drag candidate for that
 *     pointerId. The REAL subsequent `pointermove`/`pointerup` for the same
 *     finger (still physically down) then reach interactjs's own document
 *     listeners normally and it drives the drag exactly like the mouse path
 *     — including flipping grid-layout-plus's own `.vgl-item--dragging`
 *     class (opacity/z-index) once it recognises the drag, which doubles as
 *     this feature's "you're now dragging" visual cue. A short-lived local
 *     `touchArmed` class on the header additionally highlights the INSTANT
 *     the hold completes (before any further finger movement), so a
 *     still-finger long-press gets feedback even before that library class
 *     would appear.
 *
 * This has NOT been exercised on a real touchscreen (this project's dev/test
 * environment cannot paint/dispatch genuine touch input — see #20/B32's own
 * notes on the same limitation) — the state machine itself is unit-tested
 * offline (touchDragDelay.test.ts), but the synthetic-pointerdown handoff to
 * interactjs is a structural fix that needs a real Android/iOS device to
 * confirm end-to-end (see the acceptance checklist wherever this ships).
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

// B61 — long-press-to-drag gate for touch pointers on the header — see this
// component's module doc above for the full design/why. `dragHandleEl` is
// where the pointerdown listener lives AND where the synthetic hand-off
// pointerdown gets (re-)dispatched from once armed.
const dragHandleEl = ref<HTMLElement | null>(null)
// Transient visual cue: true for a short window right when the long-press
// completes (see `onTouchDragTimeout`), separate from — and earlier than —
// grid-layout-plus's own `.vgl-item--dragging` class, which only appears
// once interactjs actually recognises the handed-off drag on the NEXT
// finger movement.
const touchArmed = ref(false)
const TOUCH_ARMED_VISUAL_MS = 400

// B64 — a phone-only, session-scoped compact state for the floating pinned
// card. It intentionally is not written to panel/layout persistence: it is a
// quick reading-mode choice, not a rearrangement of the user's dashboard.
const pinnedMini = ref(false)
function togglePinnedMini(): void {
  pinnedMini.value = !pinnedMini.value
}
function resetPinnedMiniOutsideMobile(): void {
  if (window.innerWidth > 768) pinnedMini.value = false
}
onMounted(() => window.addEventListener('resize', resetPinnedMiniOutsideMobile))
watch(() => props.pinned, (isPinned) => {
  if (!isPinned) pinnedMini.value = false
})

let touchDragState: TouchDragDelayState | null = null
let touchDragTimer: ReturnType<typeof setTimeout> | null = null
let touchDragStart: { x: number; y: number; pointerId: number } | null = null
let touchDragLatest: { x: number; y: number } | null = null

/** Tears down whatever's left of an in-flight (or just-finished) long-press
 *  tracking session — timer, window listeners, local state. Safe to call
 *  from any point (idempotent: a second call with nothing pending is a
 *  no-op), which is why every exit path below (cancel, arm, unmount) just
 *  calls this rather than duplicating the cleanup. */
function clearTouchDragTracking(): void {
  if (touchDragTimer != null) {
    clearTimeout(touchDragTimer)
    touchDragTimer = null
  }
  window.removeEventListener('pointermove', onTouchDragMove)
  window.removeEventListener('pointerup', onTouchDragEnd)
  window.removeEventListener('pointercancel', onTouchDragEnd)
  touchDragState = null
  touchDragStart = null
  touchDragLatest = null
}

function onTouchDragMove(e: PointerEvent): void {
  if (!touchDragState || !touchDragStart || e.pointerId !== touchDragStart.pointerId) return
  touchDragLatest = { x: e.clientX, y: e.clientY }
  touchDragState = advanceOnMove(touchDragState, touchDragStart.x, touchDragStart.y, e.clientX, e.clientY)
  if (touchDragState === 'cancelled') clearTouchDragTracking()
}

function onTouchDragEnd(e: PointerEvent): void {
  if (!touchDragStart || e.pointerId !== touchDragStart.pointerId) return
  clearTouchDragTracking()
}

// B61 — marks the synthetic hand-off pointerdown (see `onTouchDragTimeout`)
// so `onDragHandlePointerDown` — bound to the SAME `.drag-handle` element
// this gets dispatched on — recognises and ignores its own hand-off rather
// than treating it as a brand-new touch and re-arming a second long-press
// cycle around it (which would stopPropagation() it right back out, and
// grid-layout-plus's document-level listener would never see it at all).
const TOUCH_HANDOFF_MARKER = '__b61TouchHandoff'

function onTouchDragTimeout(): void {
  touchDragTimer = null
  if (!touchDragState || !touchDragStart) return
  touchDragState = advanceOnTimeout(touchDragState)
  if (touchDragState !== 'armed') return

  const { pointerId } = touchDragStart
  const { x, y } = touchDragLatest ?? touchDragStart
  const handle = dragHandleEl.value
  // Our own job (deciding pending/cancelled) is done — stop tracking so a
  // REAL pointermove/up from here on reaches interactjs's own listeners
  // unobstructed (see step 4 of the module doc above) instead of also being
  // consumed here.
  window.removeEventListener('pointermove', onTouchDragMove)
  window.removeEventListener('pointerup', onTouchDragEnd)
  window.removeEventListener('pointercancel', onTouchDragEnd)
  touchDragState = null
  touchDragStart = null
  touchDragLatest = null

  touchArmed.value = true
  window.setTimeout(() => {
    touchArmed.value = false
  }, TOUCH_ARMED_VISUAL_MS)

  if (!handle) return
  // Hand off to grid-layout-plus: this touch's ORIGINAL pointerdown was
  // never seen by interactjs (stopPropagation'd in
  // onDragHandlePointerDown) — a fresh synthetic one, same pointerId so the
  // REAL subsequent move/up events (still the same physical finger) are
  // correctly attributed to the interaction this starts.
  const synthetic = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    isPrimary: true,
    button: 0,
    buttons: 1,
  })
  ;(synthetic as PointerEvent & Record<string, boolean>)[TOUCH_HANDOFF_MARKER] = true
  handle.dispatchEvent(synthetic)
}

function onDragHandlePointerDown(e: PointerEvent): void {
  // Our own synthetic hand-off, arriving back at the very listener that
  // dispatched it (same element) — let it through untouched so it can
  // bubble on to grid-layout-plus, see TOUCH_HANDOFF_MARKER's doc above.
  if ((e as PointerEvent & Record<string, boolean>)[TOUCH_HANDOFF_MARKER]) return
  // Mouse/pen keep today's behaviour — start dragging immediately via
  // grid-layout-plus's own interactjs handling, untouched by anything below
  // (§8 layer 2: branch on the EVENT's pointerType, never on device/width).
  if (e.pointerType !== 'touch') return
  // Header buttons (pin/collapse, `.actions`) must keep their plain tap
  // behaviour — same region grid-layout-plus's own `dragIgnoreFrom` already
  // excludes from ITS drag recognition; excluded here too so this gate
  // never eats their click.
  if ((e.target as HTMLElement).closest('.actions')) return
  // Belt-and-braces: a second finger touching the handle while one gesture
  // is already pending/tracked should not stomp on it.
  if (touchDragState) return

  // The key move: block this pointerdown from ever reaching interactjs
  // (which listens on `document`, bubble phase — see module doc) so it
  // cannot start a drag from this touch at all. No `preventDefault()` here,
  // so the browser's native vertical pan (`touch-action: pan-y`, see the
  // style below) is completely free to take over if this turns out to be a
  // scroll gesture.
  e.stopPropagation()

  touchDragState = 'pending'
  touchDragStart = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
  touchDragLatest = null

  window.addEventListener('pointermove', onTouchDragMove)
  window.addEventListener('pointerup', onTouchDragEnd)
  window.addEventListener('pointercancel', onTouchDragEnd)
  touchDragTimer = setTimeout(onTouchDragTimeout, DEFAULT_TOUCH_DRAG_DELAY.delayMs)
}

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
  window.removeEventListener('resize', resetPinnedMiniOutsideMobile)
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

// B32 fix — root cause (found by reading the actual interaction, since this
// worktree's headless browser session cannot paint/composite at all: the tab
// is permanently `document.hidden`, `prefers-reduced-motion: reduce` reads
// true, `requestAnimationFrame` never fires and even an isolated minimal
// `transitionend` repro never completes — confirmed genuinely environmental,
// not app-specific, by testing on a blank `about:blank`-equivalent page too).
//
// Collapse/expand used to be a pure body-height change (see #9's doc above:
// the card's own GridItem `h` was deliberately left untouched specifically
// to avoid fighting anything). `dece43d` (collapse-reflow overlay,
// `applyCollapsedHeights`/`compactVertical`) later made a collapsing card
// shrink its OWN grid slot too (補位) — grid-layout-plus has NO built-in CSS
// transition for a width/height change (only `left/top/right`/`transform`,
// i.e. POSITION, are in its `transition-property` list — see
// node_modules/grid-layout-plus's injected `.vgl-item{...}` rule), so that
// slot resize lands INSTANTLY, and `.dashboard-card.collapsed{height:100%}`
// means THIS card's root element snaps to the new size in the very same
// frame. `useAutoFlip` (#20, generic "my grid slot moved" watcher) sees
// exactly that instant snap on its OWN `.vgl-item` parent and — correctly by
// its own contract, but WRONGLY for this specific case — FLIP-animates the
// WHOLE root element (header included) with a non-uniform `scale()` (see
// flip.ts's `computeFlipInvert`) from the old box to the new one, AT THE
// SAME TIME `onBodyEnter`/`onBodyLeave` below are already animating the
// BODY's real height. Two competing animations fire on the same toggle: one
// correct (body height), one wrong (a whole-card squish that scales the
// header too, since `scale()` isn't body-only) — which is what reads as
// "the transition is gone/broken" rather than a clean height collapse.
//
// Fix: suppress the generic auto-flip specifically while THIS card's own
// body-transition is in flight (`selfReflowing`, set for the exact duration
// `animateBodyHeight` runs) — same treatment #20 already gives `pinned`
// (whose Teleport move is animated explicitly elsewhere, so the generic
// watcher must stay out of its way). A NEIGHBOUR card that gets pushed up to
// fill the reclaimed rows (dece43d's 補位) has `selfReflowing === false` (it
// didn't toggle its own collapse), so its OWN useAutoFlip still plays
// normally — only the card that's the CAUSE of its own resize skips the
// generic watcher, not every card the reflow touches.
const selfReflowing = ref(false)

// #20 — generic FLIP for any OTHER cause of this card's grid slot moving
// (compaction settle, drag/resize settle, delete-compaction, breakpoint
// switch) — see useFlipAnimation.ts's module doc. Disabled while pinned (the
// Teleport move above is already animated explicitly, and the pinned anchor
// isn't part of the compacted grid anyway) and while this card's OWN
// collapse/expand body transition is running (see `selfReflowing` above).
useAutoFlip(rootEl, { enabled: computed(() => !props.pinned && !selfReflowing.value) })

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
  // B32 — see `selfReflowing`'s doc above `useAutoFlip`: mark this card's own
  // grid-slot resize (dece43d's collapse-reflow overlay) as self-caused
  // BEFORE the DOM mutation lands, so useAutoFlip's MutationObserver
  // (microtask-queued, fires strictly after this synchronous call returns)
  // sees it disabled and skips FLIP-animating this same resize a second time.
  selfReflowing.value = true
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
 *  body is at its natural resting state. B32 — also clears `selfReflowing`,
 *  re-arming useAutoFlip for the NEXT grid-slot move (a real reflow caused by
 *  something else, e.g. a sibling card's own collapse), not just re-running
 *  it here (this card's own resize is already finished by this point). */
function onBodyAfterTransition(el: Element): void {
  const body = el as HTMLElement
  body.style.flex = ''
  body.style.overflow = ''
  body.style.height = ''
  body.style.transition = ''
  selfReflowing.value = false
}

onBeforeUnmount(() => {
  cleanupPinFlip?.()
  // Belt-and-braces: a card can be unmounted (or unpinned mid-drag by some
  // other interaction) while a resize gesture is in flight — these listeners
  // are on `window`, not this component's own DOM, so Vue's own teardown
  // would never remove them on its own.
  window.removeEventListener('pointermove', onPinResizePointerMove)
  window.removeEventListener('pointerup', onPinResizePointerUp)
  // B61 — same belt-and-braces reasoning: the long-press tracking listeners
  // are also on `window`, not this component's own DOM.
  clearTouchDragTracking()
})
</script>

<template>
  <div ref="rootEl" class="dashboard-card" :class="{ pinned, collapsed, 'pinned-mini': pinnedMini }" :style="cardStyle">
    <header
      ref="dragHandleEl"
      class="drag-handle"
      :class="{ 'touch-armed': touchArmed }"
      @pointerdown="onDragHandlePointerDown"
    >
      <span class="title">{{ title }}</span>
      <span class="actions">
        <slot name="actions" />
        <button
          v-if="pinned"
          type="button"
          class="icon-btn mini-btn"
          :class="{ active: pinnedMini }"
          v-tooltip="pinnedMini ? t('analyzer.layout.expandPinned') : t('analyzer.layout.minimizePinned')"
          :aria-label="pinnedMini ? t('analyzer.layout.expandPinned') : t('analyzer.layout.minimizePinned')"
          :aria-pressed="pinnedMini"
          @click="togglePinnedMini"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path v-if="pinnedMini" d="M7 14l5-5 5 5" />
            <path v-else d="m7 10 5 5 5-5" />
          </svg>
        </button>
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
      <div v-if="!collapsed && !pinnedMini" class="body">
        <slot />
      </div>
    </Transition>
    <!-- B18 — pinned-card resize handle: only while pinned (nothing to
         resize otherwise) and not collapsed (a header-only card has no body
         to grow — see this handle's module doc above `pinnedSize`). -->
    <div
      v-if="pinned && !collapsed && !pinnedMini"
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
  /* B36 — the card body's own horizontal padding, factored out as a custom
     property (rather than hardcoded in `.body`'s `padding` below) so the
     mobile override further down can shrink JUST this axis, and so fill-
     height chart/map children (UPlotChart.vue's `.uplot-wrap.fill`,
     TrackMap.vue's `.track-wrap.fill`) can read the SAME value to size an
     exact negative margin that cancels it back out to true edge-to-edge —
     see those files' own B36 notes. Default matches the padding this always
     had (`calc(var(--space) * 1.5)`) so desktop/tablet are byte-for-byte
     unchanged. */
  --card-body-pad-x: calc(var(--space) * 1.5);
  /* B36 — how far a FILL-HEIGHT chart/map child (UPlotChart.vue's
     `.uplot-wrap.fill`, TrackMap.vue's `.track-wrap.fill`) should bleed past
     this card's own body padding via a negative margin — see those files'
     own doc. 0 by default (no bleed) everywhere except the mobile,
     non-pinned override below; consumed with a `var(--card-bleed-x, 0px)`
     fallback so components using UPlotChart OUTSIDE a DashboardCard (e.g.
     GearPanel.vue/SessionMergePanel.vue's standalone charts, which never set
     this variable at all) are completely unaffected. */
  --card-bleed-x: 0px;
}
/* B36 — 手機單欄模式卡片滿版: below the mobile breakpoint, a stacked column
   of full-width cards reads better as flush "grouped-list" sections than as
   floating boxes with their own side borders/rounded corners eating into an
   already-narrow screen (see DESIGN.md §6.4). Left/right border + radius are
   dropped; the header's existing `border-bottom` (and this rule's own
   top/bottom border, kept below) still separate one card from the next as a
   plain horizontal divider. `--card-body-pad-x` is also reduced to a small
   fixed minimum here — NOT zero, so non-chart cards (control panels, lap
   tables, band-filter inputs, …) keep just enough breathing room to stay
   legible — the actual edge-to-edge bleed for chart/map content is a
   negative margin those specific children apply THEMSELVES against this
   (now small) padding, not a zero here (see UPlotChart.vue/TrackMap.vue).
   Excluded for `.pinned`: a pinned card is a deliberately FLOATING element
   (see this component's own module doc — it's Teleported out of the grid
   into a sticky anchor), so it keeps its full card chrome — border, radius,
   the wider padding — at every breakpoint; only grid-resident cards become
   flush list sections. */
@media (max-width: 768px) {
  .dashboard-card:not(.pinned) {
    border-left: none;
    border-right: none;
    border-radius: 0;
    --card-body-pad-x: 4px;
    --card-bleed-x: 4px;
  }
  /* B64 — the pinned card uses the same flush full-width treatment as the
     mobile grid cards. A restrained bottom shadow and divider keep its sticky
     role legible without reintroducing a side inset. */
  .dashboard-card.pinned {
    border-left: none;
    border-right: none;
    border-radius: 0;
    --card-body-pad-x: 4px;
    --card-bleed-x: 4px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.16);
  }
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
  /* B61 fix — was `none` (blocks ALL native touch handling unconditionally,
     including scroll), which is exactly why a touch starting on the title
     used to fight a page-scroll swipe: the browser had zero chance to ever
     treat it as a scroll. `pan-y` keeps native vertical scrolling available
     by default; `onDragHandlePointerDown`'s long-press gate (see this
     component's module doc) is what takes over — and calls
     `preventDefault()`/lets interactjs do so — ONLY once a hold is
     confirmed, never during the pending window. Mouse/pen are unaffected
     either way (`touch-action` only governs touch/pen-as-touch gesture
     handling, not mouse dragging). */
  touch-action: pan-y;
  user-select: none;
  transition: background-color 0.15s ease;
}
.dashboard-card.collapsed .drag-handle {
  border-bottom: none;
}
/* B61 — brief highlight the instant a touch long-press is confirmed (before
   grid-layout-plus's own `.vgl-item--dragging` opacity/z-index kicks in on
   the NEXT finger movement — see the handoff in `onTouchDragTimeout`), so a
   finger held perfectly still still gets immediate "you can drag now"
   feedback rather than nothing happening until it moves. */
.drag-handle.touch-armed {
  background: color-mix(in srgb, var(--color-accent) 18%, var(--color-bg));
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
.mini-btn {
  display: none;
}
@media (max-width: 768px) {
  .mini-btn {
    display: inline-flex;
  }
}
.icon-btn:hover {
  color: var(--color-text);
  border-color: var(--color-border);
}
/* B35 — §8 layer 3: any coarse pointer present (useInputCapabilities.ts's
   capability signal, mirrored onto <html data-any-pointer-coarse> — NOT a
   viewport-width guess, so a tablet running the full desktop layout gets
   this too) grows the pin/collapse buttons to a comfortable >=44px touch
   target. */
:root[data-any-pointer-coarse] .icon-btn {
  width: 44px;
  height: 44px;
}
:root[data-any-pointer-coarse] .icon-btn svg {
  width: 20px;
  height: 20px;
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
  /* B36 — horizontal padding driven off `--card-body-pad-x` (see
     `.dashboard-card`'s own doc above) so the mobile override can shrink
     just this axis while top/bottom stays the original comfortable value. */
  padding: calc(var(--space) * 1.5) var(--card-body-pad-x);
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

/* B18b — pinned-card resize handle: bottom-right corner grip, shown only
   while pinned + not collapsed (see the template's `v-if`). Dragging it sets
   an explicit pixel width/height on the card (`pinnedSize`/`cardStyle`
   above), overriding both the aspect-ratio default and the `max-height: 45vh`
   / anchor `width: min(560px, 100%)` ceilings — `clampPinnedSize` keeps the
   result sane instead.
   Previously this drew its OWN bespoke 90°-corner icon (fixed 18px box,
   plain `--color-text-muted` border, hover-only opacity) — a different
   affordance from the one every GRID card already has for the exact same
   gesture (grid-layout-plus's own `.vgl-item__resizer`, themed in
   AnalyzerView.vue). Restyled to be henceforth STRUCTURALLY the same element
   grid-layout-plus draws (position/size via the identical `--vgl-resizer-*`
   custom properties, a `::before`-drawn corner via the same
   border-right/border-bottom-on-an-inset-box technique, same accent color,
   same rounded corner) rather than reinventing it — the resize gesture itself
   stays this component's own pointerdown/move/up handlers (a pinned card's
   real content has been Teleported out of the grid entirely — see this
   file's module doc — so there's no grid-layout-plus resize algorithm here
   to plug into, only its VISUAL affordance is shared). AnalyzerView.vue
   defines `--vgl-resizer-size`/`--vgl-resizer-border-color`/`--vgl-resizer-
   border-width` on `.analyzer` (an ancestor of both the grid and the pinned
   anchor this card Teleports into) specifically so this rule and the grid's
   own resizer read the SAME values, including the mobile 30px touch-target
   bump — see that file's own comment for why the value has to be declared
   twice. Falls back to grid-layout-plus's own un-themed defaults (10px /
   `--color-accent` / 2px) if ever rendered outside `.analyzer`. */
.pin-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  box-sizing: border-box;
  width: var(--vgl-resizer-size, 10px);
  height: var(--vgl-resizer-size, 10px);
  cursor: se-resize;
  touch-action: none;
}
.pin-resize-handle::before {
  position: absolute;
  top: 0;
  right: 3px;
  bottom: 3px;
  left: 0;
  content: '';
  border: 0 solid var(--vgl-resizer-border-color, var(--color-accent));
  border-right-width: var(--vgl-resizer-border-width, 2px);
  border-bottom-width: var(--vgl-resizer-border-width, 2px);
  border-radius: 0 0 var(--radius) 0;
}
</style>
