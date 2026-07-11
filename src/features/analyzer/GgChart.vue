<script lang="ts">
/** One colored series of G-G points: a single lap's or the whole session's points. */
export interface GgSeries {
  points: [number, number][]
  color: string
  /** Legend/tooltip label. */
  name: string
  /** Colour-axis feature — a THIRD channel's value per point, aligned 1:1
   *  with `points` (same length/order — see `buildGgPointsWithColor`).
   *  Present only when a colour-axis channel is picked; when set on ANY
   *  series in the chart, every point across every series is coloured by
   *  this value via a continuous colormap instead of `color` (see
   *  `colorExtent`/`buildOption`'s `visualMap`) — the flat per-lap `color`
   *  is then only used as a fallback border/legend swatch. */
  colorValues?: number[]
  /** Third-channel values used only by the item tooltip. This is separate
   * from `colorValues` so multi-session charts can retain session identity
   * colours while still exposing the selected third channel on hover. */
  tooltipValues?: number[]
}

function escapeTooltipHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] ?? char,
  )
}

/** Pure formatter shared by ECharts' item tooltip and unit tests. The third
 * row is emitted only when the hovered point actually carries a finite third
 * value, so charts without a selected/available third channel stay unchanged. */
export function formatScatterTooltip(
  seriesName: string | undefined,
  value: readonly unknown[] | undefined,
  square: boolean,
  thirdChannel: string | null | undefined,
  thirdDecimals: number,
): string {
  const x = Number(value?.[0])
  const y = Number(value?.[1])
  const unit = square ? ' g' : ''
  let text = `${escapeTooltipHtml(seriesName ?? '')}<br/>X: ${Number.isFinite(x) ? x.toFixed(2) : '—'}${unit}`
  text += `<br/>Y: ${Number.isFinite(y) ? y.toFixed(2) : '—'}${unit}`
  const third = Number(value?.[2])
  if (thirdChannel && Number.isFinite(third)) {
    text += `<br/>${escapeTooltipHtml(thirdChannel)}: ${third.toFixed(thirdDecimals)}`
  }
  return text
}

/** Axis `name`/`nameLocation`/`nameGap` fields for an echarts axis (#10 — the
 * scatter's X/Y channel names weren't shown anywhere on the chart itself,
 * only in the pickers above it). Returns `{}` when there's no name to show,
 * so spreading it into an axis config is a no-op (keeps echarts' own
 * defaults, i.e. no name). Lives in a plain (non-`setup`) `<script>` block
 * because `<script setup>` can't export plain named bindings — this way the
 * naming rule stays unit-testable (imported directly by test code) without
 * a separate module file or mounting the chart. */
export function axisNameFields(name: string | null | undefined): {
  name?: string
  nameLocation?: 'middle'
  nameGap?: number
} {
  if (!name) return {}
  return { name, nameLocation: 'middle', nameGap: 28 }
}

/**
 * T3 — the explicit pixel size for `echarts.init` AND every later
 * `chart.resize({...})` call, measured from the host element.
 *
 * `resize()` must be passed this explicitly: this chart is init'd with an
 * explicit `{width, height}` (jsdom-less tests / first-frame safety), and
 * zrender REMEMBERS init-time sizes in its painter opts — an argument-less
 * `chart.resize()` re-reads those stored numbers instead of measuring the
 * container (see zrender `getSize`: `if (opts[wh] != null && opts[wh] !==
 * 'auto') return parseFloat(opts[wh])`), so the chart stayed frozen at its
 * mount-time size forever no matter how the window/card resized — the
 * reported "新增的 XY 圖不隨視窗大小變化" bug. Passing the measured size on
 * every resize overwrites the stored opts and keeps the chart following its
 * container.
 *
 * Falls back to 400×`fixedHeight` before the host has laid out (clientWidth/
 * Height 0) — same fallbacks the old init path used.
 */
export function measuredSize(
  clientWidth: number,
  clientHeight: number,
  fillHeight: boolean,
  fixedHeight: number,
): { width: number; height: number } {
  return {
    width: clientWidth || 400,
    height: fillHeight && clientHeight > 0 ? clientHeight : fixedHeight,
  }
}

/**
 * XY-aspect feature — the raw [min,max] data extent across every series'
 * points, per axis. `Infinity`/`-Infinity` fields when there are no points
 * (caller falls back to a default range via {@link paddedAxisRange}, which
 * treats non-finite input as "no data yet").
 */
