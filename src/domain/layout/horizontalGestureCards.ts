import { STATIC_CARD_IDS, isChartItemId } from './dashboardLayout'

/**
 * F5 phase 2 — left/right swipe-to-switch in the mobile single-focus view
 * (MobileFocusView.vue, see docs/specs/F5-SINGLE-FOCUS-DESIGN.md §7/§8) can
 * only be a whole-body gesture on card ids that don't ALREADY consume a
 * horizontal drag themselves — see that design doc's explicit warning: a
 * naive "swipe anywhere switches tabs" would steal the map's pan and the
 * charts' own zoom/pan. This predicate is the single place that decides
 * which ids fall in that "already spoken for" set, so MobileFocusView.vue and
 * its tests share ONE definition instead of a component-local `v-if` guess.
 *
 * Exactly three shapes of card body touch horizontal drag today, and only
 * two of them are reachable through AnalyzerCardBody's dispatcher (verified
 * by reading every `cards/*.vue` body — nothing else imports TrackMap,
 * UPlotChart, or the echarts wrappers, or attaches its own pointerdown/
 * touchstart handler):
 *  - the track map (`STATIC_CARD_IDS.map`, rendered by MapCard.vue via
 *    TrackMap.vue) — pan/drag over the whole canvas (`touch-action: none`
 *    there, see TrackMap.vue's own style block).
 *  - every dynamic chart card (`chart-<id>` ids, see dashboardLayout.ts's
 *    `chartItemId`/`isChartItemId`, rendered by ChartCard.vue): both chart
 *    kinds already own a horizontal drag —
 *    - `kind: 'timeseries'` (TimeSeriesChart.vue -> UPlotChart.vue): B9
 *      drag-zoom, B31 fixed-centre-needle drag-pan, B94 x-axis-band pan.
 *    - `kind: 'scatter'` (ScatterChart.vue, also how the G-G/friction-circle
 *      view is built — see the "G-G is a scatter special case" note in
 *      project memory): B46 inside-dataZoom drag.
 *
 * Every other static card (lap table, sectors, the track-channel PICKER —
 * TrackChannelCard.vue is a plain `<select>`-style panel, not a chart —
 * accel test, gear, CVT dynamics, track file, session merge, suspension,
 * current values, map/lap align) is a panel/table/form with no internal
 * horizontal-drag gesture of its own, so a whole-body swipe is safe to claim
 * there. If a future card body grows its own horizontal drag, add its id
 * here rather than teaching MobileFocusView.vue a new special case.
 */
export function consumesHorizontalDrag(id: string): boolean {
  if (id === STATIC_CARD_IDS.map) return true
  return isChartItemId(id)
}
