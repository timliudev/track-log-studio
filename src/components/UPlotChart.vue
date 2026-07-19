<script lang="ts">
import { nearestXIndex } from '@/domain/analysis/timelineData'

/**
 * T1 — plot-area height for `fillHeight` mode: the HOST's measured height
 * minus uPlot's own HTML legend (which lives INSIDE the host, below the
 * canvas). uPlot's `options.height` sizes only the plot area + axes — the
 * legend adds its own height on top, so handing it the full host height made
 * canvas + legend overflow the host and the legend text got clipped by the
 * card body at every card/window size. `fallback` (the `height` prop) is
 * used when the host hasn't laid out yet (0/negative remaining space).
 *
 * Plain-script export (same pattern as GgChart's `axisNameFields`) so the
 * sizing rule is unit-testable without mounting uPlot.
 */
export function fillPlotHeight(
  hostHeight: number,
  legendHeight: number,
  fallback: number,
): number {
  const h = hostHeight - legendHeight
  return h > 0 ? h : fallback
}

/**
 * B9 — whether `range` is a real ZOOM relative to `bounds` (the full data
 * extent): true when `range` doesn't cover (nearly) all of `bounds`, within
 * `epsFraction` of `bounds`' span (guards against float-precision false
 * positives right after a reset-to-bounds `setScale`). A null `bounds` (no
 * data yet) is never "zoomed". Drives the reset-zoom button's visibility.
 *
 * Plain-script export (same pattern as `fillPlotHeight` above) so the rule is
 * unit-testable without mounting uPlot.
 */
export function isZoomed(
  range: { min: number; max: number },
  bounds: { min: number; max: number } | null,
  epsFraction = 1e-6,
): boolean {
  if (!bounds) return false
  const span = bounds.max - bounds.min
  const eps = span > 0 ? span * epsFraction : 0
  return range.min > bounds.min + eps || range.max < bounds.max - eps
}

/**
 * B35 — §8 layer 2 ("逐事件判斷，不是逐裝置"): whether a `PointerEvent` of the
 * given `pointerType` should be handled by this chart's OWN touch pan/pinch
 * gesture code, versus left alone for uPlot's native mouse-based drag-zoom
 * (and this file's own Shift+drag pan, see `onHostMouseDown`).
 *
 * `touch` → true (finger drag pans, two-finger pinch zooms — uPlot has no
 * native handling for it at all). `mouse` and `pen` → false: a pen input is
 * DELIBERATELY treated identically to a mouse here, not lumped in with touch
 * — a stylus drag box-zooms like a mouse drag (its hover support already
 * gives it the rest of the mouse-like experience for free), rather than
 * panning like a finger. Any other/future pointerType also falls back to
 * `false` (native path) rather than being silently swallowed as a touch
 * gesture.
 *
 * Plain-script export (same pattern as `fillPlotHeight`/`isZoomed` above) so
 * the branch is unit-testable without mounting uPlot or dispatching real
 * PointerEvents.
 */
export function isTouchGesturePointer(pointerType: string): boolean {
  return pointerType === 'touch'
}

/**
 * B31b — pixel→value mapping for a LINEAR x scale (this app never uses a log
 * scale, see buildOptions' `scales: { x: { time: false } }`): given a pixel
 * offset `xPixel` from the plot area's LEFT edge and `plotWidth` (both in CSS
 * px — e.g. straight from `getBoundingClientRect()`, NOT `u.bbox`, which is
 * device-pixel-scaled by `devicePixelRatio` and would misread by that same
 * factor on a HiDPI screen), returns the data value at that pixel for the
 * given scale `range`. Centre-needle mode always evaluates this at
 * `xPixel = plotWidth / 2` (see `centreCursorIndex` below) — factored out so
 * the pixel→value math is independently unit-testable.
 */
export function valueAtPlotX(
  xPixel: number,
  plotWidth: number,
  range: { min: number; max: number },
): number {
  if (!(plotWidth > 0)) return range.min
  return range.min + (xPixel / plotWidth) * (range.max - range.min)
}

/**
 * B31b — the fixed needle's CSS-px offset from `wrap`'s left edge: the exact
 * horizontal CENTRE of uPlot's OWN plot area (`plotLeft` .. `plotLeft +
 * plotWidth`), NOT `wrap`/`host`'s own centre — uPlot reserves a left-side
 * axis-label gutter, so the plot area is narrower than, and offset from, the
 * full chart width. Both inputs must already be CSS px (`getBoundingClientRect()`,
 * not `u.bbox`) for the same HiDPI reason as `valueAtPlotX` above — this
 * value feeds directly into a plain CSS `left` style on a DOM overlay, which
 * is always in CSS px regardless of `devicePixelRatio`.
 */
export function needleOffsetX(plotLeft: number, plotWidth: number): number {
  return plotLeft + plotWidth / 2
}

/**
 * B31 — RaceChrono-style fixed centre-needle mode: the sample index whose X
 * value is closest to the exact horizontal MIDPOINT of `range` (the chart's
 * current visible window) — i.e. "what the fixed needle is currently
 * pointing at". The needle always sits at the plot area's horizontal centre
 * (`needleOffsetX`'s `plotWidth / 2`), and for a linear scale (see
 * `valueAtPlotX` above) that pixel's value is exactly `range`'s midpoint — no
 * live uPlot instance / `posToVal` call needed, which keeps this pure and
 * unit-testable like `isZoomed`/`isTouchGesturePointer` above. Recomputed (via
 * the `setScale` hook) on every visible-range change while centre-needle mode
 * is active — a user drag/scrub, a synced `xRange` update from another chart,
 * or a zoom — and the result is emitted onward as this chart's `cursor` so
 * the rest of the app (current-values card, map, other synced charts) tracks
 * the scrub.
 */
