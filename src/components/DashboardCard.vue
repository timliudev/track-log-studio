<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PIN_FLIP_EASING } from '@/domain/layout/flip'
import { playFlipTransition, prefersReducedMotion, useAutoFlip } from '@/composables/useFlipAnimation'
import {
  DEFAULT_TOUCH_DRAG_DELAY,
  advanceOnMove,
  advanceOnTimeout,
  advanceOnSecondPointer,
  type TouchDragDelayState,
} from '@/domain/layout/touchDragDelay'
import { edgeAutoscrollVelocity } from '@/domain/layout/edgeAutoscroll'

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
 * 釘選 (pin) — works at BOTH breakpoints via genuine CSS `position: sticky`:
 * the F6 migration made every dashboard card an ordinary in-flow CSS Grid
 * item (CssGridGrid.vue), so a pinned card just gets `position: sticky` and
 * sticks EXACTLY where it already sits in the grid — no Teleport, no
 * separate anchor, no placeholder. `pinned` drives this component's OWN
 * chrome (button active-state, `.pinned` size/shadow styling); the sticky
 * positioning itself and the multi-pin stacking stagger/z-index are
 * CssGridGrid's own job (see that component's `pinStackStyle`). B111 —
 * SEVERAL cards may be pinned at once (a stand-in for a proper mobile split
 * view — see panelState.ts's `pinnedIds` doc); this component only knows its
 * own `pinned` flag, not how many others are also pinned.
 *
 * #19 — pin/unpin toggling `pinned` no longer moves this card's DOM node at
 * all (no Teleport any more), so there's nothing to FLIP-animate for THAT
 * transition specifically; `onTogglePinned` below still measures/inverts the
 * rect for belt-and-braces safety, but in practice the card stays put and
 * only its `.pinned` chrome (shadow/sticky) changes.
 *
 * #20 — Collapse/expand's own height change (the BODY hide/show — see #9's
 * note above; the card's grid slot itself still doesn't move, only the
 * body's own visible height does) is animated via the `<Transition>` JS
 * hooks below (`onBodyEnter`/`onBodyLeave`). Any OTHER cause of this card's
 * grid slot moving (a drag/resize/gutter settle, delete-compaction, or a
 * breakpoint switch) is picked up generically by `useAutoFlip` (see
 * useFlipAnimation.ts's module doc): it watches this card's own `.css-grid-
 * item` parent for CssGridGrid rewriting its position/size, and FLIP-
 * animates the move. It's turned OFF while `pinned` (a sticky card's own
 * scroll-driven "stuck" position isn't a layout move to FLIP) and while this
 * card's OWN collapse/expand body transition is running (`selfReflowing`).
 *
 * B61/F6 stage 2 — a touch press on `.drag-handle` runs a long-press gate
 * BEFORE this component's own self-contained CSS-grid drag starts (there is
 * no third-party drag library to hand off to — CssGridGrid.vue's items are
 * ordinary in-flow grid cells, and the drag/resize MECHANICS (pointer
 * tracking, collision/compaction, commit) all live one level up in
 * useCssGridDashboardDrag.ts/useCssGridDashboardResize.ts; this component
 * only reports raw pointer coordinates via `css-grid-drag-*`/`css-grid-
 * resize-*` events). Mouse/pen start immediately
 * (`onCssGridDragHandlePointerDown` returns early for anything but
 * `pointerType === 'touch'` — §8 layer 2: branch per-event on pointerType,
 * never on breakpoint/device). For touch:
 *
 *  1. `touch-action` on `.drag-handle` is `pan-y` (not `none`) so a finger
 *     that starts moving vertically before the hold completes scrolls the
 *     page completely natively (no `preventDefault()` during the pending
 *     window).
 *  2. `e.stopPropagation()` on a qualifying touch pointerdown keeps the tap
 *     from being misread as anything else while the hold is pending.
 *  3. A `setTimeout(DEFAULT_TOUCH_DRAG_DELAY.delayMs)` starts, tracked
 *     against real `pointermove`/`pointerup`/`pointercancel` on `window` and
 *     fed through touchDragDelay.ts's pure state machine
 *     (`advanceOnMove`/`advanceOnTimeout`) — movement past the threshold
 *     cancels (scroll intent all along); an early `pointerup` cancels too (a
 *     tap, not a hold).
 *  4. If the timer wins (finger held still long enough): the drag ARMS
 *     directly — `startCssGridActiveDrag` begins tracking the SAME
 *     `pointerId`'s subsequent `pointermove`/`pointerup` on `window` and
 *     emits `css-grid-drag-move`/`css-grid-drag-end`. A short-lived local
 *     `touchArmed` class on the header highlights the INSTANT the hold
 *     completes; `touchDragActive`/`.touch-dragging` stays set for the FULL
 *     duration of the armed drag.
 *
 * This has NOT been exercised on a real touchscreen (this project's dev/test
 * environment cannot paint/dispatch genuine touch input — see #20/B32's own
 * notes on the same limitation) — the state machine itself is unit-tested
 * offline (touchDragDelay.test.ts), but the long-press-then-drag handoff is a
 * structural design that needs a real Android/iOS device to confirm
 * end-to-end (see the acceptance checklist wherever this ships).
 *
 * F1 phase 5 (B102a/b, originally built 2026-07-23 against the legacy
 * renderer, carried over unchanged to the CSS-grid drag path in F6 stage 2 —
 * `startCssGridActiveDrag`/`runCssGridEdgeAutoscroll`/
 * `onCssGridActiveSecondPointer` below):
 *
 *  - **B102a edge-autoscroll**: the full-dashboard mobile grid has no
 *    internal scroll container — the whole PAGE scrolls a tall content-sized
 *    grid. A card drag is otherwise capped to whatever fits in one screenful
 *    — you can't drag a card to a position currently off-screen. Fixed by a
 *    plain `requestAnimationFrame` loop (`runCssGridEdgeAutoscroll`), started
 *    the instant the drag arms and stopped the instant it ends, that reads
 *    the latest tracked pointer Y every frame and calls `window.scrollBy`
 *    with whatever `edgeAutoscroll.ts`'s pure `edgeAutoscrollVelocity` says
 *    for that Y (0 in the vertical middle, ramping up near the top/bottom
 *    edge) — the ramp MATH is what's unit-tested offline; the rAF loop
 *    itself, like the touch-action handoff below, needs a real device to
 *    confirm the actual scroll feels smooth and controllable while a finger
 *    is also mid-drag.
 *  - **B102b two-finger scroll during drag**: once armed, a SECOND real
 *    finger touching down anywhere (`onCssGridActiveSecondPointer`, a
 *    `window` `pointerdown` listener active only while a drag is live) means
 *    the user wants to do something else with that hand — most commonly
 *    scroll with the free hand while the other still has a card mid-reorder.
 *    Resolved by DIRECTLY aborting the drag (`css-grid-drag-end` with
 *    `committed: false`) — no synthetic event needed (nothing to fool, since
 *    this renderer has no third-party library tracking the gesture). The new
 *    touch itself is never touched (no `preventDefault`/`stopPropagation`) —
 *    it's free to drive native scrolling from the moment it lands.
 *  - **Clean touch-action handoff on arm**: `.drag-handle.touch-dragging`
 *    (`touchDragActive` below — deliberately separate from the existing
 *    400ms `touchArmed` cosmetic flash) sets `touch-action: none` for the
 *    handle the moment a drag arms, so a fast "hold then immediately swipe"
 *    right after the hold completes has the best chance of being read as
 *    further drag movement rather than getting re-captured by the browser's
 *    own native vertical pan. CAVEAT, stated plainly rather than overclaimed:
 *    `touch-action` is generally resolved by the browser once per touch
 *    sequence at its very first contact point, and several engines do NOT
 *    retroactively honour a CSS change made mid-sequence for that SAME
 *    physical touch (a known, long-standing web-platform rough edge, not
 *    something this codebase can control) — so this class swap is a
 *    best-effort layer, not a guarantee, ON TOP OF B102b's two-finger abort
 *    and the existing move-threshold/long-press gate, which are the parts
 *    that ARE reliably enforceable from JS alone. Real-device testing is the
 *    only way to know whether the residual "hold then immediately fling"
 *    race is fully closed or just narrowed.
 *
 * The exact same long-press-then-touch-action-none shape (reusing the same
 * pure `touchDragDelay.ts` state machine, a separate tracked gesture) is
 * ALSO applied to `.css-grid-resize-handle` below — see that handle's own
 * B102c-style doc for why.
 */
// `withDefaults` (rather than plain `defineProps`) ONLY because `draggable`/
// `resizable` need a TRUE default: Vue's compiler-generated runtime prop
// declaration applies "boolean casting" (see
// https://vuejs.org/guide/components/props.html#boolean-casting) to any
// prop typed as `boolean | undefined` — an OMITTED boolean prop resolves to
// `false`, not `undefined`, unless a default is given. Every OTHER
// boolean-typed prop below (`collapsed`/`pinned`/etc.) already wants that
// same false-when-omitted behaviour, so only these two need an explicit
// entry here.
const props = withDefaults(
  defineProps<{
  title: string
  collapsed?: boolean
  pinned?: boolean
  /** Whether THIS card is currently allowed to start a drag (the caller has
   *  already folded in 鎖定布局 + the pinned-card exception via
   *  dashboardLayout.ts's `isItemDraggable` — see
   *  useCssGridDashboardDrag.ts's `isItemDraggableNow`). Defaults to `true`
   *  so a caller that never sets this never needs to think about it. */
  draggable?: boolean
  /** Whether THIS card is currently allowed to start a resize (the caller
   *  has already folded in 鎖定布局 + the pinned/collapsed exceptions via
   *  dashboardLayout.ts's `isItemResizable` — see
   *  useCssGridDashboardResize.ts's `isItemResizableNow`). Defaults to
   *  `true`; the corner handle itself is hidden entirely (`v-if`) while
   *  `false`, or while `pinned`/`collapsed` (a pinned card has no resize
   *  mechanism at all, a collapsed one has no body to grow). */
  resizable?: boolean
  }>(),
  { draggable: true, resizable: true },
)

const emit = defineEmits<{
  (e: 'update:collapsed', value: boolean): void
  (e: 'update:pinned', value: boolean): void
  /** F6 stage 2 — a drag started (mouse/pen: immediately on pointerdown;
   *  touch: once the long-press hold completes). `x`/`y` are the pointer's
   *  CLIENT coordinates at that instant. */
  (e: 'css-grid-drag-start', payload: { x: number; y: number }): void
  /** F6 stage 2 — the pointer moved while a drag from THIS card is live.
   *  Fired for every raw pointermove (no throttling here — see
   *  useCssGridDashboardDrag.ts's own rAF-coalescing doc for where that
   *  happens instead, mirroring how `touch-dragging`'s B102a edge-autoscroll
   *  loop already just records the latest coordinate on every move too). */
  (e: 'css-grid-drag-move', payload: { x: number; y: number }): void
  /** F6 stage 2 — the drag ended. `committed: true` for a genuine pointerup
   *  (the caller should persist the settled preview); `false` for an abort
   *  (a real `pointercancel`, or a second pointer landing mid-drag — B102b's
   *  two-finger arbitration, resolved directly here since there's no
   *  third-party library tracking the gesture). */
  (e: 'css-grid-drag-end', payload: { committed: boolean }): void
  /** F6 stage 3(a) — a corner resize started. Mouse/pen: immediately on
   *  pointerdown; touch: once the long-press hold completes, mirroring
   *  `css-grid-drag-start`'s own touch gate. */
  (e: 'css-grid-resize-start', payload: { x: number; y: number }): void
  /** F6 stage 3(a) — the pointer moved while a resize from THIS card's
   *  handle is live. Fired for every raw pointermove, same "no throttling
   *  here" convention `css-grid-drag-move` uses (coalescing happens in
   *  useCssGridDashboardResize.ts's own rAF loop). */
  (e: 'css-grid-resize-move', payload: { x: number; y: number }): void
  /** F6 stage 3(a) — the resize ended. `committed: true` for a genuine
   *  pointerup; `false` for an abort (a real `pointercancel` — there is no
   *  B102b two-finger arbitration for this gesture). */
  (e: 'css-grid-resize-end', payload: { committed: boolean }): void
}>()

const { t } = useI18n()

// #19 — FLIP transition for the pin/unpin toggle (see flip.ts's module doc
// for the maths this delegates to). `rootEl` is this card's own root
// element — declared here (rather than just above `onTogglePinned` below)
// because it's also read elsewhere above that.
const rootEl = ref<HTMLElement | null>(null)

// B61 — long-press-to-drag gate for touch pointers on the header — see this
// component's module doc above for the full design/why. `dragHandleEl` is
// where the pointerdown listener lives.
const dragHandleEl = ref<HTMLElement | null>(null)
// F6 stage 3(a) — the CSS Grid renderer's own corner resize handle. Needed to
// call `setPointerCapture` from the DELAYED (post-timer) touch path, which
// has no live `PointerEvent`/`currentTarget` to read at arm-time — only
// mouse/pen's immediate path still has one.
const resizeHandleEl = ref<HTMLElement | null>(null)
// Transient visual cue: true for a short window right when the long-press
// completes (see `onCssGridDragTimeout`), separate from — and earlier than —
// `touchDragActive`'s own full-duration `.touch-dragging` class below.
const touchArmed = ref(false)
const TOUCH_ARMED_VISUAL_MS = 400

// F1 phase 5 (B102a/b) — true from the instant a drag arms until it ends
// (real pointerup/pointercancel, OR a B102b two-finger abort) — separate from
// `touchArmed`'s brief 400ms cosmetic flash above, drives
// `.drag-handle.touch-dragging`'s `touch-action: none` for the FULL duration
// of the armed drag, not just the confirm flash.
const touchDragActive = ref(false)

// B64/B99 — same 768px cutover useDashboardLayout.ts's MOBILE_BREAKPOINT_PX
// uses for the JS-side desktop↔mobile switch (kept as a plain `window.innerWidth`
// read here, matching this component's existing convention — see
// resetPinnedMiniOutsideMobile below, already written this way before B99 —
// rather than threading an `isMobile` prop through from AnalyzerView, since
// this component has no other need to react continuously to the breakpoint,
// only to read it at specific pointer-event moments). `<=` (not `<`) so this
// agrees with every `@media (max-width: 768px)` rule in this same file at the
// boundary width itself, same reasoning as useDashboardLayout's own doc.
const MOBILE_BREAKPOINT_PX = 768
function isMobileWidth(): boolean {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX
}

// B64 — a phone-only, session-scoped compact state for the floating pinned
// card. It intentionally is not written to panel/layout persistence: it is a
// quick reading-mode choice, not a rearrangement of the user's dashboard.
const pinnedMini = ref(false)
function togglePinnedMini(): void {
  pinnedMini.value = !pinnedMini.value
}
function resetPinnedMiniOutsideMobile(): void {
  if (!isMobileWidth()) pinnedMini.value = false
}
onMounted(() => window.addEventListener('resize', resetPinnedMiniOutsideMobile))
watch(() => props.pinned, (isPinned) => {
  if (!isPinned) pinnedMini.value = false
})

// F6 stage 2 — CSS Grid drag-to-reorder. Self-contained (no library hand-off
// — there is no third-party drag library at all under this renderer): mouse/
// pen start immediately (§8 layer 2), touch runs a long-press gate (its own
// separately-tracked gesture state) before starting, with B102a/b's
// edge-autoscroll + two-finger-abort behaviour layered on top of the ARMED
// drag — a real pointerup DIRECTLY commits (`css-grid-drag-end` with
// `committed: true`), a real pointercancel or a second pointer DIRECTLY
// aborts (`committed: false`), no synthetic event needed since there's
// nothing to fool.
let cssGridPendingState: TouchDragDelayState | null = null
let cssGridPendingTimer: ReturnType<typeof setTimeout> | null = null
let cssGridPendingStart: { x: number; y: number; pointerId: number } | null = null
let cssGridPendingLatest: { x: number; y: number } | null = null

function clearCssGridPendingTracking(): void {
  if (cssGridPendingTimer != null) {
    clearTimeout(cssGridPendingTimer)
    cssGridPendingTimer = null
  }
  window.removeEventListener('pointermove', onCssGridPendingMove)
  window.removeEventListener('pointerup', onCssGridPendingEnd)
  window.removeEventListener('pointercancel', onCssGridPendingEnd)
  window.removeEventListener('pointerdown', onCssGridPendingSecondPointer)
  cssGridPendingState = null
  cssGridPendingStart = null
  cssGridPendingLatest = null
}

function onCssGridPendingMove(e: PointerEvent): void {
  if (!cssGridPendingState || !cssGridPendingStart || e.pointerId !== cssGridPendingStart.pointerId) return
  cssGridPendingLatest = { x: e.clientX, y: e.clientY }
  cssGridPendingState = advanceOnMove(cssGridPendingState, cssGridPendingStart.x, cssGridPendingStart.y, e.clientX, e.clientY)
  if (cssGridPendingState === 'cancelled') clearCssGridPendingTracking()
}
function onCssGridPendingEnd(e: PointerEvent): void {
  if (!cssGridPendingStart || e.pointerId !== cssGridPendingStart.pointerId) return
  clearCssGridPendingTracking()
}
function onCssGridPendingSecondPointer(e: PointerEvent): void {
  if (!cssGridPendingState || !cssGridPendingStart || e.pointerId === cssGridPendingStart.pointerId) return
  cssGridPendingState = advanceOnSecondPointer(cssGridPendingState)
  if (cssGridPendingState === 'cancelled') clearCssGridPendingTracking()
}

// Tracking for the LIVE, already-armed CSS-grid drag — module-level (not
// refs) exactly like `activeDragPointerId`/`activeDragLatestY` above, since
// nothing here needs to be reactive except `touchDragActive` (reused as-is:
// same `.drag-handle.touch-dragging` visual cue applies to EITHER drag mode,
// they're mutually exclusive per instance).
let cssGridActivePointerId: number | null = null
let cssGridActiveLatestY: number | null = null
let cssGridActiveRafId: number | null = null

/** Same rAF edge-autoscroll loop as the legacy path's `runEdgeAutoscroll` —
 *  the math is mode-agnostic (just reads window.innerHeight + the latest
 *  tracked pointer Y), so this is a separate loop only because it has its own
 *  separate pointerId/rafId bookkeeping, not because the ramp itself differs. */
function runCssGridEdgeAutoscroll(): void {
  if (cssGridActivePointerId == null) {
    cssGridActiveRafId = null
    return
  }
  if (cssGridActiveLatestY != null) {
    const velocity = edgeAutoscrollVelocity(cssGridActiveLatestY, 0, window.innerHeight)
    if (velocity !== 0) window.scrollBy(0, velocity)
  }
  cssGridActiveRafId = window.requestAnimationFrame(runCssGridEdgeAutoscroll)
}

function onCssGridActiveMove(e: PointerEvent): void {
  if (e.pointerId !== cssGridActivePointerId) return
  cssGridActiveLatestY = e.clientY
  emit('css-grid-drag-move', { x: e.clientX, y: e.clientY })
}
function onCssGridActiveUp(e: PointerEvent): void {
  if (e.pointerId !== cssGridActivePointerId) return
  endCssGridActiveDrag()
  emit('css-grid-drag-end', { committed: true })
}
// A genuine `pointercancel` (OS-level interruption — e.g. a system gesture
// stealing the pointer) is an ABORT, unlike a real pointerup — this renderer
// has no library to defer that distinction to, so it has to make the call
// itself (the legacy path never needed to: interactjs's own drag/resize
// completion is what decides commit-vs-cancel there, via `layout-updated`).
function onCssGridActiveCancel(e: PointerEvent): void {
  if (e.pointerId !== cssGridActivePointerId) return
  endCssGridActiveDrag()
  emit('css-grid-drag-end', { committed: false })
}
// B102b — same two-finger arbitration as the legacy path's
// `onActiveDragSecondPointer`, but resolved directly (no synthetic
// pointercancel needed — nothing to fool) by just aborting this drag.
function onCssGridActiveSecondPointer(e: PointerEvent): void {
  if (cssGridActivePointerId == null || e.pointerId === cssGridActivePointerId) return
  endCssGridActiveDrag()
  emit('css-grid-drag-end', { committed: false })
}

function startCssGridActiveDrag(pointerId: number, x: number, y: number): void {
  cssGridActivePointerId = pointerId
  cssGridActiveLatestY = y
  touchDragActive.value = true
  window.addEventListener('pointermove', onCssGridActiveMove)
  window.addEventListener('pointerdown', onCssGridActiveSecondPointer)
  window.addEventListener('pointerup', onCssGridActiveUp)
  window.addEventListener('pointercancel', onCssGridActiveCancel)
  cssGridActiveRafId = window.requestAnimationFrame(runCssGridEdgeAutoscroll)
  emit('css-grid-drag-start', { x, y })
}

/** Idempotent — same belt-and-braces reasoning as `endActiveTouchDrag`: safe
 *  to call from any exit path (real end, B102b abort, unmount). Does NOT
 *  itself emit `css-grid-drag-end` — every caller above emits its own
 *  `committed` value right after calling this. */
function endCssGridActiveDrag(): void {
  if (cssGridActiveRafId != null) {
    window.cancelAnimationFrame(cssGridActiveRafId)
    cssGridActiveRafId = null
  }
  window.removeEventListener('pointermove', onCssGridActiveMove)
  window.removeEventListener('pointerdown', onCssGridActiveSecondPointer)
  window.removeEventListener('pointerup', onCssGridActiveUp)
  window.removeEventListener('pointercancel', onCssGridActiveCancel)
  cssGridActivePointerId = null
  cssGridActiveLatestY = null
  touchDragActive.value = false
}

function onCssGridDragTimeout(): void {
  cssGridPendingTimer = null
  if (!cssGridPendingState || !cssGridPendingStart) return
  cssGridPendingState = advanceOnTimeout(cssGridPendingState)
  if (cssGridPendingState !== 'armed') return

  const { pointerId } = cssGridPendingStart
  const { x, y } = cssGridPendingLatest ?? cssGridPendingStart
  clearCssGridPendingTracking()

  touchArmed.value = true
  window.setTimeout(() => {
    touchArmed.value = false
  }, TOUCH_ARMED_VISUAL_MS)

  dragHandleEl.value?.setPointerCapture?.(pointerId)
  startCssGridActiveDrag(pointerId, x, y)
}

/** The `.drag-handle` header's pointerdown handler — mouse/pen start the drag
 *  immediately (no long-press gate — §8 layer 2); touch runs a long-press
 *  gate before arming, driving this renderer's own direct pointer tracking. */
function onCssGridDragHandlePointerDown(e: PointerEvent): void {
  if (!props.draggable) return
  if ((e.target as HTMLElement).closest('.actions')) return
  if (e.pointerType !== 'touch') {
    if (cssGridActivePointerId != null) return // belt-and-braces: a drag is already live
    dragHandleEl.value?.setPointerCapture?.(e.pointerId)
    startCssGridActiveDrag(e.pointerId, e.clientX, e.clientY)
    return
  }
  if (cssGridPendingState) return
  e.stopPropagation()
  cssGridPendingState = 'pending'
  cssGridPendingStart = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
  cssGridPendingLatest = null
  window.addEventListener('pointermove', onCssGridPendingMove)
  window.addEventListener('pointerup', onCssGridPendingEnd)
  window.addEventListener('pointercancel', onCssGridPendingEnd)
  window.addEventListener('pointerdown', onCssGridPendingSecondPointer)
  cssGridPendingTimer = setTimeout(onCssGridDragTimeout, DEFAULT_TOUCH_DRAG_DELAY.delayMs)
}

// F6 stage 3(a) — CSS Grid corner resize. Self-contained (no third-party
// library resize handle to theme/reuse): mouse/pen start immediately (§8
// layer 2, same rule the drag-handle follows), touch reuses the IDENTICAL
// long-press gate shape as a SEPARATELY tracked gesture (its own pure
// touchDragDelay.ts state machine instance, so this can never
// cross-contaminate with the drag-handle's own tracking even though only one
// gesture can physically be live at a time). Deliberately a SIMPLER B102c-
// style treatment (long-press gate + second-pointer-cancels-the-PENDING-hold,
// but no B102a edge-autoscroll and no B102b abort-while-armed) than the
// drag-handle's fuller B102a/b gesture engine — a corner resize is a much
// shorter-throw gesture than dragging a card clear across the viewport.
let cssGridResizeTouchState: TouchDragDelayState | null = null
let cssGridResizeTouchTimer: ReturnType<typeof setTimeout> | null = null
let cssGridResizeTouchStart: { x: number; y: number; pointerId: number } | null = null
let cssGridResizeTouchLatest: { x: number; y: number } | null = null
const cssGridResizeTouchArmed = ref(false)
const cssGridResizeTouchActive = ref(false)

function clearCssGridResizeTouchTracking(): void {
  if (cssGridResizeTouchTimer != null) {
    clearTimeout(cssGridResizeTouchTimer)
    cssGridResizeTouchTimer = null
  }
  window.removeEventListener('pointermove', onCssGridResizeTouchMove)
  window.removeEventListener('pointerup', onCssGridResizeTouchEnd)
  window.removeEventListener('pointercancel', onCssGridResizeTouchEnd)
  window.removeEventListener('pointerdown', onCssGridResizeTouchSecondPointer)
  cssGridResizeTouchState = null
  cssGridResizeTouchStart = null
  cssGridResizeTouchLatest = null
}

function onCssGridResizeTouchMove(e: PointerEvent): void {
  if (!cssGridResizeTouchState || !cssGridResizeTouchStart || e.pointerId !== cssGridResizeTouchStart.pointerId) return
  cssGridResizeTouchLatest = { x: e.clientX, y: e.clientY }
  cssGridResizeTouchState = advanceOnMove(
    cssGridResizeTouchState,
    cssGridResizeTouchStart.x,
    cssGridResizeTouchStart.y,
    e.clientX,
    e.clientY,
  )
  if (cssGridResizeTouchState === 'cancelled') clearCssGridResizeTouchTracking()
}
function onCssGridResizeTouchEnd(e: PointerEvent): void {
  if (!cssGridResizeTouchStart || e.pointerId !== cssGridResizeTouchStart.pointerId) return
  clearCssGridResizeTouchTracking()
}
function onCssGridResizeTouchSecondPointer(e: PointerEvent): void {
  if (!cssGridResizeTouchState || !cssGridResizeTouchStart || e.pointerId === cssGridResizeTouchStart.pointerId) return
  cssGridResizeTouchState = advanceOnSecondPointer(cssGridResizeTouchState)
  if (cssGridResizeTouchState === 'cancelled') clearCssGridResizeTouchTracking()
}

// Live (already-armed) gesture tracking — module-level, mirrors
// `cssGridActivePointerId` above (nothing here needs to be reactive except
// the two touch-visual refs already declared).
let cssGridResizeActivePointerId: number | null = null

function onCssGridResizeActiveMove(e: PointerEvent): void {
  if (e.pointerId !== cssGridResizeActivePointerId) return
  emit('css-grid-resize-move', { x: e.clientX, y: e.clientY })
}
function onCssGridResizeActiveUp(e: PointerEvent): void {
  if (e.pointerId !== cssGridResizeActivePointerId) return
  endCssGridResizeActive()
  emit('css-grid-resize-end', { committed: true })
}
function onCssGridResizeActiveCancel(e: PointerEvent): void {
  if (e.pointerId !== cssGridResizeActivePointerId) return
  endCssGridResizeActive()
  emit('css-grid-resize-end', { committed: false })
}

function startCssGridResizeActive(pointerId: number, x: number, y: number): void {
  cssGridResizeActivePointerId = pointerId
  cssGridResizeTouchActive.value = true
  resizeHandleEl.value?.setPointerCapture?.(pointerId)
  window.addEventListener('pointermove', onCssGridResizeActiveMove)
  window.addEventListener('pointerup', onCssGridResizeActiveUp)
  window.addEventListener('pointercancel', onCssGridResizeActiveCancel)
  emit('css-grid-resize-start', { x, y })
}

/** Idempotent — same belt-and-braces reasoning as `endActiveTouchDrag`. Does
 *  NOT itself emit `css-grid-resize-end` — every caller above emits its own
 *  `committed` value right after calling this. */
function endCssGridResizeActive(): void {
  window.removeEventListener('pointermove', onCssGridResizeActiveMove)
  window.removeEventListener('pointerup', onCssGridResizeActiveUp)
  window.removeEventListener('pointercancel', onCssGridResizeActiveCancel)
  cssGridResizeActivePointerId = null
  cssGridResizeTouchActive.value = false
}

function onCssGridResizeTouchTimeout(): void {
  cssGridResizeTouchTimer = null
  if (!cssGridResizeTouchState || !cssGridResizeTouchStart) return
  cssGridResizeTouchState = advanceOnTimeout(cssGridResizeTouchState)
  if (cssGridResizeTouchState !== 'armed') return

  const { pointerId } = cssGridResizeTouchStart
  const { x, y } = cssGridResizeTouchLatest ?? cssGridResizeTouchStart
  clearCssGridResizeTouchTracking()

  cssGridResizeTouchArmed.value = true
  window.setTimeout(() => {
    cssGridResizeTouchArmed.value = false
  }, TOUCH_ARMED_VISUAL_MS)

  startCssGridResizeActive(pointerId, x, y)
}

/** The corner resize handle's pointerdown handler — mouse/pen start
 *  immediately (§8 layer 2), touch runs the long-press gate above before
 *  arming. */
function onCssGridResizeHandlePointerDown(e: PointerEvent): void {
  if (!props.resizable) return
  if (e.pointerType !== 'touch') {
    if (cssGridResizeActivePointerId != null) return // belt-and-braces — a resize is already live
    startCssGridResizeActive(e.pointerId, e.clientX, e.clientY)
    return
  }
  if (cssGridResizeTouchState) return
  cssGridResizeTouchState = 'pending'
  cssGridResizeTouchStart = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
  cssGridResizeTouchLatest = null
  window.addEventListener('pointermove', onCssGridResizeTouchMove)
  window.addEventListener('pointerup', onCssGridResizeTouchEnd)
  window.addEventListener('pointercancel', onCssGridResizeTouchEnd)
  window.addEventListener('pointerdown', onCssGridResizeTouchSecondPointer)
  cssGridResizeTouchTimer = setTimeout(onCssGridResizeTouchTimeout, DEFAULT_TOUCH_DRAG_DELAY.delayMs)
}

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
// the card's own grid-slot `h` was deliberately left untouched specifically
// to avoid fighting anything). `dece43d` (collapse-reflow overlay,
// `applyCollapsedHeights`/`compactVertical`) later made a collapsing card
// shrink its OWN grid slot too (補位) — CssGridGrid.vue has no built-in CSS
// transition for a grid-column/grid-row placement change, so that slot
// resize lands INSTANTLY, and `.dashboard-card.collapsed{height:100%}` means
// THIS card's root element snaps to the new size in the very same frame.
// `useAutoFlip` (#20, generic "my grid slot moved" watcher) sees exactly that
// instant snap on its OWN `.css-grid-item` parent and — correctly by its own
// contract, but WRONGLY for this specific case — FLIP-animates the WHOLE
// root element (header included) with a non-uniform `scale()` (see flip.ts's
// `computeFlipInvert`) from the old box to the new one, AT THE SAME TIME
// `onBodyEnter`/`onBodyLeave` below are already animating the BODY's real
// height. Two competing animations fire on the same toggle: one correct
// (body height), one wrong (a whole-card squish that scales the header too,
// since `scale()` isn't body-only) — which is what reads as "the transition
// is gone/broken" rather than a clean height collapse.
//
// Fix: suppress the generic auto-flip specifically while THIS card's own
// body-transition is in flight (`selfReflowing`, set for the exact duration
// `animateBodyHeight` runs) — same treatment #20 already gives `pinned`
// (a sticky card's own scroll-driven "stuck" position isn't a layout move to
// FLIP, so the generic watcher must stay out of its way). A NEIGHBOUR card
// that gets pushed up to fill the reclaimed rows (dece43d's 補位) has
// `selfReflowing === false` (it didn't toggle its own collapse), so its OWN
// useAutoFlip still plays normally — only the card that's the CAUSE of its
// own resize skips the generic watcher, not every card the reflow touches.
const selfReflowing = ref(false)

// #20 — generic FLIP for any OTHER cause of this card's grid slot moving
// (compaction settle, drag/resize settle, delete-compaction, breakpoint
// switch) — see useFlipAnimation.ts's module doc. Disabled while pinned (a
// sticky card's position change is scroll-driven, not a layout move) and
// while this card's OWN collapse/expand body transition is running (see
// `selfReflowing` above).
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
  window.removeEventListener('resize', resetPinnedMiniOutsideMobile)
  // Belt-and-braces: a card can be unmounted while a drag/resize gesture is
  // in flight — these listeners are on `window`, not this component's own
  // DOM, so Vue's own teardown would never remove them on its own.
  // F6 stage 2 — cleanup for the CSS Grid drag gesture's own (separately-
  // tracked) pending long-press and live-drag state.
  clearCssGridPendingTracking()
  endCssGridActiveDrag()
  // F6 stage 3(a) — same belt-and-braces cleanup for the CSS Grid resize
  // handle's own (separately-tracked) pending long-press and live-resize
  // state.
  clearCssGridResizeTouchTracking()
  endCssGridResizeActive()
})
</script>

