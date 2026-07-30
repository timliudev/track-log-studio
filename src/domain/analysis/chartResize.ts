/**
 * ResizeObserver feedback-loop guard — shared by every ECharts-based chart
 * component that resizes itself off a `ResizeObserver` (GgChart.vue's 2D
 * G-G/scatter chart — B107 — and Scatter3dChart.vue's WebGL XYZ scatter).
 *
 * `chart.resize({width, height})` must be passed an EXPLICIT measured size
 * (an argument-less `resize()` would just reuse the init-time size zrender
 * stores internally — see GgChart's `measuredSize`/T3 doc), which means every
 * ResizeObserver callback re-measures the host and re-applies it. On a
 * fractional-DPI viewport (or whenever `chart.resize()` triggers a render
 * that very slightly nudges the host's own layout — e.g. GgChart's
 * `equalAspect` mode rebuilding its square grid box from the container's
 * CURRENT size right after resizing), the fresh measurement can differ from
 * the previous one by a sub-pixel amount. Reacting to that "echo" re-fires
 * the observer → resize → (maybe) render → relayout → observer … forever,
 * without ever settling — visually a zoom-pulse/flicker (reported at
 * 1386×949 for the 2D chart's 1:1 mode).
 *
 * Comparing a fresh measurement against the size last actually APPLIED to
 * the chart (not the last MEASURED size) with a >=1px-on-either-axis
 * threshold filters that echo out — it's sub-pixel by construction — while
 * still reacting to every genuine resize: a real window/card resize always
 * moves by a whole pixel or more, well above this threshold.
 */
export function sizeChangedEnoughToApply(
  lastApplied: { width: number; height: number } | null,
  measured: { width: number; height: number },
  thresholdPx = 1,
): boolean {
  if (!lastApplied) return true
  return (
    Math.abs(measured.width - lastApplied.width) >= thresholdPx ||
    Math.abs(measured.height - lastApplied.height) >= thresholdPx
  )
}