export function centreCursorIndex(
  xs: ArrayLike<number>,
  range: { min: number; max: number },
): number | null {
  if (xs.length === 0) return null
  // Evaluated at the midpoint of a unit-width plot (xPixel=0.5, plotWidth=1)
  // — valueAtPlotX only ever uses the xPixel/plotWidth RATIO, so any concrete
  // plot width gives the same result; 1 keeps this call self-evident.
  return nearestXIndex(xs, valueAtPlotX(0.5, 1, range))
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import {
  blankTickLabelsOutsideData,
  panCentreNeedleRange,
  panRange,
  pinchCentreNeedleRange,
  pinchRange,
  zoomCentreNeedleRange,
  type XRange,
} from '@/features/analyzer/xRangeGesture'
import { useInputCapabilities } from '@/composables/useInputCapabilities'
import { isEdgeGestureZone } from '@/domain/layout/edgeGesture'
import {
  centreNeedleGeometry,
  clampPlotPoint,
  isPointInAxisBand,
  pendingTouchIntent,
  type CentreNeedleGeometry,
  type Rect2D,
} from '@/domain/analysis/chartPointerGesture'

const { t } = useI18n()
// B36 — edge-gesture guard for the mobile full-bleed chart (see this file's
// own `.uplot-wrap.fill` styling + onPointerDown below).
const { anyPointerCoarse } = useInputCapabilities()

const props = defineProps<{
  data: uPlot.AlignedData
  series: uPlot.Series[]
  /** Optional axes (with scale/side); colours are themed here. Defaults to x+y. */
  axes?: uPlot.Axis[]
  /** Shared X zoom range (null = auto). Applied to this chart; user zoom emits xZoom. */
  xRange?: { min: number; max: number } | null
  height?: number
  /**
   * #8 — when true, the chart fills its CONTAINER's height (e.g. a resizable
   * dashboard grid item) instead of the fixed `height` prop: the host stretches
   * to 100% via CSS and `resize()`/`create()` read the host's own
   * `clientHeight` (already re-measured by the existing ResizeObserver on
   * every container resize — drag-resize included, not just window resize).
   * `height` is still used as the initial/fallback size before the container
   * has laid out. Default false keeps every existing (non-grid) caller's
   * fixed-height behaviour unchanged.
   */
  fillHeight?: boolean
  externalCursor?: number | null
  /** Full X extent when `data` is a visible-range/downsampled subset. */
  xBounds?: { min: number; max: number } | null
  /**
   * B31 — RaceChrono-style fixed centre-needle mode (global Settings toggle,
   * `settingsStore.centreCursorMode`, forwarded down by callers that care
   * about cross-chart cursor sync — currently only `TimeSeriesChart.vue`;
   * `GearPanel.vue`/`SessionMergePanel.vue`'s standalone charts simply never
   * pass this prop, so they're entirely unaffected). When true:
   *  - An always-visible fixed vertical needle is drawn at the plot's own
   *    horizontal centre (a plain CSS overlay — NOT uPlot's native cursor
   *    crosshair, which is disabled in this mode via `cursor.x/y: false`).
   *  - A drag from ANY pointer type (touch/mouse/pen — deliberately ONE
   *    gesture for every input, per DESIGN.md §8 layer 1, rather than
   *    overloading the existing touch-pan-vs-mouse-box-zoom split) pans the
   *    visible X range under the fixed needle, reusing the exact same
   *    `dataXBounds`/`currentXRange`/`panRange`/`emitXRange` pipeline the
   *    touch-pan gesture already uses — so this mode is a clearly separated
   *    ADDITIONAL branch in the existing pointer handlers, not a rewrite.
   *  - Whatever sample lands under the needle after any visible-range change
   *    (drag, or a synced `xRange` update from elsewhere) is emitted as this
   *    chart's `cursor` (see `centreCursorIndex` above) — this is what feeds
   *    the current-values card / map / other synced charts. The native
   *    hover-driven cursor emit and the `externalCursor` prop's "snap to
   *    another chart's hover" behaviour are both suppressed in this mode
   *    (see the `setCursor` hook and the `externalCursor` watcher below) —
   *    there is no meaningful "hover position" once the cursor is pinned to
   *    the centre. Cross-chart sync in this mode instead comes for free from
   *    the EXISTING shared `xRange` (analyzerStore.xRange / a lap overlay's
   *    local scale): dragging one centre-mode chart pans that shared range,
   *    which every other chart bound to the same range already re-renders
   *    against — so their needles end up pointing at the same instant too.
   *    Touch keeps two-finger pinch zoom available, while mouse/trackpad can
   *    wheel-zoom about the needle; a full-range chart can therefore be
   *    narrowed before it is panned under the fixed line.
   *  - Default false/undefined: every existing chart's pan/zoom/cursor-sync
   *    behaviour is completely unchanged.
   */
  centreCursorMode?: boolean
}>()

const emit = defineEmits<{
  cursor: [number | null]
  /** B9 — `null` means "reset to the full data extent" (the reset-zoom
   *  control below, or a caller-driven clear of a synced shared range). */
  xZoom: [{ min: number; max: number } | null]
  plotWidth: [number]
}>()

const host = ref<HTMLDivElement | null>(null)
/** B31 — outer wrapper (already `position: relative`, same element the
 *  reset-zoom button is positioned against) — the centre-needle overlay is
 *  positioned relative to THIS, not `host`, since `host` is uPlot's own mount
 *  target (its internal `.u-wrap`/`.u-over`/legend are appended directly
 *  inside `host` outside Vue's template tracking — adding our own child
 *  there too would be fragile). */
const wrap = ref<HTMLDivElement | null>(null)
/** B31 — the needle's `left` offset in px relative to `wrap`, i.e. the
 *  horizontal centre of uPlot's OWN plot area (`plot.over`) — which is
 *  narrower than `host`'s full width once axis label gutters are accounted
 *  for. `null` (hidden) whenever centre-needle mode is off or the plot/host
 *  aren't measurable yet. */
const needleGeometry = ref<CentreNeedleGeometry | null>(null)
// B94 — whether the pointer is currently over the draggable X-axis band (see
// the axis-band pan gesture below), and whether a drag off it is in progress.
// Both drive the `grab`/`grabbing` cursor affordance only; the band itself
// behaves exactly like before whenever neither is true.
const axisBandHover = ref(false)
const axisBandDragging = ref(false)
let plot: uPlot | null = null
let ro: ResizeObserver | null = null
let themeObs: MutationObserver | null = null
let needleFrame: number | null = null
let needleSettleFrame: number | null = null
let resizeFrame: number | null = null
let resizeEpoch = 0
// Guard so programmatic setScale (from a synced xRange, or uPlot's own
// auto-ranging on (re)create) doesn't echo back out as a user xZoom.
//
// uPlot's setScale() doesn't fire its hooks synchronously — it stashes the
// requested range and fires via a queued MICROTASK (see uPlot's commit()),
// coalescing every setScale() call made in the same synchronous tick into
// ONE later hook fire carrying only the FINAL range. So a guard that flips
// back to false synchronously (right after the setScale() call returns) is
// already false by the time the hook actually fires — it never guards
// anything. The fix: clear the guard in a queued microtask of our own,
// scheduled AFTER uPlot's — since microtasks run FIFO, uPlot's own commit()
// (queued earlier in the same synchronous block, by new uPlot()'s internal
// autoScaleX() and/or our own setScale() call) always runs first, so by the
// time our reset runs the hook has already fired (or not fired at all, if
// nothing changed) — either way it's now safe to un-guard.
let applyingRange = false
function clearApplyingRangeSoon(): void {
  queueMicrotask(() => {
    applyingRange = false
  })
}
let applyingCursor = false

/**
 * Synchronize the sample under the fixed needle to both the shared cursor and
 * uPlot's native legend cursor. The native crosshair remains hidden by the
 * centre-mode cursor options; setCursor here only refreshes the legend values.
 * The identity check prevents a deferred sync from a destroyed chart instance
 * reaching either cursor after a recreate.
 */
function syncCentreCursor(instance: uPlot): void {
  if (!props.centreCursorMode || plot !== instance) return
  const { min, max } = instance.scales.x
  if (min == null || max == null) return
  const xs = instance.data[0] as number[]
  const index = centreCursorIndex(xs, { min, max })
  if (index != null) {
    const left = instance.valToPos(xs[index], 'x')
    if (Number.isFinite(left)) {
      applyingCursor = true
      instance.setCursor({ left, top: 0 })
      applyingCursor = false
    }
  }
  emit('cursor', index)
  scheduleNeedlePos()
}

/**
 * uPlot coalesces scale commits in a microtask. Schedule after that commit so
 * an unchanged initial range and a same-range data replacement still publish
 * the value under the fixed needle.
 */
function queueCentreCursor(instance: uPlot): void {
  if (!props.centreCursorMode) return
  queueMicrotask(() => syncCentreCursor(instance))
}

// B9 — whether the chart's CURRENT x scale is narrower than the full data
// extent, i.e. "there's something to reset". Drives the reset-zoom button's
// visibility. Updated from the `setScale` hook UNCONDITIONALLY (unlike the
// `xZoom` emit below, which is guarded by `applyingRange`) so a
// programmatic zoom — e.g. focusing a lap or an acceleration segment, which
// drives this chart via the `xRange` prop rather than a user drag — still
// makes the reset button appear/disappear correctly.
const zoomed = ref(false)

function updateZoomed(min: number, max: number): void {
  zoomed.value = isZoomed({ min, max }, dataXBounds())
}

function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** Measured height of uPlot's HTML legend inside the host (0 before the plot
 *  exists — e.g. during the very first create()). */