export function dataExtent(series: GgSeries[]): { xMin: number; xMax: number; yMin: number; yMax: number } {
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (const s of series) {
    for (const [x, y] of s.points) {
      if (x < xMin) xMin = x
      if (x > xMax) xMax = x
      if (y < yMin) yMin = y
      if (y > yMax) yMax = y
    }
  }
  return { xMin, xMax, yMin, yMax }
}

/**
 * Colour-axis feature — the raw [min,max] extent of every series'
 * `colorValues`, across ALL series (so lap-split scatters share ONE colour
 * scale, letting laps be compared by colour). Returns `null` when no series
 * carries `colorValues` (feature off) — the caller's cue to skip the
 * `visualMap`/per-point colouring path entirely and fall back to each
 * series' flat `color`. A degenerate (min === max, e.g. a constant channel
 * or a single point) extent is widened by a small fraction (or ±1 around 0)
 * so `visualMap` always gets a genuine, non-zero span — same fallback shape
 * as `paddedAxisRange`.
 */
export function colorExtent(series: GgSeries[]): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  let any = false
  for (const s of series) {
    if (!s.colorValues) continue
    for (const v of s.colorValues) {
      if (!Number.isFinite(v)) continue
      any = true
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!any) return null
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1
    return { min: min - pad, max: max + pad }
  }
  return { min, max }
}

/** Raw extent for tooltip precision, including both continuous-colour values
 * and tooltip-only values used by identity-coloured multi-session series. */
