/**
 * B36 — 手機單欄模式卡片滿版: once a chart/map's interactive layer bleeds all
 * the way to the true viewport edge (see UPlotChart.vue's `.uplot-wrap.fill`
 * and TrackMap.vue's `.track-wrap.fill` mobile styling, both driven by
 * DashboardCard.vue's `--card-bleed-x` custom property), a touch drag that
 * STARTS right at that edge collides with the OS/browser's own edge-swipe
 * "go back" gesture (Android's system back gesture, and iOS Safari/PWA
 * edge-swipe navigation) — both recognise a touch starting within a few
 * pixels of the screen edge as "the user wants to navigate back", same
 * screen real-estate our now-edge-to-edge pan/zoom/scrub gesture claims.
 *
 * This is a pure, side-effect-free predicate (same style as
 * xRangeGesture.ts's pan/zoom math) so it's unit-testable without a real
 * touchscreen or a live edge-swipe recognizer (neither of which any
 * automated test environment can exercise) — the actual mitigation is a
 * behavioural one: callers (UPlotChart.vue/TrackMap.vue's touch pointerdown
 * handlers) check this BEFORE calling `preventDefault()`/`setPointerCapture()`
 * and, if true, leave the event alone entirely so the platform's own
 * gesture recognizer still gets first look at it — visually the content
 * still bleeds to the true edge, but the first ~`insetPx` of it is a
 * touch-only dead zone for OUR gesture handling, not a visual inset.
 *
 * Only meaningful for `pointerType === 'touch'` (mouse/pen have no
 * OS-level edge-swipe-back gesture to protect — see §8 layer 2's existing
 * "judge per-event, not per-device" precedent, e.g.
 * UPlotChart.vue's `isTouchGesturePointer`) and only worth checking at all
 * when a coarse pointer is present (`useInputCapabilities`'s
 * `anyPointerCoarse` — callers gate on that too, so a desktop/tablet with a
 * mouse never pays this check).
 */
export function isEdgeGestureZone(clientX: number, viewportWidth: number, insetPx = 8): boolean {
  if (!(viewportWidth > 0) || !(insetPx > 0)) return false
  return clientX <= insetPx || clientX >= viewportWidth - insetPx
}