function legendHeight(): number {
  const legend = host.value?.querySelector<HTMLElement>('.u-legend')
  return legend?.offsetHeight ?? 0
}

/** The chart's current target height: in `fillHeight` mode, the host's own
 *  measured height MINUS the legend's (see {@link fillPlotHeight} — T1: the
 *  legend lives inside the host, so sizing the plot to the full host height
 *  pushed the legend out and clipped its text), falling back to the `height`
 *  prop before the container has laid out; else the fixed `height` prop. */
function targetHeight(): number {
  if (props.fillHeight && host.value) {
    return fillPlotHeight(host.value.clientHeight, legendHeight(), props.height ?? 260)
  }
  return props.height ?? 260
}

function buildOptions(width: number): uPlot.Options {
  // Read theme colours so axis/grid text follows light/dark (incl. auto).
  const axisStroke = themeColor('--color-text-muted', '#888')
  const gridStroke = themeColor('--color-border', '#cccccc')
  // Apply theme to each axis; keep a per-axis stroke if the caller set one
  // (used to colour each value axis to match its series).
  const themed = (a: uPlot.Axis): uPlot.Axis => {
    const axis: uPlot.Axis = {
      grid: { stroke: gridStroke, width: 1 },
      ticks: { stroke: gridStroke, width: 1 },
      ...a,
      stroke: a.stroke ?? axisStroke,
    }
    // B68 — only centre-needle mode may pan into virtual x padding. Preserve
    // the caller's normal elapsed/distance/clock formatter, but suppress text
    // where the split lies outside actual data. Grid marks remain useful for
    // spatial context without inventing timestamps or distances that do not
    // have a sample behind them.
    if (props.centreCursorMode && (axis.scale ?? 'x') === 'x' && typeof axis.values === 'function') {
      const values = axis.values
      axis.values = (u, splits, axisIdx, foundSpace, foundIncr) =>
        blankTickLabelsOutsideData(splits, values(u, splits, axisIdx, foundSpace, foundIncr), dataXBounds() ?? {
          min: -Infinity,
          max: Infinity,
        })
    }
    return axis
  }
  const axes = (props.axes ?? [{}, {}]).map(themed)
  return {
    width,
    height: targetHeight(),
    series: props.series,
    axes,
    legend: { show: true },
    scales: { x: { time: false } },
    // B31 — centre-needle mode draws its OWN always-visible fixed needle (a
    // plain CSS overlay, see the template/`updateNeedlePos` below) instead of
    // uPlot's native hover crosshair, so the native one is turned off here to
    // avoid two conflicting cursor indicators.
    //
    // B31b fix — `cursor.x/y: false` ONLY suppresses drawing the crosshair;
    // it does NOT touch `cursor.drag`, which defaults to `{ x: true, setScale:
    // true }` INDEPENDENTLY of `cursor.x/y` (see uPlot's `cursorOpts.drag` —
    // confirmed by reading its `mouseUp` handler, which calls its own
    // `_setScale(xScaleKey, posToVal(...), posToVal(...))` off the drag-select
    // box whenever `drag.setScale && hasSelect && chgSelect`, with NO
    // dependency on `cursor.x`/`cursor.y` at all). So a plain mouse drag in
    // this mode was ALWAYS *also* still starting uPlot's own native
    // drag-to-box-zoom on `.u-over` (real `mousedown`/`mousemove`/`mouseup` —
    // NOT synthesized "compatibility" events for a real mouse, so this
    // component's own `pointerdown` handler calling `preventDefault()` does
    // NOT suppress them, unlike for touch/pen) — fighting our own
    // `onCentrePointerMove` pan on every single drag: our pan would move the
    // range, then uPlot's OWN mouseup handler would immediately stomp it back
    // to whatever box the mouse happened to sweep out in screen pixels. THIS
    // was the "一點用都沒有、還是歪的" bug (B31b) — not the needle's own
    // position (which was already correct — see `needleOffsetX` — nor the
    // sample-under-needle read, which is mathematically identical to
    // `posToVal` for this app's always-linear x scale — see `valueAtPlotX`).
    // Disabling `drag` entirely here lets our own onCentrePointerDown/Move/Up
    // handlers be the ONLY thing driving the x range while this mode is on.
    cursor: props.centreCursorMode
      ? { focus: { prox: 16 }, x: false, y: false, drag: { setScale: false, x: false, y: false } }
      : { focus: { prox: 16 } },
    hooks: {
      setCursor: [
        (u: uPlot) => {
          // B31 — in centre-needle mode the emitted cursor comes from the
          // FIXED centre (see the `setScale` hook below + `syncCentreCursor`),
          // never from wherever the pointer happens to be hovering — so the
          // native hover-driven emit is suppressed here entirely.
          if (props.centreCursorMode) return
          if (!applyingCursor) emit('cursor', u.cursor.idx ?? null)
        },
      ],
      setScale: [
        (u: uPlot, key: string) => {
          if (key !== 'x') return
          const { min, max } = u.scales.x
          if (min == null || max == null) return
          updateZoomed(min, max)
          if (!applyingRange) emit('xZoom', { min, max })
          // B31 — whatever sample now sits at this chart's fixed centre
          // needle. Reads `u`/`min`/`max` from THIS hook invocation (not the
          // module-level `plot`/its current `.scales.x`) — the hook fires via
          // a queued microtask (see the big comment on `applyingRange`
          // above), so if `create()` happened to run again before it fires
          // (recreating `plot`), reading the closure variable instead of the
          // hook's own params could emit a cursor from the WRONG (new)
          // instance's data. `u.data[0]` is assumed finite/ascending X — same
          // assumption the `externalCursor` watcher below already makes.
          if (props.centreCursorMode) {
            syncCentreCursor(u)
          }
        },
      ],
    },
  }
}

