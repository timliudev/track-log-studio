/**
 * #19 — FLIP (First-Last-Invert-Play) math for the 釘選 (pin) Teleport move.
 *
 * DashboardCard's pinned content is physically relocated by `<Teleport>`
 * (toggling `:disabled` moves the same DOM node between the grid slot and
 * `#dashboard-pinned-anchor` — see AnalyzerView's module doc) rather than
 * being unmounted/remounted, so Vue's own `<Transition>` never fires an
 * enter/leave for it (there is no vnode add/remove to hook into) and
 * `<TransitionGroup>`'s automatic FLIP doesn't apply either (its move
 * animation only tracks siblings that stay under the SAME parent element,
 * not a node that jumps to a different subtree). The move has to be animated
 * by hand: measure the card's on-screen rect just BEFORE the toggle (First),
 * measure it again just AFTER Vue has patched the DOM into its new spot
 * (Last), compute the transform that would make the new position LOOK like
 * the old one (Invert), apply it with no transition, then clear it with a
 * transition enabled so the browser animates from the inverted (old-looking)
 * state back to identity (Play) — the classic FLIP technique.
 *
 * This module is only the INVERT half's math (a pure function of two
 * measured rects) plus the shared tuning constants — kept pure/DOM-free so
 * it's unit-testable without mounting a component; DashboardCard.vue does
 * the actual `getBoundingClientRect`/style-mutation/`transitionend` wiring
 * around it (same "pure math here, thin DOM glue in the component/composable"
 * split as gridGutter.ts/useGridGutters.ts).
 */

/** The subset of `DOMRect` this module actually needs — lets callers pass a
 *  real `DOMRect` (from `getBoundingClientRect`) or a plain object (tests). */
export interface FlipRect {
  left: number
  top: number
  width: number
  height: number
}

/** The CSS transform that makes `after` visually occupy `before`'s box:
 *  translate by the position delta, then scale by the size ratio (applied
 *  from `top left` so the translate/scale compose the way `transform-origin:
 *  top left` expects — see DashboardCard.vue's use of this). */
export interface FlipTransform {
  dx: number
  dy: number
  sx: number
  sy: number
}

/** Animation tuning — centralised here (rather than left as magic numbers at
 *  each call site) so both are easy to find/adjust together. Same
 *  non-linear "ease-out-ish" curve App.vue's tab-switch slide already uses
 *  (`cubic-bezier(0.22, 1, 0.36, 1)`), reused here rather than invented fresh
 *  so the app's transitions read as one consistent motion language. */
export const PIN_FLIP_DURATION_MS = 320
export const PIN_FLIP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * Compute the "Invert" transform: applied to the element while it's
 * physically at `after`'s position/size, it makes the element LOOK like it's
 * still at `before` — the starting point a FLIP animation then transitions
 * away from back to identity (translate 0/scale 1).
 *
 * A zero/negative `after` dimension (element momentarily collapsed, e.g.
 * `display:none` mid-toggle) falls back to scale 1 rather than dividing by
 * zero / producing `Infinity`/`NaN`, which would otherwise wreck the CSS
 * transform.
 */
export function computeFlipInvert(before: FlipRect, after: FlipRect): FlipTransform {
  const sx = after.width > 0 ? before.width / after.width : 1
  const sy = after.height > 0 ? before.height / after.height : 1
  return {
    dx: before.left - after.left,
    dy: before.top - after.top,
    sx,
    sy,
  }
}

/** True when a transform is close enough to identity that animating it would
 *  be imperceptible — lets the caller skip the whole transition/reflow dance
 *  for a toggle that didn't actually move the element (e.g. pinning while
 *  already scrolled such that the anchor and the grid slot coincide). */
export function isFlipNoop(t: FlipTransform, epsilonPx = 0.5): boolean {
  return (
    Math.abs(t.dx) < epsilonPx &&
    Math.abs(t.dy) < epsilonPx &&
    Math.abs(t.sx - 1) < 0.01 &&
    Math.abs(t.sy - 1) < 0.01
  )
}

/** Render a {@link FlipTransform} as a CSS `transform` value — paired with
 *  `transform-origin: top left` at the call site (translate/scale compose
 *  correctly from the top-left corner, matching how `dx`/`dy` are measured
 *  from each rect's own `left`/`top`). */
export function flipTransformCss(t: FlipTransform): string {
  return `translate(${t.dx}px, ${t.dy}px) scale(${t.sx}, ${t.sy})`
}
