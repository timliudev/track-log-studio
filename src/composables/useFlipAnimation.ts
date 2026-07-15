import { onBeforeUnmount, onMounted, watch, type ComputedRef, type Ref } from 'vue'
import {
  computeFlipInvert,
  isFlipNoop,
  flipTransformCss,
  PIN_FLIP_DURATION_MS,
  PIN_FLIP_EASING,
  type FlipRect,
} from '@/domain/layout/flip'

/**
 * #20 — generalises #19's pin-Teleport FLIP (see flip.ts's module doc for the
 * underlying First-Last-Invert-Play technique) into two reusable pieces so
 * DashboardCard can also FLIP-animate the OTHER way its grid slot can move:
 * grid-layout-plus's own compaction/settle after a drag, resize, delete, or
 * breakpoint switch — none of which DashboardCard triggers itself (they're
 * driven by AnalyzerView reassigning the shared `layout` array), so there's
 * no single "before I emit an event" moment to measure from the way the pin
 * toggle has. Instead {@link useAutoFlip} watches for the after-the-fact
 * DOM evidence that the card's grid slot moved — grid-item.vue (the library
 * component that actually owns each card's position) writes its computed
 * `transform`/`width`/`height` into the SAME inline `style` attribute on the
 * `<section class="vgl-item">` wrapper that is this card's own parent
 * element (see grid-item.vue's `createStyle()`/`:style="state.style"`). The
 * wrapper is also the stable geometry source: FLIP writes a temporary
 * transform on the card itself, so using the card's rect as the next baseline
 * would mistake that in-flight visual transform for a later grid move and
 * restart the animation whenever the wrapper rewrites its style.
 */

/** True when the user has asked the OS/browser for reduced motion — every
 *  FLIP animation in this module (and DashboardCard's own pin-toggle FLIP)
 *  is skipped under this, matching the rest of the app's reduced-motion
 *  convention. Centralised here (rather than duplicated per call site) now
 *  that two independent triggers (pin-toggle, auto-flip) both need it. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * Play the "invert, then play" half of a FLIP transition on `el`: `el` is
 * assumed to ALREADY be at its new/final position (`after`, measured fresh
 * inside this call) — this applies the inverted transform so it briefly
 * LOOKS like it's still at `before`, then releases it with a transition so
 * the browser animates the visible move/resize. Extracted from DashboardCard's
 * (#19) pin-toggle handling so {@link useAutoFlip} can reuse the exact same
 * DOM/timing choreography (no-transition invert -> forced reflow -> rAF ->
 * transitioned release -> `transitionend`-or-timeout cleanup) rather than a
 * second hand-rolled copy.
 *
 * A no-op transform (`isFlipNoop`) skips the whole dance and returns a no-op
 * cleanup — nothing to animate, nothing to clean up.
 *
 * Returns a cleanup function that cancels the in-flight animation (pending
 * rAF, pending fallback timeout, and any attached listener) and — belt-and-
 * braces — resets `el`'s inline transform/transition back to nothing; callers
 * should invoke it before starting a NEW flip on the same element (an
 * interrupted flip should never leave a stray transform behind) and on
 * unmount.
 */
export function playFlipTransition(
  el: HTMLElement,
  before: FlipRect,
  options: { durationMs?: number; easing?: string } = {},
): () => void {
  const durationMs = options.durationMs ?? PIN_FLIP_DURATION_MS
  const easing = options.easing ?? PIN_FLIP_EASING

  const after = el.getBoundingClientRect()
  const t = computeFlipInvert(before, after)
  if (isFlipNoop(t)) return () => {}

  el.style.transition = 'none'
  el.style.transformOrigin = 'top left'
  el.style.transform = flipTransformCss(t)
  // Force a synchronous style flush so the browser registers the INVERTED
  // (no-transition) state before the next frame re-enables the transition —
  // see DashboardCard's original (#19) comment for why this matters (avoids
  // the browser coalescing both style writes into one paint).
  void el.offsetWidth

  let cleanup: () => void = () => {}
  const raf = requestAnimationFrame(() => {
    el.style.transition = `transform ${durationMs}ms ${easing}`
    el.style.transform = ''
    function onTransitionEnd(e: TransitionEvent): void {
      if (e.target === el && e.propertyName === 'transform') finish()
    }
    function finish(): void {
      el.style.transition = ''
      el.style.transform = ''
      el.style.transformOrigin = ''
      el.removeEventListener('transitionend', onTransitionEnd)
    }
    el.addEventListener('transitionend', onTransitionEnd)
    // Belt-and-braces: guarantee cleanup even if `transitionend` never fires
    // (e.g. the element is hidden/removed mid-animation).
    const timeout = setTimeout(finish, durationMs + 100)
    cleanup = () => {
      clearTimeout(timeout)
      el.removeEventListener('transitionend', onTransitionEnd)
    }
  })
  return () => {
    cancelAnimationFrame(raf)
    cleanup()
  }
}

