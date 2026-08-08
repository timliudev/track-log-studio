<script setup lang="ts">
/**
 * F2 — the grouped card add/remove/locate menu replacing B98's toolbar-only
 * add-chart buttons. A toolbar toggle button opens a popover listing every
 * STATIC card (grouped by function — see cardGroups.ts) plus a dedicated
 * "圖表" section listing every chart instance one-to-many (each with its own
 * 定位/delete, and an "＋新增圖表" row at the bottom calling the same
 * add-chart actions the old standalone toolbar buttons used).
 *
 * Presentation-only: AnalyzerView computes which cards are checked/locatable
 * (folding in the visibility store, structural rules, and the cvtDynamics
 * feature flag) and passes them down as plain data; this component only
 * renders rows and emits user intent (`toggle`/`locate`/`add-*`/`remove-chart`).
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { prefersReducedMotion } from '@/composables/useFlipAnimation'
import {
  primeOverlayEnter,
  playOverlayTransition,
  OVERLAY_DURATION_MS,
  OVERLAY_EASING,
  SHEET_ENTER_DURATION_MS,
  SHEET_ENTER_EASING,
  SHEET_LEAVE_DURATION_MS,
  SHEET_RETURN_DURATION_MS,
  REDUCED_MOTION_DURATION_MS,
  type OverlayMotionStep,
} from '@/composables/useOverlayMotion'
import {
  pushSample,
  estimateVelocityPxPerSec,
  dragTranslateY,
  shouldDismissSheet,
  parseTranslateY,
  type PointerSample,
} from '@/domain/interaction/sheetPhysics'

export interface CardMenuStaticEntry {
  id: string
  title: string
  /** Current visibility-store preference (data-default already folded in) —
   *  drives the row's checkbox. */
  checked: boolean
  /** Whether the card is ACTUALLY rendered right now (checked AND every
   *  structural/flag gate passes) — an unlocatable row's 定位 button is
   *  disabled rather than hidden, so the user can still see/toggle it. */
  locatable: boolean
}

export interface CardMenuGroup {
  id: string
  label: string
  items: CardMenuStaticEntry[]
}

export interface CardMenuChartEntry {
  /** The chart's own store id (for remove-chart / analyzerStore lookups). */
  id: number
  /** The chart's grid item id (chartItemId(id)) — what toggle/locate key off. */
  itemId: string
  title: string
  checked: boolean
  locatable: boolean
}

defineProps<{
  groups: CardMenuGroup[]
  charts: CardMenuChartEntry[]
  chartsGroupLabel: string
}>()

const emit = defineEmits<{
  toggle: [id: string, value: boolean]
  locate: [id: string]
  'add-timeseries': []
  'add-scatter': []
  'remove-chart': [chartId: number]
}>()

const { t } = useI18n()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)
// The popover is teleported to <body> on mobile (see the template + the
// mobile bottom-sheet styles below) so it's no longer a DOM descendant of
// `rootEl` — the outside-click check below needs its OWN ref rather than
// relying on `rootEl.contains(...)`.
const popoverEl = ref<HTMLElement | null>(null)

// Mirrors `mediaQueryRef` in useInputCapabilities.ts (not exported from
// there, so re-implemented locally): a live `matchMedia` read, never a
// load-time snapshot, so rotating a tablet across the breakpoint or resizing
// a desktop window flips the Teleport target correctly. 768px matches
// BottomNav.vue / App.vue / theme.css's shared mobile breakpoint.
const mobileMql = window.matchMedia('(max-width: 768px)')
const isMobileViewport = ref(mobileMql.matches)
function onMobileMqlChange(e: MediaQueryListEvent): void {
  isMobileViewport.value = e.matches
}
mobileMql.addEventListener('change', onMobileMqlChange)
onBeforeUnmount(() => mobileMql.removeEventListener('change', onMobileMqlChange))