// `standalone` is true when applyXRange is the sole guarded call in this tick
// (the fast-data-update path, or the xRange-prop watcher) — it must own the
// guard's set AND deferred clear itself. When called from inside create()
// (below), create() already holds the guard open across its OWN setScale
// (uPlot's auto-range on construction) and schedules the one shared clear
// afterward, so applyXRange must NOT set/clear it a second time — that would
// only be redundant here, but would be actively wrong if a future caller ever
// needed the guard to stay open past applyXRange's return.
//
// B9 — when `props.xRange` is null (no synced range — including a RESET back
// to null), fall back to the full data extent (`dataXBounds`) instead of a
// no-op: otherwise a chart that was previously zoomed via the shared range
// stayed stuck at its last (now-stale) scale once that range was cleared —
// exactly the "no way to get back to the full view" half of B9. A chart with
// nothing to fall back to (no data yet) still no-ops, same as before.
function applyXRange(standalone = true): void {
  if (!plot) return
  const range = props.xRange ?? dataXBounds()
  if (!range) return
  applyingRange = true
  plot.setScale('x', { min: range.min, max: range.max })
  if (standalone) clearApplyingRangeSoon()
}

function create(): void {
  if (!host.value) return
  destroy()
  const width = host.value.clientWidth || 600
  emit('plotWidth', width)
  // uPlot auto-ranges the x scale while laying out the freshly-constructed
  // chart (via its own internal setScale) — that's not a user zoom action, so
  // guard it the same way applyXRange guards its own programmatic setScale,
  // or it would leak out as a spurious xZoom (e.g. on every chart-mode
  // toggle, since that changes the series shape and forces a recreate) and
  // cascade into clearing the lap selection upstream. The guard stays open
  // across BOTH setScale calls (construction's auto-range + applyXRange's
  // sync below) so they coalesce into a single, fully-suppressed hook fire —
  // see clearApplyingRangeSoon's comment for why a synchronous reset can't
  // guard an async hook fire.
  applyingRange = true
  const instance = new uPlot(buildOptions(width), props.data, host.value)
  plot = instance
  observeChartGeometry()
  applyXRange(false) // adopt the shared zoom on (re)create, e.g. a newly added chart
  clearApplyingRangeSoon()
  queueCentreCursor(instance)
  // T1 — the legend only exists AFTER construction, so the height baked into
  // buildOptions() couldn't subtract it yet; re-measure once now that it's in
  // the DOM so canvas + legend fit the host exactly (fillHeight mode only —
  // fixed-height callers size the canvas to the `height` prop and let the
  // page flow around the legend, unchanged).
  if (props.fillHeight) {
    scheduleResize()
    // #4 fix — a channel add/remove changes the series shape, which forces
    // THIS create() to run again (see the `[data, series]` watcher below).
    // That recreate happens inside the same reactive flush that may still be
    // settling the surrounding layout — e.g. the toolbar's chip list gaining
    // or losing a wrapped line shifts how much height is actually left for
    // this chart within its card. The synchronous resize() above reads
    // whatever the host reports AT THAT INSTANT, which can be a transitional
    // value; nothing else re-measures afterwards (unlike the ResizeObserver
    // below, which keeps firing on every later layout change — e.g. a manual
    // card drag, which is why that "fixes" it) — so the chart could get
    // stuck at a stale height. Scheduling one more resize() via `nextTick`
    // re-measures again once Vue has fully flushed EVERY pending reactive
    // update (not just this component's own), self-healing without requiring
    // a manual drag. See uplotChartFillHeightResize.test.ts for the
    // regression this closes.
    scheduleResize()
  }
  scheduleNeedlePos()
}

/** Recompute the fixed needle from uPlot's interactive plot rectangle.
 * Horizontal centre plus plot-only top/height keeps it out of axes/legend. */
function updateNeedlePos(): void {
  if (!props.centreCursorMode || !plot || !wrap.value) {
    needleGeometry.value = null
    return
  }
  const wrapRect = wrap.value.getBoundingClientRect()
  const overRect = plot.over.getBoundingClientRect()
  needleGeometry.value = centreNeedleGeometry(wrapRect, overRect)
}

/**
 * uPlot and the responsive grid both commit geometry asynchronously. Measure
 * in two frames: the first follows uPlot's own commit, the second follows a
 * breakpoint reflow that lands in that first frame. Coalescing means a rapid
 * resize can never leave an older frame to overwrite the newest rectangle.
 */
function scheduleNeedlePos(): void {
  if (needleFrame != null) cancelAnimationFrame(needleFrame)
  if (needleSettleFrame != null) cancelAnimationFrame(needleSettleFrame)
  needleFrame = requestAnimationFrame(() => {
    needleFrame = null
    updateNeedlePos()
    needleSettleFrame = requestAnimationFrame(() => {
      needleSettleFrame = null
      updateNeedlePos()
    })
  })
}

function destroy(): void {
  plot?.destroy()
  plot = null
  // B94 — a recreate (theme change, centre-mode toggle, series-shape change)
  // must not leave a stale axis-band drag "stuck" against the old instance.
  axisPanPointerId = null
  axisBandDragging.value = false
  axisBandHover.value = false
}

// ── touch gestures (#8, B35) ─────────────────────────────────────────────────
// uPlot's built-in drag-box zoom only binds mouse events, so touch input is
// dead on this chart by default. We add our own Pointer Event handling for
// touch ONLY — per §8 layer 2 ("逐事件判斷，不是逐裝置"), pen is deliberately
// treated the SAME as mouse (bailing out below, same as mouse does) rather
// than lumped in with touch: a stylus drag should box-zoom like a mouse drag
// (and Shift+drag should pan like a mouse, via onHostMouseDown below), not pan
// like a finger — S Pen's hover support means it already gets the mouse-like
// experience for free once it's routed through the same path. Since neither
// mouse nor pen calls preventDefault() here, the browser's own compatibility
// mousedown/mousemove/mouseup events still fire for them, which is exactly
// what uPlot's native drag-zoom listens to — untouched. Touch gestures
// translate into X-range changes via the same `xZoom` event the mouse
// drag-zoom path already emits — so the shared X range still has a single
// owner (analyzerStore.xRange, or a local xRange for callers that don't sync
// one), rather than each chart maintaining its own touch-only zoom state.
const touchPointers = new Map<number, { x: number; y: number }>()
type TouchMode = 'idle' | 'pending' | 'pan' | 'pinch' | 'scroll' | 'select'
let touchMode: TouchMode = 'idle'
let panLastX = 0
let pinchLast: { dist: number; midX: number } | null = null
const touchSelectionActive = ref(false)
const TOUCH_LONG_PRESS_MS = 450
const TOUCH_SLOP_PX = 10
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let pendingTouchId: number | null = null
let pendingTouchStart: { x: number; y: number } | null = null
let suppressTouchContextMenu = false
let contextMenuResetTimer: ReturnType<typeof setTimeout> | null = null

function clearLongPress(): void {
  if (longPressTimer != null) clearTimeout(longPressTimer)
  longPressTimer = null
  pendingTouchId = null
  pendingTouchStart = null
}