/** grid-layout-plus's own modifier classes on a card's `.vgl-item` wrapper
 *  while ITS OWN drag/resize gesture is live (see node_modules/grid-layout-
 *  plus's `className` computed: `${ns}-item--dragging` / `--resizing`) — the
 *  card is following the pointer 1:1 during these, so a FLIP animation must
 *  NOT kick in (it would visibly fight the drag); only the eventual SETTLE
 *  (compaction closing a hole left by the drag, e.g.) should be animated. */
const DEFAULT_SKIP_CLASSES = ['vgl-item--dragging', 'vgl-item--resizing']

export interface AutoFlipOptions {
  /** When provided and `false`, the observer is fully disabled — used by
   *  DashboardCard to turn this OFF while `pinned` (its Teleport move is
   *  already animated explicitly, see the component's own `onTogglePinned`;
   *  running both would double-animate the same transform). Re-enabling is
   *  deliberately debounced past {@link PIN_FLIP_DURATION_MS} (see
   *  `useAutoFlip`'s `watch`) so this generic observer's baseline
   *  measurement never races that dedicated animation's own in-flight
   *  transform. */
  enabled?: Ref<boolean> | ComputedRef<boolean>
  /** Parent element class name(s) that mark an in-progress gesture this
   *  card is itself the target of — see {@link DEFAULT_SKIP_CLASSES}. */
  skipClasses?: string[]
}

/**
 * Auto-FLIP a card's root element whenever its PARENT's inline `style`
 * attribute changes shape (grid-layout-plus repositioning/resizing the
 * `.vgl-item` wrapper this card lives in) — see this module's doc for why a
 * `MutationObserver` on that one attribute is the right signal. Geometry is
 * always measured from the unanimated wrapper; `target` itself is animated
 * since DashboardCard fills that wrapper, so the visual result is identical
 * without this composable needing to mutate a DOM node it does not own.
 *
 * Skips while:
 *  - `prefers-reduced-motion: reduce` is active (checked BEFORE measuring
 *    anything — under reduced motion this composable does no work at all
 *    for that mutation, not even a `getBoundingClientRect` call);
 *  - the card's own drag/resize gesture is live (`skipClasses`) — the
 *    position cache is still resynced in this case (so the NEXT real move,
 *    e.g. the post-drag settle, is measured from the right baseline), it's
 *    only the animation itself that's skipped;
 *  - `enabled` is explicitly `false`.
 */