// ---------------------------------------------------------------------
// B118(a) — enter/exit motion + mobile drag-to-dismiss.
//
// Desktop: a critically-damped scale+opacity pop anchored to `.menu-toggle`
// (`transform-origin: top left` in the style block below — static, since
// the popover is always anchored flush to the button's top-left corner, no
// per-open measurement needed). No overshoot: there is no gesture momentum
// behind opening/closing a menu by click/Escape, so overshoot would read as
// unmotivated wobble rather than physical response.
//
// Mobile: the popover is already a `position: fixed`, bottom-pinned panel
// (see the existing `@media (max-width: 768px)` block) — a bottom sheet in
// everything but behaviour. It now slides up on enter (with a small,
// deliberate overshoot — a surface arriving under its own momentum) and
// down on exit (no overshoot — see useOverlayMotion.ts's doc for why leave
// and enter deliberately use different easings), and can be dragged down by
// its `.sheet-grab` handle to dismiss.
//
// `<Transition :css="false">` drives both cases through the SAME three
// hooks below (`onBeforeEnter`/`onEnter`/`onLeave`) rather than declarative
// CSS transition classes, for two reasons: (1) desktop and mobile need
// different target styles/easings/durations picked at runtime off
// `isMobileViewport`/`prefersReducedMotion()`, which plain CSS classes
// can't branch on; (2) the mobile LEAVE path is shared with drag-dismiss
// (see `onGrabPointerUp` below) — a drag that crosses the dismiss threshold
// simply sets `open.value = false` and lets `onLeave` take it the rest of
// the way from WHEREVER the drag left the sheet (it reads the element's
// current transform as its own starting point, same as any other close),
// rather than drag-dismiss needing its own separate exit animation to keep
// in sync with the "normal" close path.
// ---------------------------------------------------------------------

/** Canceller for whatever `useOverlayMotion.ts` transition is CURRENTLY
 *  animating the popover (an enter, a leave, or a drag's "spring back to
 *  rest") — always cancelled before starting a new one, which is what makes
 *  grabbing a mid-animation sheet (or double-toggling the menu button
 *  quickly) pick up from wherever the sheet visually is rather than
 *  fighting or restarting from a stale baseline. */
let cancelOverlayAnim: () => void = () => {}

function overlayHiddenStep(): OverlayMotionStep {
  if (prefersReducedMotion()) return { opacity: '0' }
  if (isMobileViewport.value) return { transform: 'translateY(100%)' }
  return { transform: 'scale(0.92)', opacity: '0' }
}
function overlayRestStep(): OverlayMotionStep {
  if (prefersReducedMotion()) return { opacity: '1' }
  if (isMobileViewport.value) return { transform: 'translateY(0)' }
  return { transform: 'scale(1)', opacity: '1' }
}

function onBeforeEnter(el: Element): void {
  cancelOverlayAnim()
  primeOverlayEnter(el as HTMLElement, overlayHiddenStep())
}
function onEnter(el: Element, done: () => void): void {
  const reduced = prefersReducedMotion()
  const mobile = isMobileViewport.value
  const durationMs = reduced ? REDUCED_MOTION_DURATION_MS : mobile ? SHEET_ENTER_DURATION_MS : OVERLAY_DURATION_MS
  const easing = reduced ? OVERLAY_EASING : mobile ? SHEET_ENTER_EASING : OVERLAY_EASING
  cancelOverlayAnim = playOverlayTransition(el as HTMLElement, overlayRestStep(), { durationMs, easing, onDone: done })
}
function onLeave(el: Element, done: () => void): void {
  cancelOverlayAnim()
  const reduced = prefersReducedMotion()
  const mobile = isMobileViewport.value
  const durationMs = reduced ? REDUCED_MOTION_DURATION_MS : mobile ? SHEET_LEAVE_DURATION_MS : OVERLAY_DURATION_MS
  cancelOverlayAnim = playOverlayTransition(el as HTMLElement, overlayHiddenStep(), {
    durationMs,
    easing: OVERLAY_EASING,
    onDone: done,
  })
}

onBeforeUnmount(() => cancelOverlayAnim())

// --- Mobile drag-to-dismiss (grab handle only; see the `.sheet-grab`
// element in the template, rendered mobile-only) --------------------------

interface DragState {
  pointerId: number
  startClientY: number
  startTranslateY: number
  sheetHeightPx: number
  samples: PointerSample[]
}
let drag: DragState | null = null

function onGrabPointerDown(e: PointerEvent): void {
  const el = popoverEl.value
  if (!el) return
  const reduced = prefersReducedMotion()
  let startTranslateY = 0
  if (!reduced) {
    // Interruption: freeze wherever the sheet currently is — mid enter/
    // leave/spring-back animation, or simply at rest — before taking over
    // with 1:1 pointer tracking. Reads the CURRENT computed transform
    // rather than assuming 0, exactly so a grab mid-animation doesn't snap.
    cancelOverlayAnim()
    startTranslateY = parseTranslateY(getComputedStyle(el).transform)
    el.style.transition = 'none'
    el.style.transform = `translateY(${startTranslateY}px)`
  }
  drag = {
    pointerId: e.pointerId,
    startClientY: e.clientY,
    startTranslateY,
    sheetHeightPx: el.getBoundingClientRect().height,
    samples: pushSample([], { t: performance.now(), y: startTranslateY }),
  }
  el.setPointerCapture(e.pointerId)
  el.addEventListener('pointermove', onGrabPointerMove)
  el.addEventListener('pointerup', onGrabPointerUp)
  el.addEventListener('pointercancel', onGrabPointerUp)
}