function captureTouchPointer(pointerId: number): void {
  host.value?.setPointerCapture?.(pointerId)
}

function selectTouchCursor(pos: { x: number; y: number }): void {
  if (!plot) return
  const rect = plot.over.getBoundingClientRect()
  const point = clampPlotPoint(pos, rect.width, rect.height)
  plot.setCursor({ left: point.x, top: point.y })
}

function armLongPress(pointerId: number, start: { x: number; y: number }): void {
  clearLongPress()
  pendingTouchId = pointerId
  pendingTouchStart = start
  longPressTimer = setTimeout(() => {
    if (touchMode !== 'pending' || pendingTouchId !== pointerId || touchPointers.size !== 1) return
    touchMode = 'select'
    touchSelectionActive.value = true
    suppressTouchContextMenu = true
    if (contextMenuResetTimer != null) clearTimeout(contextMenuResetTimer)
    contextMenuResetTimer = setTimeout(() => {
      suppressTouchContextMenu = false
      contextMenuResetTimer = null
    }, 1500)
    selectTouchCursor(touchPointers.get(pointerId) ?? start)
    captureTouchPointer(pointerId)
    longPressTimer = null
  }, TOUCH_LONG_PRESS_MS)
}

/** Current X data-bounds (full data extent), used to clamp touch pan/pinch —
 * same bounds uPlot itself would use for a fully-zoomed-out view. */
