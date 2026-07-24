import { pendingTouchIntent, type Point2D } from '../analysis/chartPointerGesture'

/**
 * F5 phase 2 — pure geometry/threshold helpers for the single-focus view's
 * left/right swipe-to-switch gesture (MobileFocusView.vue). Kept out of the
 * component so the distance/dominance math can be unit-tested offline (the
 * real pointerdown/move/up/cancel wiring, pointer capture, and touch-action
 * live in the component itself — that part needs a real browser to verify
 * arbitration against the map/chart's own gestures, see this module's sibling
 * `horizontalGestureCards.ts` and the device-test checklist in the commit
 * that introduces this).
 *
 * Re-exports `pendingTouchIntent` from `chartPointerGesture.ts` rather than
 * re-implementing the same "slop, then horizontal-vs-vertical dominance"
 * decision a second time — that function already encodes the exact split
 * this gesture needs (pending/pan/scroll), just applied here to the whole
 * focus-view body instead of one chart's plotting area.
 */
export { pendingTouchIntent, type Point2D }

/** Same slop as the chart touch gestures (`TOUCH_SLOP_PX` in UPlotChart.vue)
 *  — small enough that a stationary tap/long-press never misreads as a
 *  swipe, large enough to absorb finger jitter before committing to a
 *  direction. */
export const SWIPE_SLOP_PX = 10

/**
 * Minimum net horizontal travel (CSS px) at pointer-release for a swipe to
 * actually switch tabs. Deliberately bigger than `SWIPE_SLOP_PX`: the slop
 * only decides "is this drag horizontal, not vertical scroll" (so the body
 * can stop treating it as a candidate scroll early and let the gesture
 * commit to `touch-action: none`-style capture) — it says nothing about
 * whether the user meant a full page-turn versus a small horizontal wobble
 * partway through an otherwise-vertical scroll attempt. Requiring real
 * travel at release avoids flipping tabs on a drag that barely cleared the
 * slop.
 */
export const SWIPE_TRIGGER_PX = 60

/**
 * The tab a swipe should switch to, or `null` if the swipe is a no-op —
 * either it didn't travel far enough, `currentId` isn't in `ids` (defensive;
 * shouldn't happen, mirrors MobileFocusView's own `activeId` fallback), or it
 * would go past the first/last tab (v1: no wrap-around, design doc §7 item
 * 4).
 *
 * Direction convention: `dx` is the finger's net horizontal displacement
 * (release x − start x), same sign convention as `PointerEvent.clientX`
 * deltas elsewhere in this codebase (e.g. `panRange`'s `deltaX`). A negative
 * `dx` (finger moved LEFT) advances to the NEXT tab — the same "content
 * follows the finger, revealing what's to the right" convention as a mobile
 * OS home-screen page swipe. A positive `dx` (finger moved RIGHT) goes to
 * the PREVIOUS tab.
 */
export function resolveSwipeTarget(
  ids: readonly string[],
  currentId: string,
  dx: number,
  triggerPx: number = SWIPE_TRIGGER_PX,
): string | null {
  if (Math.abs(dx) <= triggerPx) return null
  const index = ids.indexOf(currentId)
  if (index === -1) return null
  const nextIndex = dx < 0 ? index + 1 : index - 1
  if (nextIndex < 0 || nextIndex >= ids.length) return null
  return ids[nextIndex] ?? null
}
