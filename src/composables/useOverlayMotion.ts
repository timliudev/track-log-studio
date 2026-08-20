import { PIN_FLIP_EASING } from '@/domain/layout/flip'

/**
 * B118 — shared enter/exit choreography for CardMenu's popover/bottom-sheet
 * and FileBar's three modal pickers, extracted so all four call sites play
 * the exact same "insert hidden, force reflow, release into a transitioned
 * state, wait for transitionend-or-a-timeout" dance rather than four
 * hand-rolled copies. The dance itself is not new — it is
 * `useFlipAnimation.ts`'s `playFlipTransition` generalised from "FLIP a
 * rect" to "transition to an arbitrary transform/opacity target"; see that
 * function's comments for why each step (no-transition write, forced
 * reflow, THEN a transitioned release) is necessary rather than a single
 * style write.
 */

/** Desktop popover / modal-dialog enter+exit duration. This class of
 *  overlay has no gesture momentum behind it — opened/closed by a discrete
 *  click or Escape, never a drag release — so unlike the mobile sheet below
 *  it should read as critically damped: no overshoot. */
export const OVERLAY_DURATION_MS = 220
/** Reuses the app's one house easing (already shared by `App.vue`'s tab
 *  slide and `flip.ts`'s FLIP release) instead of adding a THIRD hardcoded
 *  copy of the same cubic-bezier string — see ISSUES.md M17's complaint
 *  that this exact string is already duplicated twice. */
export const OVERLAY_EASING = PIN_FLIP_EASING

/** Mobile bottom-sheet ENTER — slower than the desktop popover (a bigger,
 *  heavier surface travelling further) and, only on the way in, eased with
 *  a slight overshoot: a sheet arriving under its own momentum settling
 *  past-then-back is the "surface with momentum" case Apple's fluid-
 *  interfaces guidance calls out, unlike the click-driven desktop popover
 *  above which has no momentum to express. */
export const SHEET_ENTER_DURATION_MS = 320
/** A "back-out" curve — small, deliberate overshoot then settle. Not the
 *  house easing (that has none) and not tuned as a physical spring; picked
 *  as a plain value here per this task's constraints (no dependency on
 *  design tokens that may not exist yet on this branch) — a candidate for a
 *  future `--ease-spring`/`--ease-bounce` token (see ISSUES.md M17). */
export const SHEET_ENTER_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
/** Mobile sheet LEAVE and drag "spring back to rest" (drag released without
 *  clearing the dismiss threshold) both use the plain house easing, not the
 *  overshoot one above — overshooting INTO a dismissal would visually read
 *  as the sheet bouncing back up, the opposite of "it's gone"; overshooting
 *  a "never mind, staying open" return is more defensible but kept
 *  consistent with the leave path rather than adding a THIRD easing. */
export const SHEET_LEAVE_DURATION_MS = 240
export const SHEET_RETURN_DURATION_MS = 240

/** Reduced-motion replacement for every duration above — see
 *  `prefersReducedMotion` in `useFlipAnimation.ts`. A short opacity-only
 *  cross-fade, no transform, for both CardMenu (desktop scale/mobile slide)
 *  and FileBar's dialogs (scrim/panel). */
export const REDUCED_MOTION_DURATION_MS = 120

/** The two CSS properties this module ever writes/transitions — kept in one
 *  place so the `transition` shorthand string and the `transitionend`
 *  property-name check can never drift apart. */
const ANIMATED_PROPS = ['transform', 'opacity'] as const

export interface OverlayMotionStep {
  transform?: string
  opacity?: string
}

function applyOverlayStyle(el: HTMLElement, style: OverlayMotionStep): void {
  if (style.transform !== undefined) el.style.transform = style.transform
  if (style.opacity !== undefined) el.style.opacity = style.opacity
}

/**
 * Write `hidden` onto `el` with `transition: none`, then force a
 * synchronous reflow (`el.offsetWidth`) — establishes a real "before" frame
 * the browser can transition FROM once a later, separate style write
 * re-enables the transition. Only needed before an ENTER: the element is
 * brand new to the DOM (or, for CardMenu's mobile sheet, was just made
 * visible), so without this the "hidden" write and the "release to rest"
 * write would land in the same tick and the browser would coalesce them
 * into one paint with no visible animation at all — exactly the bug
 * `playFlipTransition`'s own forced-reflow step avoids for FLIP moves.
 * A LEAVE (or a drag's "spring back") never needs this: the element is
 * already showing a real painted frame — from a previous frame's rest
 * state, or from the last pointermove's drag position — to transition from.
 */
export function primeOverlayEnter(el: HTMLElement, hidden: OverlayMotionStep): void {
  el.style.transition = 'none'
  applyOverlayStyle(el, hidden)
  void el.offsetWidth
}

/**
 * Transition `el` to `target` and call `onDone` once — on the real
 * `transitionend` for whichever of transform/opacity actually changed, or a
 * `durationMs + 100` fallback timeout if that event never fires. The
 * fallback matters for more than just belt-and-braces robustness: this
 * repo's test environment (happy-dom, see `useFlipAnimation.test.ts`'s own
 * comment on this) never dispatches `transitionend` at all, so without it
 * every `onDone`/Vue `<Transition>` `done()` callback here would simply
 * never fire under test.
 *
 * Returns a canceller: clears the pending rAF/timeout/listener WITHOUT
 * calling `onDone`. Callers use this to interrupt an in-flight transition
 * (CardMenu grabbing a mid-animation sheet, or a rapid re-open/re-close of
 * any of these overlays) without leaving a stray timer that later fires
 * against a DOM node the caller has since moved on from.
 */
export function playOverlayTransition(
  el: HTMLElement,
  target: OverlayMotionStep,
  options: { durationMs: number; easing: string; onDone?: () => void },
): () => void {
  let cleanup: () => void = () => {}
  const raf = requestAnimationFrame(() => {
    el.style.transition = ANIMATED_PROPS.map((p) => `${p} ${options.durationMs}ms ${options.easing}`).join(', ')
    applyOverlayStyle(el, target)
    function onTransitionEnd(e: TransitionEvent): void {
      if (e.target === el && (ANIMATED_PROPS as readonly string[]).includes(e.propertyName)) finish()
    }
    function finish(): void {
      el.style.transition = ''
      el.removeEventListener('transitionend', onTransitionEnd)
      options.onDone?.()
    }
    el.addEventListener('transitionend', onTransitionEnd)
    // Belt-and-braces, and the ONLY path that fires under happy-dom — see
    // this function's doc above.
    const timeout = setTimeout(finish, options.durationMs + 100)
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