<template>
  <div ref="rootEl" class="dashboard-card" :class="{ pinned, collapsed, 'pinned-mini': pinnedMini }">
    <header
      ref="dragHandleEl"
      class="drag-handle"
      :class="{ 'touch-armed': touchArmed, 'touch-dragging': touchDragActive }"
      @pointerdown="onCssGridDragHandlePointerDown"
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
    <!-- CSS Grid renderer's own corner resize handle: only while NOT pinned
         (a pinned card has no resize mechanism at all — it's `position:
         sticky` in its own grid cell, see CssGridGrid.vue's module doc), not
         collapsed (a header-only card has no body to grow) and `resizable`
         (the caller has already folded in 鎖定布局 + the pinned/collapsed
         exceptions — see `resizable` prop's own doc). -->
    <div
      v-if="!pinned && !collapsed && resizable"
      ref="resizeHandleEl"
      class="css-grid-resize-handle"
      :class="{ 'touch-armed': cssGridResizeTouchArmed, 'touch-dragging': cssGridResizeTouchActive }"
      v-tooltip="t('analyzer.layout.cssGridResizeHandle')"
      :aria-label="t('analyzer.layout.cssGridResizeHandle')"
      role="separator"
      aria-orientation="horizontal"
      @pointerdown="onCssGridResizeHandlePointerDown"
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
  /* F6 stage 3(a) — positioning context for `.css-grid-resize-handle`
     (absolute, bottom-right corner) on an ORDINARY (non-pinned) card. Was
     previously only added on `.dashboard-card.pinned` (see that rule's own
     B18 doc) since only the pinned handle existed; harmless on every other
     card — nothing else in this component relies on `.dashboard-card`
     itself staying an unestablished positioning context. */
  position: relative;
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
/* F1 phase 5 (B102a/b) — set for the FULL duration of a live handed-off touch
   drag (see `touchDragActive` above), not just the brief `.touch-armed`
   confirm flash: a best-effort "clean touch-action handoff" so a fast
   hold-then-immediately-swipe has the best chance of staying a drag rather
   than getting re-captured by native vertical pan — see this component's own
   module doc for the honest caveat that `touch-action` changes mid-gesture
   are not guaranteed to apply to the SAME physical touch on every engine. */
.drag-handle.touch-dragging {
  touch-action: none;
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
  /* B113-follow-up (2026-07-31) — this `overflow: auto` is the OTHER half of
   * the 3D scatter card's scrollbar-feedback flicker (see Scatter3dChart.vue's
   * `.scatter-3d` doc for the full mechanism): a stray oversized echarts-gl
   * `domRoot` spilling out of its host used to inflate THIS element's
   * scrollHeight/scrollWidth, whose resulting scrollbars then ate ~15-17px of
   * content-box space on each axis, which is what the chart's ResizeObserver
   * reacted to, round and round. Considered adding `scrollbar-gutter: stable`
   * here too (it would remove the scrollbar-driven WIDTH swing at its own
   * source, independent of any one card's content) but deliberately did NOT:
   * it would permanently reserve gutter space on EVERY card body, including
   * the many that never scroll, which is a visible regression across the
   * whole dashboard for a problem that Scatter3dChart's own fix (clip the
   * overflow before it ever reaches this element) already eliminates
   * completely on its own. Left as plain `overflow: auto`, unchanged. */
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
   dominate the screen). Applies identically at both breakpoints now.

   B112 — this rule deliberately does NOT add its own border/radius/width
   chrome (a pinned card reads as "part of this page, stuck to the top", not
   a separate floating panel). The one thing kept here on purpose is the
   `box-shadow` below: a pinned card visually overlaps whatever content has
   scrolled underneath it, and a subtle shadow is what keeps its edge legible
   against that — genuinely needed for the sticky affordance, not a
   "floating card" cue. */
.dashboard-card.pinned {
  /* Override the base rule's `height: 100%` — a sticky card should size to
     its natural content height, not stretch to fill its grid cell. */
  height: auto;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
}
.dashboard-card.pinned .body {
  /* Cap the body so the whole sticky card respects max-height instead of
     overflowing it — the header stays fixed-size, the body scrolls/clips
     internally beyond that (TrackMap's own fillHeight mode already fills
     whatever height its host gives it, verified against this constraint). */
  min-height: 0;
}

/* F6 stage 3(a) — CSS Grid renderer's own corner resize handle. `position:
   relative` on `.dashboard-card` (the base rule, above) already provides the
   positioning context this needs. Sized/themed via the `--vgl-resizer-*`
   custom properties declared on AnalyzerView.vue's `.analyzer` (an ANCESTOR
   of every DashboardCard instance) — see that file's own doc for why the
   name is kept despite grid-layout-plus's removal. */
.css-grid-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  box-sizing: border-box;
  width: var(--vgl-resizer-size, 10px);
  height: var(--vgl-resizer-size, 10px);
  cursor: se-resize;
  /* B102c-style fix, applied from the start here (see this handle's own
     module doc — mirrors `.pin-resize-handle`'s touch-action treatment
     exactly): `pan-y` keeps native vertical scroll recovery available while
     the touch long-press gate is still pending, only committing to
     `touch-action: none` once the hold is confirmed (`.touch-dragging`
     below). Mouse/pen are unaffected either way. */
  touch-action: pan-y;
}
.css-grid-resize-handle.touch-armed {
  background: color-mix(in srgb, var(--color-accent) 18%, transparent);
}
.css-grid-resize-handle.touch-dragging {
  touch-action: none;
}
/* Same invisible 44px coarse-pointer hit-slop as `.pin-resize-handle::after`
   (§8 layer 3 policy). */
:root[data-any-pointer-coarse] .css-grid-resize-handle::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  width: 44px;
  height: 44px;
}
/* B59 — mobile resize is vertical-only under this renderer too (see
   cssGridResize.ts's `mobile` param) — swap the cursor to `ns-resize` at the
   same breakpoint the pinned handle's own B99 fix uses, for the same reason:
   a diagonal `se-resize` cursor would misrepresent a gesture that only ever
   changes height here. */
@media (max-width: 768px) {
  .css-grid-resize-handle {
    cursor: ns-resize;
  }
}
.css-grid-resize-handle::before {
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