export function useAutoFlip(target: Ref<HTMLElement | null>, options: AutoFlipOptions = {}): void {
  const enabled = options.enabled
  const skipClasses = options.skipClasses ?? DEFAULT_SKIP_CLASSES

  let observer: MutationObserver | null = null
  let lastRect: FlipRect | null = null
  let cleanupPlay: (() => void) | null = null
  // B32b — pending debounced re-attach timer (see the `watch(enabled, ...)`
  // below). Tracked so a LATER `enabled` flip can cancel it: without this, a
  // rapid pin -> unpin -> re-pin (well inside PIN_FLIP_DURATION_MS + 40, e.g.
  // switching which card is pinned and then re-pinning the first one again)
  // left the FIRST toggle's stale timer armed. It fired regardless of the
  // CURRENT `enabled` state and unconditionally called `attach()`, which
  // re-observes `target.value.parentElement` AS IT IS AT THAT LATER MOMENT —
  // while pinned, that's `#dashboard-pinned-anchor` (the sticky anchor), not
  // the grid `.vgl-item` wrapper — silently violating "auto-flip is disabled
  // while pinned" and leaving a dangling observer nothing was meant to create.
  let reattachTimer: ReturnType<typeof setTimeout> | null = null

  function isGesturing(): boolean {
    const parent = target.value?.parentElement
    return !!parent && skipClasses.some((cls) => parent.classList.contains(cls))
  }

  function onMutate(): void {
    // Reduced motion: bail out before even measuring — this mutation is
    // simply not tracked (see module doc for the acceptable one-time-jump
    // trade-off if the OS preference changes mid-session).
    if (prefersReducedMotion()) return

    const el = target.value
    const parent = el?.parentElement
    if (!el || !parent) return
    // Do not measure `el` here. During an in-flight FLIP it carries the
    // inverse transform written by playFlipTransition(), while the wrapper
    // remains at its true grid position. Feeding that transient child rect
    // back into `lastRect` turns harmless/redundant wrapper style writes into
    // a repeated invert -> release cycle.
    const rect = parent.getBoundingClientRect()

    if (isGesturing()) {
      lastRect = rect
      return
    }

    const before = lastRect
    lastRect = rect
    if (!before) return

    const t = computeFlipInvert(before, rect)
    if (isFlipNoop(t)) return

    cleanupPlay?.()
    cleanupPlay = playFlipTransition(el, before)
  }

  function detach(): void {
    observer?.disconnect()
    observer = null
    lastRect = null
  }

  function attach(): void {
    detach()
    const el = target.value
    if (!el?.parentElement) return
    lastRect = el.parentElement.getBoundingClientRect()
    observer = new MutationObserver(onMutate)
    observer.observe(el.parentElement, { attributes: true, attributeFilter: ['style'] })
  }

  function isEnabled(): boolean {
    return enabled ? enabled.value : true
  }

  // `target` (DashboardCard's `rootEl`) is a STABLE ref assigned exactly once
  // per component instance — Teleport relocates the same physical node
  // rather than reassigning the ref to a different element — so `onMounted`
  // alone is sufficient; a `watch(target, ...)` was tried and dropped: Vue's
  // default (pre-flush) watcher timing defers that callback to the next
  // microtask rather than running it synchronously with the ref assignment,
  // which showed up as a spurious extra `getBoundingClientRect` call
  // surfacing later (e.g. inside an unrelated `await nextTick()`) in tests
  // that spy on it right after mount.
  onMounted(() => {
    if (isEnabled()) attach()
  })

  if (enabled) {
    watch(enabled, (next) => {
      // B32b — cancel any PREVIOUS debounced re-attach before reacting to
      // this flip: `enabled` toggling again before the old timer fires (e.g.
      // pin -> unpin -> re-pin inside the debounce window) must not leave
      // that stale timer armed — see `reattachTimer`'s own doc above.
      if (reattachTimer != null) {
        clearTimeout(reattachTimer)
        reattachTimer = null
      }
      if (!next) {
        detach()
        return
      }
      // Debounced re-attach — see AutoFlipOptions.enabled's doc for why: this
      // fires right as e.g. a pin toggle re-enables the observer, and the
      // card's dedicated pin-FLIP (DashboardCard's onTogglePinned) is very
      // likely still mid-transition at that exact instant. Measuring `lastRect`
      // NOW would capture the element still under that animation's inverted
      // transform rather than its true settled position. Waiting past that
      // animation's own duration guarantees a clean baseline.
      reattachTimer = setTimeout(() => {
        reattachTimer = null
        // Re-check `enabled` at fire time (belt-and-braces on top of the
        // cancellation above): only actually re-attach if still enabled, so a
        // toggle sequence that raced past the `clearTimeout` above some other
        // way still can't arm a wrongly-targeted observer.
        if (isEnabled()) attach()
      }, PIN_FLIP_DURATION_MS + 40)
    })
  }

  onBeforeUnmount(() => {
    if (reattachTimer != null) {
      clearTimeout(reattachTimer)
      reattachTimer = null
    }
    detach()
    cleanupPlay?.()
  })
}