function onGrabPointerMove(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return
  const el = popoverEl.value
  if (!el) return
  const raw = drag.startTranslateY + (e.clientY - drag.startClientY)
  const y = dragTranslateY(raw, drag.sheetHeightPx)
  drag.samples = pushSample(drag.samples, { t: performance.now(), y })
  // Under reduced motion the sheet never visually follows the finger (see
  // this function's caller doc) — samples are still recorded so the
  // dismiss-vs-return DECISION on release stays identical either way, only
  // the live visual feedback is skipped.
  if (!prefersReducedMotion()) el.style.transform = `translateY(${y}px)`
}

function endDragListeners(el: HTMLElement, pointerId: number): void {
  try {
    el.releasePointerCapture(pointerId)
  } catch {
    // Already released (e.g. the pointer left the element on its own) — the
    // browser throws in that case; nothing left to clean up.
  }
  el.removeEventListener('pointermove', onGrabPointerMove)
  el.removeEventListener('pointerup', onGrabPointerUp)
  el.removeEventListener('pointercancel', onGrabPointerUp)
}

function onGrabPointerUp(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointerId) return
  const el = popoverEl.value
  const finished = drag
  drag = null
  if (!el) return
  endDragListeners(el, finished.pointerId)

  const lastSample = finished.samples[finished.samples.length - 1]
  const releaseOffsetPx = lastSample?.y ?? 0
  const velocityPxPerSec = estimateVelocityPxPerSec(finished.samples)
  const dismiss = shouldDismissSheet({ releaseOffsetPx, velocityPxPerSec, sheetHeightPx: finished.sheetHeightPx })

  if (dismiss) {
    // Hand off to the normal close path — `onLeave` reads whatever
    // transform the drag left on `el` as ITS starting point (see this
    // section's top-of-file doc), so nothing further needs to happen here.
    open.value = false
    return
  }

  if (prefersReducedMotion()) {
    // Nothing was ever visually moved (onGrabPointerMove's guard) — no
    // spring-back animation to play, just clear the inline styles primed
    // in onGrabPointerDown.
    el.style.transition = ''
    el.style.transform = ''
    return
  }
  cancelOverlayAnim = playOverlayTransition(
    el,
    { transform: 'translateY(0)' },
    {
      durationMs: SHEET_RETURN_DURATION_MS,
      easing: OVERLAY_EASING,
      onDone: () => {
        el.style.transition = ''
        el.style.transform = ''
      },
    },
  )
}

onBeforeUnmount(() => {
  if (drag) {
    const el = popoverEl.value
    if (el) endDragListeners(el, drag.pointerId)
    drag = null
  }
})

function onDocumentPointerDown(e: PointerEvent): void {
  if (!open.value) return
  if (!(e.target instanceof Node)) return
  const insideRoot = rootEl.value?.contains(e.target) ?? false
  const insidePopover = popoverEl.value?.contains(e.target) ?? false
  if (!insideRoot && !insidePopover) open.value = false
}
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onKeydown)
  } else {
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('keydown', onKeydown)
  }
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

function onToggleInput(id: string, e: Event): void {
  emit('toggle', id, (e.target as HTMLInputElement).checked)
}
function onLocate(id: string, locatable: boolean): void {
  if (!locatable) return
  emit('locate', id)
  open.value = false
}
</script>