function dataXBounds(): XRange | null {
  if (props.xBounds && props.xBounds.min < props.xBounds.max) return props.xBounds
  const xs = props.data[0] as (number | null)[] | undefined
  if (!xs || xs.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const v of xs) {
    if (v == null || !Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!(min < max)) return null
  return { min, max }
}

/** Current visible X range (the shared range if set, else the full extent). */
function currentXRange(): XRange | null {
  if (props.xRange) return props.xRange
  if (!plot) return dataXBounds()
  const { min, max } = plot.scales.x
  if (min == null || max == null) return dataXBounds()
  return { min, max }
}

function emitXRange(range: XRange): void {
  // Reflect immediately so the gesture feels responsive even before the prop
  // round-trips back down (parent may re-derive xRange asynchronously).
  applyingRange = true
  plot?.setScale('x', range)
  clearApplyingRangeSoon()
  emit('xZoom', range)
}

// B9 — reset-zoom control: restores the full data extent and tells the
// parent via `xZoom(null)` (rather than the resolved bounds) so a caller
// syncing a SHARED range — e.g. analyzerStore.xRange — clears it back to
// "auto" instead of pinning every synced chart to this chart's bounds. A
// chart whose xRange stays disconnected from any shared store (e.g. an
// overlay chart with a lap selection — see TimeSeriesChart.vue's
// `hasSelection` gate on its own `xZoom` forwarding) simply resets locally;
// nothing upstream reacts to the null, which is correct there too.
function resetZoomLocal(): void {
  const bounds = dataXBounds()
  if (!plot || !bounds) return
  applyingRange = true
  plot.setScale('x', bounds)
  clearApplyingRangeSoon()
  zoomed.value = false
  emit('xZoom', null)
}

// B9 — mouse pan: uPlot's own mousedown on `.u-over` always starts its
// native box-zoom drag (cursor.drag defaults to x-only, dist 0), so a plain
// mouse drag can never mean "pan" without fighting that default. Instead of
// touching uPlot's cursor.bind (whose MouseListenerFactory typings return a
// listener that's supposed to call uPlot's own internal handler — awkward to
// satisfy without reaching into uPlot internals), a capture-phase listener
// on `host` (an ANCESTOR of `.u-over`) intercepts Shift+drag before it ever
// reaches uPlot's own listener and starts our own window-level drag-to-pan,
// reusing the exact same `dataXBounds`/`currentXRange`/`emitXRange`/
// `panRange` pipeline the touch pan gesture below already uses. Plain
// (non-Shift) drags are left completely alone for uPlot's native zoom.
let panningMouse = false
let panLastXMouse = 0

function onMousePanMove(e: MouseEvent): void {
  if (!panningMouse || !plot) return
  const bounds = dataXBounds()
  if (!bounds) return
  const range = currentXRange() ?? bounds
  const overRect = plot.over.getBoundingClientRect()
  const prevVal = plot.posToVal(panLastXMouse - overRect.left, 'x')
  const curVal = plot.posToVal(e.clientX - overRect.left, 'x')
  const deltaX = curVal - prevVal
  emitXRange(panRange(range, deltaX, bounds))
  panLastXMouse = e.clientX
}

function onMousePanUp(): void {
  panningMouse = false
  window.removeEventListener('mousemove', onMousePanMove)
  window.removeEventListener('mouseup', onMousePanUp)
}

function onHostMouseDown(e: MouseEvent): void {
  // B31 — centre-needle mode replaces Shift+drag-pan with its own unified
  // drag-to-scrub gesture (see onPointerDown's centreCursorMode branch); a
  // plain mouse drag already pans in that mode, so Shift+drag would be
  // redundant — and since a real mouse's compatibility `mousedown` never even
  // fires once onPointerDown has called `preventDefault()` on the priming
  // `pointerdown`, this guard is mostly defensive/explicit rather than load-
  // bearing, but keeps this handler correct even if that browser behaviour
  // ever changes.
  if (props.centreCursorMode) return
  if (e.button !== 0 || !e.shiftKey || !plot) return
  e.preventDefault()
  e.stopPropagation() // capture phase — keeps uPlot's own listener on .u-over from ever seeing this mousedown
  panningMouse = true
  panLastXMouse = e.clientX
  window.addEventListener('mousemove', onMousePanMove)
  window.addEventListener('mouseup', onMousePanUp)
}

function touchMidpoint(): { x: number; y: number } | null {
  if (touchPointers.size < 2) return null
  const it = touchPointers.values()
  const p1 = it.next().value!
  const p2 = it.next().value!
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
}

function touchDist(): number {
  if (touchPointers.size < 2) return 0
  const it = touchPointers.values()
  const p1 = it.next().value!
  const p2 = it.next().value!
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

/** CSS-px position within the plotting area (u.over), for uPlot's valToPos/posToVal. */
function overPos(e: PointerEvent): { x: number; y: number } | null {
  const over = plot?.over
  if (!over) return null
  const rect = over.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function startTouchGesture(e: PointerEvent, allowLongPress: boolean): void {
  const pos = overPos(e)
  if (!pos || !plot) return
  touchPointers.set(e.pointerId, pos)

  if (touchPointers.size >= 2) {
    clearLongPress()
    touchSelectionActive.value = false
    touchMode = 'pinch'
    for (const pointerId of touchPointers.keys()) captureTouchPointer(pointerId)
    const mid = touchMidpoint()
    pinchLast = mid ? { dist: touchDist(), midX: mid.x } : null
    e.preventDefault()
    return
  }

  if (allowLongPress) {
    touchMode = 'pending'
    armLongPress(e.pointerId, pos)
    // Do not capture or prevent the pending event: dominant vertical motion
    // must remain available to the page's native pan-y scroll.
    return
  }

  touchMode = 'pan'
  panLastX = pos.x
  captureTouchPointer(e.pointerId)
  e.preventDefault()
}

function moveTouchGesture(e: PointerEvent): void {
  if (!touchPointers.has(e.pointerId) || !plot) return
  const pos = overPos(e)
  if (!pos) return

  if (touchMode === 'pending') {
    const start = pendingTouchStart
    if (!start || pendingTouchId !== e.pointerId) return
    const intent = pendingTouchIntent(start, pos, TOUCH_SLOP_PX)
    if (intent === 'pending') {
      touchPointers.set(e.pointerId, pos)
      return
    }
    clearLongPress()
    if (intent === 'scroll') {
      touchMode = 'scroll'
      touchPointers.set(e.pointerId, pos)
      return
    }
    touchMode = 'pan'
    panLastX = start.x
    captureTouchPointer(e.pointerId)
  }

  touchPointers.set(e.pointerId, pos)

  if (touchMode === 'scroll') return
  if (touchMode === 'select') {
    selectTouchCursor(pos)
    e.preventDefault()
    return
  }

  const bounds = dataXBounds()
  if (!bounds) return
  const range = currentXRange() ?? bounds

  if (touchMode === 'pinch') {
    const mid = touchMidpoint()
    if (!mid || !pinchLast) return
    const dist = touchDist()
    if (dist <= 0 || pinchLast.dist <= 0) return
    const factor = dist / pinchLast.dist
    const aboutVal = plot.posToVal(pinchLast.midX, 'x')
    const midValNow = plot.posToVal(mid.x, 'x')
    const midValPrev = plot.posToVal(pinchLast.midX, 'x')
    const deltaX = midValPrev - midValNow
    emitXRange(
      props.centreCursorMode
        ? pinchCentreNeedleRange(range, factor, aboutVal, -deltaX, bounds)
        : pinchRange(range, factor, aboutVal, -deltaX, bounds),
    )
    pinchLast = { dist, midX: mid.x }
    e.preventDefault()
    return
  }

  if (touchMode === 'pan') {
    const prevVal = plot.posToVal(panLastX, 'x')
    const curVal = plot.posToVal(pos.x, 'x')
    emitXRange(
      props.centreCursorMode
        ? panCentreNeedleRange(range, curVal - prevVal, bounds)
        : panRange(range, curVal - prevVal, bounds),
    )
    panLastX = pos.x
    e.preventDefault()
  }
}

function endTouchGesture(e: PointerEvent): void {
  if (!touchPointers.has(e.pointerId)) return
  clearLongPress()
  touchPointers.delete(e.pointerId)
  touchSelectionActive.value = false

  if (touchMode === 'pinch' && touchPointers.size === 1) {
    touchMode = 'pan'
    panLastX = touchPointers.values().next().value?.x ?? panLastX
    pinchLast = null
    return
  }
  if (touchPointers.size === 0) {
    touchMode = 'idle'
    pinchLast = null
  }
}

function onTouchContextMenu(e: Event): void {
  if (suppressTouchContextMenu || (e as PointerEvent).pointerType === 'touch') {
    e.preventDefault()
    suppressTouchContextMenu = false
    if (contextMenuResetTimer != null) clearTimeout(contextMenuResetTimer)
    contextMenuResetTimer = null
  }
}

// ── B31 centre-needle scrub gesture ─────────────────────────────────────────
// Mouse/pen drag while centre-needle mode is active: reuses the exact same
// dataXBounds/currentXRange/panRange/emitXRange pipeline the touch-pan
// gesture above already uses. Touch is routed through the shared touch state
// machine instead, preserving two-finger pinch and pointerType separation.
let centreScrubPointerId: number | null = null
let centreScrubLastX = 0

function onCentrePointerDown(e: PointerEvent): void {
  if (centreScrubPointerId != null) return // one active drag at a time
  const pos = overPos(e)
  if (!pos || !plot) return
  centreScrubPointerId = e.pointerId
  centreScrubLastX = pos.x
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function onCentrePointerMove(e: PointerEvent): void {
  if (centreScrubPointerId !== e.pointerId || !plot) return
  const pos = overPos(e)
  if (!pos) return
  const bounds = dataXBounds()
  if (!bounds) return
  const range = currentXRange() ?? bounds
  const prevVal = plot.posToVal(centreScrubLastX, 'x')
  const curVal = plot.posToVal(pos.x, 'x')
  const deltaX = curVal - prevVal // > 0 when the pointer moves right
  // Content follows the pointer, same convention as the touch-pan gesture
  // above (drag right → window shifts left, i.e. -deltaX).
  emitXRange(panCentreNeedleRange(range, deltaX, bounds))
  centreScrubLastX = pos.x
}

function onCentrePointerUp(e: PointerEvent): void {
  if (centreScrubPointerId === e.pointerId) centreScrubPointerId = null
}

// ── B94 X-axis band pan (normal mode, while zoomed) ─────────────────────────
// Normal mode leaves the plot area to uPlot's own native drag-to-zoom (see
// buildOptions' cursor.drag, unset in this mode), which means a plain drag
// there can never also mean "pan" without refighting that default. Instead,
// dragging the X-AXIS TICK/LABEL BAND below the plot — a region uPlot's own
// `.u-over` doesn't cover at all, see `isPointInAxisBand` — pans the visible
// window, reusing the exact same dataXBounds/currentXRange/emitXRange
// pipeline the Shift+drag and touch-pan gestures already use. Deliberately
// reuses the STRICT `panRange` (no B68 virtual edge padding): that's a
// centre-mode-only concept, and this gesture never runs in centre mode at all.
let axisPanPointerId: number | null = null
let axisPanLastX = 0

/** Live geometry needed to hit-test the axis band, in the same viewport CSS-px
 *  space as `isPointInAxisBand` expects: the plot's own interactive rect and
 *  the full plot+axes canvas rect (uPlot draws every axis directly onto that
 *  one canvas — see `isPointInAxisBand`'s doc). `null` before uPlot exists. */
function axisBandGeometry(): { plotting: Rect2D; canvas: Rect2D } | null {
  if (!plot) return null
  return { plotting: plot.over.getBoundingClientRect(), canvas: plot.ctx.canvas.getBoundingClientRect() }
}

/** Axis-band panning only makes sense while there's something to pan: centre
 *  mode has its own drag gesture (see onCentrePointerDown above), and an
 *  unzoomed chart has no narrower window to shift within the full extent. */
function isAxisPanEligible(): boolean {
  return !props.centreCursorMode && zoomed.value
}

/** Keep the `grab` cursor affordance in sync with the live pointer position;
 *  called on every pointermove regardless of which gesture (if any) is active. */
function updateAxisBandHover(e: PointerEvent): void {
  if (!isAxisPanEligible()) {
    axisBandHover.value = false
    return
  }
  const geo = axisBandGeometry()
  axisBandHover.value = geo != null && isPointInAxisBand({ x: e.clientX, y: e.clientY }, geo.plotting, geo.canvas)
}

function startAxisBandPan(e: PointerEvent): void {
  if (axisPanPointerId != null || !plot) return
  axisPanPointerId = e.pointerId
  axisPanLastX = e.clientX
  axisBandDragging.value = true
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
  e.preventDefault()
}

function moveAxisBandPan(e: PointerEvent): void {
  if (axisPanPointerId !== e.pointerId || !plot) return
  const bounds = dataXBounds()
  if (!bounds) return
  const range = currentXRange() ?? bounds
  // Same pixel→value conversion as onMousePanMove/onCentrePointerMove: the
  // axis band shares its horizontal alignment with `.u-over` (uPlot draws
  // ticks directly under their data columns), so `over`'s left offset is
  // still the correct reference even though the pointer itself sits below it.
  const overRect = plot.over.getBoundingClientRect()
  const prevVal = plot.posToVal(axisPanLastX - overRect.left, 'x')
  const curVal = plot.posToVal(e.clientX - overRect.left, 'x')
  emitXRange(panRange(range, curVal - prevVal, bounds))
  axisPanLastX = e.clientX
  e.preventDefault()
}

function endAxisBandPan(e: PointerEvent): void {
  if (axisPanPointerId !== e.pointerId) return
  axisPanPointerId = null
  axisBandDragging.value = false
}

function onPointerDown(e: PointerEvent): void {
  // B36 — this chart now bleeds to the true viewport edge on mobile (see
  // `.uplot-wrap.fill`'s `--card-bleed-x` styling below), so a touch drag
  // STARTING right at that edge would fight the OS/browser's own edge-swipe
  // "go back" gesture. Only touch is gated (mouse/pen have no such OS
  // gesture to protect — see edgeGesture.ts's own doc), and only checked
  // when a coarse pointer is actually present. Applies before BOTH the
  // centre-needle scrub branch and the plain touch-pan/pinch branch below —
  // either one would otherwise claim the drag via `preventDefault()`/
  // `setPointerCapture()`.
  if (e.pointerType === 'touch' && anyPointerCoarse.value && isEdgeGestureZone(e.clientX, window.innerWidth)) {
    return
  }
  // B94 — the axis band claims its own drag before anything else considers
  // this pointerdown, for every pointer type (mouse/touch/pen): it's a region
  // uPlot's native drag-zoom and this file's other gestures never reach.
  if (isAxisPanEligible()) {
    const geo = axisBandGeometry()
    if (geo && isPointInAxisBand({ x: e.clientX, y: e.clientY }, geo.plotting, geo.canvas)) {
      startAxisBandPan(e)
      return
    }
  }
  if (isTouchGesturePointer(e.pointerType)) {
    // Normal mode waits for long press vs horizontal pan vs vertical page
    // scroll. Centre mode starts panning immediately but still admits a
    // second touch for pinch zoom.
    startTouchGesture(e, !props.centreCursorMode)
    return
  }
  if (props.centreCursorMode) {
    onCentrePointerDown(e)
    return
  }
  // Mouse and pen keep uPlot's native drag-zoom outside centre mode.
}

function onPointerMove(e: PointerEvent): void {
  updateAxisBandHover(e)
  if (axisPanPointerId != null) {
    moveAxisBandPan(e)
    return
  }
  if (isTouchGesturePointer(e.pointerType)) {
    moveTouchGesture(e)
    return
  }
  if (props.centreCursorMode) {
    onCentrePointerMove(e)
  }
}

function onPointerUp(e: PointerEvent): void {
  if (axisPanPointerId != null) {
    endAxisBandPan(e)
    return
  }
  if (isTouchGesturePointer(e.pointerType)) {
    endTouchGesture(e)
    return
  }
  if (props.centreCursorMode) {
    onCentrePointerUp(e)
  }
}

function onCentreWheel(e: WheelEvent): void {
  if (!props.centreCursorMode || !plot || e.deltaY === 0) return
  const bounds = dataXBounds()
  if (!bounds) return
  const range = currentXRange() ?? bounds
  const about = (range.min + range.max) / 2
  const factor = Math.exp(-e.deltaY * 0.002)
  emitXRange(zoomCentreNeedleRange(range, factor, about, bounds))
  e.preventDefault()
}

/** A signature of the series shape; changing it requires re-creating uPlot. */
function seriesKey(): string {
  return props.series.map((s) => s.label ?? '').join('|')
}

/** Resize only after Vue and the browser have settled the latest grid layout. */
function scheduleResize(): void {
  const epoch = ++resizeEpoch
  void nextTick(() => {
    if (epoch !== resizeEpoch) return
    if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      if (epoch !== resizeEpoch) return
      resizeNow()
    })
  })
}

/** Apply a settled, non-transitional size to uPlot. */
function resizeNow(): void {
  if (!plot || !host.value) return
  const width = host.value.clientWidth
  const height = targetHeight()
  // A breakpoint can transiently detach/collapse a grid item. Do not teach
  // uPlot that zero is a real size and do not erase the last valid needle.
  if (!(width > 0) || !(height > 0)) return
  emit('plotWidth', width)
  plot.setSize({ width, height })
  scheduleNeedlePos()
}

/** Keep host/wrapper size changes separate from uPlot's own plot-area change. */
function onChartGeometryResize(entries: ResizeObserverEntry[]): void {
  const needsSize = entries.some((entry) => entry.target === host.value || entry.target === wrap.value)
  if (needsSize) scheduleResize()
  else scheduleNeedlePos()
}

/** Re-observe the live uPlot overlay after every create() replacement. */
function observeChartGeometry(): void {
  if (!ro) return
  ro.disconnect()
  if (host.value) ro.observe(host.value)
  if (wrap.value) ro.observe(wrap.value)
  if (plot) ro.observe(plot.over)
}

// Data-only change → fast setData. Series structure change → recreate. Seeded
// from onMounted's initial create() (not left at '') so the very next
// `[data, series]` firing — even a plain data refresh with the SAME
// channels — doesn't mismatch against an unset baseline and force an
// unnecessary extra recreate.
let lastKey = ''

onMounted(() => {
  create()
  lastKey = seriesKey()
  ro = new ResizeObserver(onChartGeometryResize)
  observeChartGeometry()
  // dpr / viewport changes (e.g. devtools device-mode toggle) don't trigger the
  // element ResizeObserver — also redraw on window resize.
  window.addEventListener('resize', scheduleResize)
  // Recreate with new colours when the theme (data-theme) changes.
  themeObs = new MutationObserver(() => create())
  themeObs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  // B9 — Shift+drag-to-pan (capture phase, see onHostMouseDown's doc); `host`
  // itself is stable across recreate()s, so this is wired up once.
  host.value?.addEventListener('mousedown', onHostMouseDown, true)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  themeObs?.disconnect()
  window.removeEventListener('resize', scheduleResize)
  host.value?.removeEventListener('mousedown', onHostMouseDown, true)
  window.removeEventListener('mousemove', onMousePanMove)
  window.removeEventListener('mouseup', onMousePanUp)
  clearLongPress()
  if (contextMenuResetTimer != null) clearTimeout(contextMenuResetTimer)
  if (needleFrame != null) cancelAnimationFrame(needleFrame)
  if (needleSettleFrame != null) cancelAnimationFrame(needleSettleFrame)
  if (resizeFrame != null) cancelAnimationFrame(resizeFrame)
  resizeEpoch++
  destroy()
})

watch(
  () => [props.data, props.series],
  () => {
    const key = seriesKey()
    if (!plot || key !== lastKey) {
      lastKey = key
      create()
    } else {
      const instance = plot
      instance.setData(props.data)
      applyXRange()
      queueCentreCursor(instance)
    }
  },
  { deep: false },
)

// Sync this chart to the shared X zoom range.
watch(
  () => props.xRange,
  () => applyXRange(),
)

watch(
  () => props.externalCursor,
  (idx) => {
    // B31 — centre-needle mode has no meaningful "hover position" to snap
    // to: the needle is pinned to the chart's own centre, and cross-chart
    // sync in this mode comes from the shared xRange instead (see the
    // `centreCursorMode` prop doc). Applying an external cursor here would
    // move uPlot's native crosshair, which is already turned off in this
    // mode (see buildOptions' `cursor.x/y`) — so this is a no-op guard for
    // clarity/robustness rather than a visible fix on its own.
    if (props.centreCursorMode) return
    if (!plot || idx == null) return
    const xVal = (plot.data[0] as number[])[idx]
    if (!Number.isFinite(xVal)) return
    const left = plot.valToPos(xVal, 'x')
    if (!Number.isFinite(left)) return
    applyingCursor = true
    plot.setCursor({ left, top: 0 })
    applyingCursor = false
  },
)

// B31 — toggling centre-needle mode changes buildOptions()'s baked-in
// `cursor.x/y` config, which only takes effect on (re)construction — so
// recreate the chart, same precedent as the theme-change MutationObserver
// above (`themeObs`) recreating for a baked-in colour config change.
watch(
  () => props.centreCursorMode,
  () => create(),
)

// B94 — `grab` while the axis band is draggable and idle, `grabbing` while
// actually being dragged; unset (browser default) everywhere else, so the
// band behaves exactly as before outside normal-mode zoom.
const axisBandCursor = computed<string | undefined>(() => {
  if (axisBandDragging.value) return 'grabbing'
  if (axisBandHover.value) return 'grab'
  return undefined
})
</script>

<template>
  <div ref="wrap" class="uplot-wrap" :class="{ fill: fillHeight }">
    <div
      ref="host"
      class="uplot-host"
      :class="{ fill: fillHeight, 'touch-selecting': touchSelectionActive }"
      :style="{ cursor: axisBandCursor }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @contextmenu="onTouchContextMenu"
      @wheel="onCentreWheel"
    />
    <!-- B31 — always-visible fixed centre needle (replaces uPlot's own hover
         crosshair in this mode, see buildOptions' cursor.x/y). Plain CSS
         overlay positioned against `wrap`, NOT a child of `host` — see
         `wrap`'s doc for why. `pointer-events: none` so it never steals the
         drag gesture from the host underneath it. -->
    <div
      v-if="centreCursorMode && needleGeometry"
      class="centre-needle"
      :style="{
        left: `${needleGeometry.left}px`,
        top: `${needleGeometry.top}px`,
        height: `${needleGeometry.height}px`,
      }"
    />
    <!-- B9 — reset-zoom control: only shown while actually zoomed (see the
         `zoomed` ref's doc), so it doesn't clutter the chart at the default
         full view. Double-click also resets (uPlot's own default dblclick
         auto-ranges the scale back to the data extent), but that's not
         discoverable on touch and easy to miss on desktop — this button
         makes the same action explicit and always reachable. -->
    <button v-if="zoomed" type="button" class="reset-zoom" @click="resetZoomLocal">
      {{ t('analyzer.resetZoom') }}
    </button>
  </div>
</template>

<style scoped>
.uplot-wrap {
  position: relative;
  width: 100%;
}
.uplot-wrap.fill {
  height: 100%;
  display: flex;
  flex-direction: column;
  /* B36 — 手機單欄模式圖表出血貼邊: `--card-bleed-x` is 0 everywhere except
     inside a NON-pinned DashboardCard on mobile (see DashboardCard.vue's own
     doc on the variable) — a plain CSS custom-property cascade, so this
     works unconditionally with no media query of its own here and is a
     total no-op for every OTHER caller of this component (GearPanel.vue,
     SessionMergePanel.vue, any fixed-height, non-dashboard chart), which
     never sets the variable at all and falls back to `0px`. The Y-axis
     label gutter uPlot itself reserves stays readable even flush to the
     true edge (it's drawn well inside the plot area, not clipped by this).
     Negative margin + matching width overshoot (rather than relying on this
     flex item's own `align-items: stretch`, which a plain `width: 100%`
     below already opts out of) is what actually reaches the true edge — see
     edgeGesture.ts's sibling doc on the JS-side touch dead-zone this pairs
     with. */
  margin-left: calc(-1 * var(--card-bleed-x, 0px));
  margin-right: calc(-1 * var(--card-bleed-x, 0px));
  width: calc(100% + 2 * var(--card-bleed-x, 0px));
}
.uplot-wrap.fill .uplot-host {
  flex: 1;
  min-width: 0;
}
/* B31 — fixed centre needle: a plain vertical line, NOT uPlot's native
   cursor crosshair (disabled in this mode via buildOptions' cursor.x/y) —
   stays put while the user drags the chart underneath it. */
.centre-needle {
  position: absolute;
  width: 0;
  border-left: 2px dashed var(--color-accent);
  pointer-events: none;
  z-index: 1;
}
.reset-zoom {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  padding: 3px 9px;
  font-size: 0.75rem;
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
}
.reset-zoom:hover {
  border-color: var(--color-text-muted);
}
/* B35 — §8 layer 3: any coarse pointer present (not a viewport-width guess —
   see useInputCapabilities.ts, mirrored onto <html data-any-pointer-coarse>)
   grows this to a comfortable >=44px touch target. Unlike the icon-only
   buttons elsewhere (which keep their small visual size and grow only their
   invisible hit area), this button already carries a text label, so growing
   the visible box itself reads fine here. */
:root[data-any-pointer-coarse] .reset-zoom {
  padding: 12px 16px;
  font-size: 0.85rem;
  min-height: 44px;
}
.uplot-host {
  width: 100%;
  /* This chart sits in a scrollable page, unlike TrackMap's dedicated canvas —
     so unlike TrackMap's `touch-action: none`, we keep vertical page scroll
     available (pan-y) and only claim horizontal drag + pinch for our own
     pan/zoom gesture handling (see onPointerDown/Move/Up above). */
  touch-action: pan-y;
}
/* #8 — fillHeight mode: stretch to the parent's available height (a
   dashboard grid item's card body) instead of sizing to the fixed `height`
   prop's canvas. The parent must establish a definite height (flex/grid
   item with min-height: 0) for this to have any effect. */
.uplot-host.fill {
  height: 100%;
}
/* uPlot's legend is HTML — theme its text (canvas axes are themed via options). */
.uplot-host :deep(.u-legend) {
  color: var(--color-text);
}
</style>