export function thirdValueExtent(series: GgSeries[]): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const s of series) {
    const values = s.colorValues ?? s.tooltipValues
    if (!values) continue
    for (const value of values) {
      if (!Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  return Number.isFinite(min) ? { min, max } : null
}

/**
 * Pad a raw [min,max] extent by a fraction of its span for headroom, so
 * points don't sit flush against the plot edge — same spirit as
 * `computeMaxAbs`'s "round up to the nearest 0.5g" headroom for the G-G
 * square axes, generalised to any (possibly unsigned/asymmetric) channel
 * pair. A constant channel (min === max) pads by a fraction of its
 * magnitude instead (falling back to ±1 around zero); a non-finite extent
 * (no points yet) falls back to a fixed 0..1 range so callers always get a
 * usable range to size a grid from.
 */
export function paddedAxisRange(min: number, max: number, padFrac = 0.08): { min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 }
  if (min === max) {
    const pad = Math.abs(min) * padFrac || 1
    return { min: min - pad, max: max + pad }
  }
  const span = max - min
  const pad = span * padFrac
  return { min: min - pad, max: max + pad }
}

/**
 * #6 — force both axes to the SAME numeric span (the larger of the two,
 * centred on each axis's own original centre) so that, combined with a
 * literal square grid box (see {@link squareGridBox}), X and Y end up with
 * IDENTICAL pixels-per-data-unit. This is the piece the earlier "equal
 * pixels-per-unit via grid-inset letterboxing" attempt was missing: that
 * approach (kept the raw, possibly very different, per-axis ranges and only
 * padded the GRID INSETS to equalise scale) produced a grid box whose outer
 * pixel width/height were themselves unequal whenever the two channels'
 * data spans differed a lot (e.g. RPM 0..8000 vs speed 0..200) — the plot
 * area came out as a wide sliver, not a square, which is exactly the "Y軸被
 * 拍扁" (Y axis squashed flat) symptom reported against that version.
 * Widening the SMALLER axis's numeric range instead (rather than padding
 * grid pixels) means the grid box itself can always be sized as a literal
 * square (equal width AND height in pixels) — see `squareGridBox` — while
 * the actual data (still centred) occupies a smaller, but honestly-scaled,
 * region within that square. For the classic G-G friction-circle case (both
 * axes already forced to the same symmetric-about-0 bound by
 * `computeMaxAbs`) the spans are already equal, so this is a no-op there.
 */
export function squareAxisRanges(
  xRange: { min: number; max: number },
  yRange: { min: number; max: number },
): { xRange: { min: number; max: number }; yRange: { min: number; max: number } } {
  const xSpan = Math.max(xRange.max - xRange.min, 1e-9)
  const ySpan = Math.max(yRange.max - yRange.min, 1e-9)
  const span = Math.max(xSpan, ySpan)
  const xMid = (xRange.min + xRange.max) / 2
  const yMid = (yRange.min + yRange.max) / 2
  return {
    xRange: { min: xMid - span / 2, max: xMid + span / 2 },
    yRange: { min: yMid - span / 2, max: yMid + span / 2 },
  }
}

/**
 * #6 — a LITERAL square grid pixel box (equal width AND height, not just
 * equal units-per-pixel): side = the smaller of the container's two
 * available-plotting dimensions (container size minus `chrome`, the space
 * reserved for axis labels/names), centred in whichever dimension has spare
 * room — the same "background-size: contain, centred" idea the old
 * grid-inset letterbox used, just applied to the OUTER box shape instead of
 * to per-axis scale. Paired with {@link squareAxisRanges} (equal numeric
 * spans on both axes), this guarantees symmetric data (e.g. a circle) plots
 * as a visually square/round shape on ANY container shape, and holds after a
 * window/card resize (the caller recomputes this on every resize — see
 * GgChart's `resize()` — since it depends on the CURRENT container size).
 */
export function squareGridBox(
  containerW: number,
  containerH: number,
  chrome: { left: number; right: number; top: number; bottom: number },
): { left: number; top: number; width: number; height: number } {
  const availW = Math.max(containerW - chrome.left - chrome.right, 1)
  const availH = Math.max(containerH - chrome.top - chrome.bottom, 1)
  const side = Math.max(Math.min(availW, availH), 1)
  const extraW = Math.max(availW - side, 0)
  const extraH = Math.max(availH - side, 0)
  return {
    left: chrome.left + extraW / 2,
    top: chrome.top + extraH / 2,
    width: side,
    height: side,
  }
}

/**
 * #5 fix — decimal precision for an axis whose range was pinned explicitly
 * (the 1:1 `square`/`equal` modes — see `squareAxisRanges`): widening the
 * smaller-span axis to match the larger one usually produces a NON-"nice"
 * min/max (e.g. widening a 0..2 span to match an 8 span centres it at
 * -3..5... but the more common case is a fractional widen like -0.333..),
 * unlike echarts' own auto-ranging (which always picks nice round ticks) —
 * so its default label formatting could print long floats (e.g.
 * `-0.3333333`), and since the grid box is drawn at a fixed pixel chrome
 * (`containLabel: false`), an unexpectedly wide label pushes into — and
 * visually squeezes — the plotting area, breaking the square aspect (the
 * reported bug). Chosen from the axis's overall SPAN (not the individual
 * tick value) so every tick on the same axis renders at the same precision.
 */
export function axisLabelDecimals(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 2
  if (span >= 100) return 0
  if (span >= 10) return 1
  if (span >= 1) return 2
  if (span >= 0.1) return 3
  return 4
}

/** Formats one axis tick at `axisLabelDecimals(span)` precision, trimming
 *  trailing zeros (and normalising `-0` to `0`) for a compact label that
 *  doesn't squeeze the plotting area (see `axisLabelDecimals`). */
export function formatAxisTick(value: number, span: number): string {
  const decimals = axisLabelDecimals(span)
  const rounded = Number(value.toFixed(decimals))
  return String(rounded === 0 ? 0 : rounded)
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { colormapSwatches } from '@/domain/analysis/colormap'

echarts.use([ScatterChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

// Colour-axis feature — fixed to viridis: perceptually uniform (equal data
// steps read as equal visual steps, unlike e.g. jet/rainbow) and
// colour-blind-friendly (purple->teal->yellow avoids the red/green axis) —
// see colormap.ts's doc. Not user-selectable (unlike the track heatmap's
// picker): one fewer control for what's meant to be a lightweight "3D plot
// alternative", and viridis alone already satisfies the legibility bar in
// both themes.
const COLOR_AXIS_MAP = 'viridis' as const

const props = defineProps<{
  series: GgSeries[]
  height?: number
  /** Adaptive axis rule (A10+A12 — GgChart is now the shared renderer for
   *  ANY XY scatter, not just friction circles): 'square' draws symmetric
   *  axes about 0 sized to the max |value| (the friction-circle look) —
   *  meaningful only when both channels are signed force-like data.
   *  'auto' (default) lets each axis auto-range independently, matching a
   *  normal scatter of unrelated channels (e.g. RPM vs speed). The caller
   *  decides the mode from the actual data range (min<0<max on both axes),
   *  not the channel name — see ScatterChart.vue's `axisMode`. */
  axisMode?: 'square' | 'auto'
  /** Channel name shown on the X axis (#10 — axes were unlabeled, so a
   *  free-XY scatter gave no clue which channel was plotted where). Undefined
   *  omits the axis name entirely (falls back to echarts' default of none). */
  xName?: string | null
  /** Channel name shown beside the Y axis; see `xName`. */
  yName?: string | null
  /** #8 — when true, fills the container's height (dashboard grid item) via
   *  CSS instead of the fixed `height` prop — see UPlotChart's `fillHeight`
   *  for the same pattern; `resize()` reads the host's own clientHeight. */
  fillHeight?: boolean
  /** XY-aspect feature — true (default) scales X/Y at the SAME pixels-per-
   *  data-unit (a circle plots as a circle), false lets each axis auto-range
   *  independently to fill the card. Defaults to true when omitted so the
   *  G-G force chart (axisMode 'square') gets a TRUE circle, not just a
   *  symmetric-about-0 numeric range that only looked square by coincidence
   *  of the card happening to be roughly square — see `squareAxisRanges`/
   *  `squareGridBox`. */
  equalAspect?: boolean
  /** Colour-axis feature — the picked third channel's NAME, shown as the
   *  colorbar's top label and in the tooltip; `undefined`/`null` when no
   *  colour axis is picked. Purely a label — whether colouring is actually
   *  active is driven by `series[].colorValues` being present (see
   *  `colorExtent`), not this prop, so a stale name never turns coloring on
   *  by itself. */
  colorChannel?: string | null
}>()

const host = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null
let ro: ResizeObserver | null = null
let themeObs: MutationObserver | null = null

function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Square axis range symmetric about 0, sized to the max |g| across all series
 * (rounded up to the nearest 0.5g so the range has a little headroom). */
function computeMaxAbs(series: GgSeries[]): number {
  let max = 0
  for (const s of series) {
    for (const [x, y] of s.points) {
      const ax = Math.abs(x)
      const ay = Math.abs(y)
      if (ax > max) max = ax
      if (ay > max) max = ay
    }
  }
  if (max <= 0) return 1
  return Math.ceil(max * 2) / 2
}

function buildOption(): echarts.EChartsCoreOption {
  const axisStroke = themeColor('--color-text-muted', '#888')
  const gridStroke = themeColor('--color-border', '#ccc')
  const square = (props.axisMode ?? 'auto') === 'square'
  const equal = props.equalAspect ?? true
  // Colour-axis feature — `null` when no series carries `colorValues` (no
  // channel picked, or the picked channel had no finite samples in range),
  // the cue to fall back to each series' flat `color` entirely (see
  // `colorExtent`'s doc).
  const colorRange = colorExtent(props.series)
  const hasColor = colorRange !== null
  const colorSpan = colorRange ? colorRange.max - colorRange.min : NaN
  const thirdRange = thirdValueExtent(props.series)
  const thirdSpan = thirdRange ? thirdRange.max - thirdRange.min : NaN
  const thirdDecimals = axisLabelDecimals(thirdSpan)

  // Explicit per-axis ranges. Needed for BOTH 1:1 flavours: echarts' own
  // auto-ranging applies nice-tick rounding per axis independently, which
  // would silently change each axis's data span and break any pixel ratio
  // computed from it — so when `equal` is on, the ranges are pinned here and
  // the grid box below does the rest. `square` keeps its historic
  // symmetric-about-0 range even when `equal` is toggled off (that numeric
  // symmetry predates the 1:1 feature and is a property of the friction-
  // circle reading, not of pixel scaling).
  let xRange: { min: number; max: number } | null = null
  let yRange: { min: number; max: number } | null = null
  if (square) {
    const bound = computeMaxAbs(props.series)
    xRange = { min: -bound, max: bound }
    yRange = { min: -bound, max: bound }
  } else if (equal) {
    const ext = dataExtent(props.series)
    xRange = paddedAxisRange(ext.xMin, ext.xMax)
    yRange = paddedAxisRange(ext.yMin, ext.yMax)
  }
  // #6 — when 1:1 is on, widen whichever axis has the smaller span so BOTH
  // axes cover the SAME numeric span (see `squareAxisRanges`) — this is what
  // lets the grid box below be a literal square while still giving both axes
  // identical pixels-per-data-unit. No-op for `square` axisMode (its bound is
  // already symmetric/equal on both axes).
  if (equal && xRange && yRange) {
    const squared = squareAxisRanges(xRange, yRange)
    xRange = squared.xRange
    yRange = squared.yRange
  }
  // #5 fix — snapshot each pinned axis's span as a plain `const` number (not
  // a closure over the mutable `let xRange`/`yRange` above) so the axisLabel
  // `formatter` below captures a stable value; unused (NaN) when the axis
  // isn't pinned, since the formatter is only wired in for that case.
  const xSpan = xRange ? xRange.max - xRange.min : NaN
  const ySpan = yRange ? yRange.max - yRange.min : NaN

  const sharedAxis = {
    type: 'value' as const,
    axisLine: { lineStyle: { color: axisStroke } },
    axisLabel: { color: axisStroke },
    splitLine: { lineStyle: { color: gridStroke } },
    nameTextStyle: { color: axisStroke },
  }

  // Extra grid margin so the axis `name` (below the X axis, left of the Y
  // axis's tick labels) has room without being clipped by the chart edge.
  const hasXName = Boolean(props.xName)
  const hasYName = Boolean(props.yName)
  const chrome = {
    left: hasYName ? 64 : 48,
    // Colour-axis feature — reserve room on the right for the visualMap
    // colorbar (a floating component, not part of the grid box itself) so it
    // doesn't overlap the plotted points.
    right: hasColor ? 96 : 16,
    top: 16,
    bottom: hasXName ? 56 : 40,
  }
  // #6 — 1:1 mode: measure the CURRENT container and force a literal SQUARE
  // grid box (equal pixel width/height — see `squareGridBox`), combined with
  // the equal-span axis ranges above — recomputed on every render/resize (see
  // `resize()`), which is what keeps the square shape true after a window or
  // dashboard-card resize.
  const grid =
    equal && xRange && yRange ? squareGridBox(hostSize().width, hostSize().height, chrome) : chrome

  return {
    animation: false,
    grid: { ...grid, containLabel: false },
    tooltip: {
      trigger: 'item',
      // Themed to match the shared v-tooltip bubble (src/directives/tooltip.ts)
      // instead of echarts' default square, always-dark box — rounded corners
      // + surface/border/text colours that follow light/dark (buildOption()
      // re-reads these on every theme change via the MutationObserver below).
      backgroundColor: themeColor('--color-surface', '#fff'),
      borderColor: themeColor('--color-border', '#ccc'),
      borderWidth: 1,
      borderRadius: parseFloat(themeColor('--radius', '8')) || 8,
      textStyle: { color: themeColor('--color-text', '#1a1c20') },
      extraCssText: 'box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);',
      formatter: (p: { seriesName?: string; value?: unknown[] }) =>
        formatScatterTooltip(p.seriesName, p.value, square, props.colorChannel, thirdDecimals),
    },
    xAxis: {
      ...sharedAxis,
      ...(xRange
        ? {
            min: xRange.min,
            max: xRange.max,
            // #5 fix — pinned 1:1 ranges aren't "nice" numbers; cap decimals
            // from the axis's own span so long floats don't widen the label
            // column and squeeze the square plotting area.
            axisLabel: {
              ...sharedAxis.axisLabel,
              formatter: (v: number) => formatAxisTick(v, xSpan),
            },
          }
        : {}),
      ...axisNameFields(props.xName),
    },
    yAxis: {
      ...sharedAxis,
      ...(yRange
        ? {
            min: yRange.min,
            max: yRange.max,
            axisLabel: {
              ...sharedAxis.axisLabel,
              formatter: (v: number) => formatAxisTick(v, ySpan),
            },
          }
        : {}),
      ...axisNameFields(props.yName),
    },
    // Colour-axis feature — a continuous colorbar legend (min/max labelled)
    // driving each point's colour off `data[2]` (see the `series` mapping
    // below). `undefined` when `!hasColor`: `chart.setOption(option, true)`
    // (see `render()`) is a full replace (`notMerge: true`), so an omitted
    // key here correctly clears any visualMap left over from a previous
    // render where a colour axis WAS picked.
    visualMap: colorRange
      ? {
          type: 'continuous',
          dimension: 2,
          min: colorRange.min,
          max: colorRange.max,
          orient: 'vertical',
          right: 8,
          top: 'middle',
          itemWidth: 14,
          itemHeight: 120,
          hoverLink: true,
          calculable: false,
          inRange: { color: colormapSwatches(COLOR_AXIS_MAP, 12) },
          text: [
            [props.colorChannel, formatAxisTick(colorRange.max, colorSpan)].filter(Boolean).join(' '),
            formatAxisTick(colorRange.min, colorSpan),
          ],
          textStyle: { color: axisStroke },
          formatter: (v: number) => formatAxisTick(v, colorSpan),
        }
      : undefined,
    series: props.series.map((s) => ({
      name: s.name,
      type: 'scatter',
      // Colour-axis feature — when active, every point across every series
      // carries its colour value as a 3rd tuple element (visualMap's
      // `dimension: 2` reads it); when inactive, points stay plain [x, y]
      // (unchanged from before this feature).
      data:
        hasColor && s.colorValues
          ? s.points.map((p, i) => [p[0], p[1], s.colorValues![i]])
          : s.tooltipValues
            ? s.points.map((p, i) => [p[0], p[1], s.tooltipValues![i]])
            : s.points,
      symbolSize: 4,
      // visualMap owns `itemStyle.color` once active — setting it here too
      // would just be overridden, so only `opacity` (a touch higher than the
      // flat-color 0.5 default: the colormap already carries most of the
      // per-point distinction, so a lighter opacity would wash it out) is set.
      itemStyle: hasColor ? { opacity: 0.8 } : { color: s.color, opacity: 0.5 },
    })),
  }
}

function render(): void {
  if (!chart) return
  chart.setOption(buildOption(), true)
}

/** Current measured size for init/resize — see {@link measuredSize} (T3). */
function hostSize(): { width: number; height: number } {
  const el = host.value
  return measuredSize(
    el?.clientWidth ?? 0,
    el?.clientHeight ?? 0,
    props.fillHeight ?? false,
    props.height ?? 360,
  )
}

function create(): void {
  if (!host.value) return
  destroy()
  chart = echarts.init(host.value, undefined, hostSize())
  render()
}

function destroy(): void {
  chart?.dispose()
  chart = null
}

function resize(): void {
  // T3 — MUST pass the measured size: an argument-less resize() would reuse
  // the init-time explicit width/height stored by zrender and never follow
  // the container. See measuredSize's doc.
  if (!chart) return
  chart.resize(hostSize())
  // 1:1 mode sizes the square grid box from the CONTAINER size (see
  // squareGridBox), so a resize invalidates the current box — rebuild the
  // option at the new size to keep the square shape true.
  if (props.equalAspect ?? true) render()
}

onMounted(() => {
  create()
  ro = new ResizeObserver(() => resize())
  if (host.value) ro.observe(host.value)
  window.addEventListener('resize', resize)
  // Re-render with new colours when the theme (data-theme) changes — same
  // pattern as UPlotChart.
  themeObs = new MutationObserver(() => render())
  themeObs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onBeforeUnmount(() => {
  ro?.disconnect()
  themeObs?.disconnect()
  window.removeEventListener('resize', resize)
  destroy()
})

watch(
  () => [props.series, props.axisMode, props.xName, props.yName, props.equalAspect, props.colorChannel],
  () => render(),
  { deep: false },
)
</script>

<template>
  <div
    ref="host"
    class="gg-chart-host"
    :class="{ fill: fillHeight }"
    :style="fillHeight ? undefined : { height: `${props.height ?? 360}px` }"
  />
</template>

<style scoped>
.gg-chart-host {
  width: 100%;
  /* #16: as a flex item (ScatterChart.vue's column flex root) this would
   * otherwise floor its shrink at the echarts canvas's pixel width (a flex
   * item's cross-axis min-width defaults to `auto`, i.e. its content's
   * min-content size, not 0) — causing overflow instead of shrinking when
   * the window/panel narrows. See ScatterChart.vue's `.scatter-chart` for
   * the matching fix one level up. */
  min-width: 0;
}
/* #8 — fillHeight mode: stretch to the parent's available height (a
   dashboard grid item's card body) — see UPlotChart's `.fill` for the same
   pattern. */
.gg-chart-host.fill {
  height: 100%;
}
</style>