<template>
  <div ref="rootEl" class="card-menu">
    <button
      type="button"
      class="menu-toggle"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="7" height="7" rx="1.5" />
        <rect x="14" y="4" width="7" height="7" rx="1.5" />
        <rect x="3" y="15" width="7" height="5" rx="1.5" />
        <rect x="14" y="15" width="7" height="5" rx="1.5" />
      </svg>
      <span>{{ t('analyzer.cardMenu.button') }}</span>
    </button>

    <!-- Below 768px this is teleported straight to <body> and repositioned
         as a viewport-fixed bottom sheet (see the mobile media query in the
         style block) — button-anchored absolute positioning can't avoid
         overflowing the viewport when the button itself moves around inside
         a wrapping, space-between toolbar (B105 only swapped which edge
         overflowed, not whether one could). `disabled` keeps desktop's
         existing in-place absolute anchor untouched. Teleporting (rather
         than just changing `position` in place) also sidesteps App.vue's
         tab-switch slide transition, which applies `transform` directly to
         `.analyzer` (this component's ancestor) during enter/leave — any
         transformed ancestor becomes `position: fixed`'s containing block
         and would otherwise hijack the sheet's viewport anchoring; see
         CvtProfileEditor.vue's identical Teleport-to-body for the same
         reason. -->
    <Teleport to="body" :disabled="!isMobileViewport">
      <!-- B118(a) — `:css="false"` hands enter/exit entirely to the JS hooks
           above (onBeforeEnter/onEnter/onLeave), which pick desktop-pop vs.
           mobile-sheet target styles/easings off `isMobileViewport` — see
           this component's script-side comment block for why plain CSS
           transition classes can't do that branching. -->
      <Transition :css="false" @before-enter="onBeforeEnter" @enter="onEnter" @leave="onLeave">
        <div v-if="open" ref="popoverEl" class="popover" role="menu">
          <!-- Mobile-only grab handle — see onGrabPointerDown/Move/Up above.
               Confined to this small strip (rather than the whole sheet) so
               it never fights `.popover-scroll`'s own overflow-y:auto below
               it; `touch-action: none` (in the mobile media query) stops the
               browser's own scroll/refresh gestures from competing with our
               pointer tracking here. -->
          <div v-if="isMobileViewport" class="sheet-grab" @pointerdown="onGrabPointerDown">
            <span class="sheet-grab-bar" aria-hidden="true" />
          </div>
          <div class="popover-scroll">
            <section v-for="group in groups" :key="group.id" class="group" role="group" :aria-label="group.label">
              <h3 class="group-heading">{{ group.label }}</h3>
              <div v-for="item in group.items" :key="item.id" class="row">
                <input
                  :id="`card-menu-check-${item.id}`"
                  type="checkbox"
                  class="row-check"
                  :checked="item.checked"
                  @change="onToggleInput(item.id, $event)"
                />
                <label :for="`card-menu-check-${item.id}`" class="visually-hidden">{{
                  t('analyzer.cardMenu.toggleAria', { name: item.title })
                }}</label>
                <button
                  type="button"
                  class="row-name"
                  :disabled="!item.locatable"
                  :title="item.locatable ? undefined : t('analyzer.cardMenu.notShownHint')"
                  @click="onLocate(item.id, item.locatable)"
                >
                  {{ item.title }}
                </button>
              </div>
            </section>

            <section class="group charts-group" role="group" :aria-label="chartsGroupLabel">
              <h3 class="group-heading">{{ chartsGroupLabel }}</h3>
              <p v-if="charts.length === 0" class="empty-hint">{{ t('analyzer.cardMenu.noCharts') }}</p>
              <div v-for="c in charts" :key="c.id" class="row">
                <input
                  :id="`card-menu-check-${c.itemId}`"
                  type="checkbox"
                  class="row-check"
                  :checked="c.checked"
                  @change="onToggleInput(c.itemId, $event)"
                />
                <label :for="`card-menu-check-${c.itemId}`" class="visually-hidden">{{
                  t('analyzer.cardMenu.toggleAria', { name: c.title })
                }}</label>
                <button
                  type="button"
                  class="row-name"
                  :disabled="!c.locatable"
                  :title="c.locatable ? undefined : t('analyzer.cardMenu.notShownHint')"
                  @click="onLocate(c.itemId, c.locatable)"
                >
                  {{ c.title }}
                </button>
                <button
                  type="button"
                  class="row-delete"
                  :aria-label="t('analyzer.removeChart') + ' — ' + c.title"
                  @click="emit('remove-chart', c.id)"
                >
                  ✕
                </button>
              </div>
              <button type="button" class="add-row" @click="emit('add-timeseries')">
                ＋ {{ t('analyzer.addChart') }}
              </button>
              <button type="button" class="add-row" @click="emit('add-scatter')">
                ＋ {{ t('analyzer.addScatterChart') }}
              </button>
            </section>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.card-menu {
  position: relative;
  display: inline-flex;
}
.menu-toggle {
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
.menu-toggle svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}
.menu-toggle:hover,
.menu-toggle[aria-expanded='true'] {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.popover {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  width: min(320px, calc(100vw - 32px));
  max-height: min(70vh, 560px);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  box-shadow: 0 8px 24px color-mix(in srgb, black 25%, transparent);
  display: flex;
  flex-direction: column;
  /* B118(a) — enter/exit scales the panel out of/into `.menu-toggle`, which
     sits at this popover's own top-left corner (it's anchored `top`/`left`
     flush to the button above), so a STATIC `top left` origin is correct
     without measuring the button's position in JS. */
  transform-origin: top left;
}
/* Scrollable content lives one level deeper than `.popover` itself now —
   `.popover`'s own box needs to stay a plain flex column so the mobile
   `.sheet-grab` handle (a sibling, not part of this scrolling region) can
   sit above it without the drag handle's pointer events fighting this
   element's `overflow-y: auto` (B118(a)'s "confine the drag handling to a
   grab area" requirement). The padding/gap that used to live on `.popover`
   itself moved here unchanged, so desktop's rendered spacing (no grab
   handle, this is the popover's only content) is pixel-identical to before. */
.popover-scroll {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  padding: calc(var(--space) * 1.5);
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
}
/* Hidden on desktop by default; only ever rendered (v-if) on mobile anyway
   — this is belt-and-braces in case that ever changes, matching the
   `:root[data-any-pointer-coarse]` rules' own "CSS agrees with the JS gate"
   convention elsewhere in this file. */
.sheet-grab {
  display: none;
}

/* Q5/B105 follow-up — B105 anchored the popover to the button's right edge
   instead of its left edge, but `.card-menu` lives in `.layout-tools` (a
   `flex-wrap: wrap` row inside AnalyzerView's `justify-content:
   space-between` toolbar), so the 面板 button's horizontal position isn't
   fixed either way — whichever edge the popover anchors to can still run
   off the OPPOSITE side of a narrow viewport. Below 768px, stop anchoring
   to the button at all: `position: fixed` to the viewport, `left`/`right`
   margins instead of a button-relative `width`, so it's centered in the
   viewport and can never overflow horizontally by construction. Anchored to
   the bottom, above BottomNav.vue's fixed tab bar (`--bottom-nav-height`,
   theme.css — already 56px at this same breakpoint; the `56px` fallback
   here is redundant-but-safe). `max-height`/`overflow-y: auto` from the
   base rule above still apply, so a tall list scrolls internally instead of
   overflowing vertically. Desktop (>768px) is completely unaffected — this
   block only fires under the same breakpoint the JS `isMobileViewport` ref
   uses to enable the Teleport in the template, so the two always agree on
   which mode is active. */
@media (max-width: 768px) {
  .popover {
    position: fixed;
    z-index: 50;
    top: auto;
    left: 16px;
    right: 16px;
    width: auto;
    bottom: calc(var(--bottom-nav-height, 56px) + 16px + env(safe-area-inset-bottom, 0px));
  }
  /* B118(a) — the grab strip drag-to-dismiss is confined to (see
     onGrabPointerDown/Move/Up in the script block, and .popover-scroll's
     own doc above for why it's a SEPARATE element from the scrollable
     content). `touch-action: none` stops the browser's own scroll/pull-
     to-refresh gesture recognizers from contesting the pointer with our own
     tracking — same convention as B36's edge-swipe dead zone
     (edgeGesture.ts) and UPlotChart's touch-pan handling. */
  .sheet-grab {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    height: 22px;
    touch-action: none;
    cursor: grab;
  }
  .sheet-grab-bar {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--color-border);
  }
}

.group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group + .group {
  padding-top: calc(var(--space) * 1.5);
  border-top: 1px solid var(--color-border);
}
.group-heading {
  margin: 0 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
}
.empty-hint {
  margin: 0 0 4px;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}
.row-check {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  cursor: pointer;
}
.row-name {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  background: none;
  border: none;
  color: var(--color-text);
  font: inherit;
  padding: 4px 2px;
  cursor: pointer;
  border-radius: var(--radius);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-name:hover:not(:disabled) {
  color: var(--color-accent);
}
.row-name:disabled {
  color: var(--color-text-muted);
  cursor: default;
}
.row-delete {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius);
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.row-delete:hover {
  color: var(--color-danger, #e5484d);
  border-color: var(--color-border);
}
.add-row {
  margin-top: 4px;
  text-align: left;
  background: none;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius);
  color: var(--color-text);
  font: inherit;
  padding: 6px 8px;
  cursor: pointer;
}
.add-row:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* §8 layer 3 touch-target policy (same convention as DashboardCard.vue's
   .icon-btn / AnalyzerView.vue's .grid-gutter) — any coarse pointer present
   grows the checkbox/name/delete row controls to a comfortable ≥44px tap
   target, done via padding/min-height rather than fixed box size so the
   text itself doesn't visually balloon. */
:root[data-any-pointer-coarse] .row {
  min-height: 44px;
}
:root[data-any-pointer-coarse] .row-check {
  width: 22px;
  height: 22px;
}
:root[data-any-pointer-coarse] .row-name {
  padding: 10px 4px;
}
:root[data-any-pointer-coarse] .row-delete {
  width: 44px;
  height: 44px;
}
</style>
