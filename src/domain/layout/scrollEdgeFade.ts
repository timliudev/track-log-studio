/**
 * F5 phase 3 — pure geometry for the single-focus view's tab bar scroll
 * "edge fade" (MobileFocusView.vue's `.focus-tabs-wrap`). The tab bar
 * (`.focus-tabs`) scrolls horizontally when there are more tabs than fit —
 * this decides which edge(s) currently have more content hidden off-screen,
 * so the component can toggle a subtle fade/shadow overlay there. Kept out
 * of the component so the arithmetic is unit-testable directly: happy-dom
 * computes no real layout (scrollWidth/clientWidth are always 0 on a plain
 * mounted element), so component tests would have nothing meaningful to
 * assert against — this function is tested against fabricated extents
 * instead, and the component just wires real DOM measurements into it.
 */

/** The three DOM measurements needed — deliberately a plain object (not
 *  `HTMLElement`) so tests can fabricate values without a real layout
 *  engine; the component passes `{ scrollLeft, scrollWidth, clientWidth }`
 *  read straight off `.focus-tabs`. */
export interface ScrollExtent {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

export interface ScrollEdgeFade {
  canScrollLeft: boolean
  canScrollRight: boolean
}

/**
 * `epsilon` (CSS px) absorbs sub-pixel rounding noise real browsers report
 * on `scrollLeft`/`scrollWidth` under fractional device-pixel-ratio scaling
 * — without it, a container scrolled fully to one edge can flicker the
 * opposite edge's fade in/out by fractions of a pixel as the user scrolls.
 */
export function computeScrollEdgeFade(extent: ScrollExtent, epsilon = 1): ScrollEdgeFade {
  const maxScrollLeft = extent.scrollWidth - extent.clientWidth
  // Nothing to scroll at all (content fits, or not laid out yet) — never
  // show either fade regardless of a stray non-zero scrollLeft.
  if (maxScrollLeft <= epsilon) return { canScrollLeft: false, canScrollRight: false }
  return {
    canScrollLeft: extent.scrollLeft > epsilon,
    canScrollRight: extent.scrollLeft < maxScrollLeft - epsilon,
  }
}
