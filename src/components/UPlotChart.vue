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
 * B31 — RaceChrono-style fixed centre-needle mode: the sample index whose X
 * value is closest to the exact horizontal MIDPOINT of `range` (the chart's
 * current visible window) — i.e. "what the fixed needle is currently
 * pointing at". This app never uses a log X scale (`scales: { x: { time:
 * false } }` in buildOptions below), so the midpoint of a linear range IS the
 * data value under the centre pixel — no live uPlot instance / `posToVal`
 * needed, which keeps this pure and unit-testable like `isZoomed`/
 * `isTouchGesturePointer` above. Recomputed (via the `setScale` hook) on
 * every visible-range change while centre-needle mode is active — a user
 * drag/scrub, a synced `xRange` update from another chart, or a zoom — and
 * the result is emitted onward as this chart's `cursor` so the rest of the
 * app (current-values card, map, other synced charts) tracks the scrub.
 */
export function centreCursorIndex(
  xs: ArrayLike<number>,
  range: { min: number; max: number },
): number | null {
  if (xs.length === 0) return null
  return nearestXIndex(xs, (range.min + range.max) / 2)
}
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { panRange, pinchRange, type XRange } from '@/features/analyzer/xRangeGesture'

const { t } = useI18n()

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
   *    (Multi-touch pinch-zoom is intentionally NOT part of this mode — one
   *    single-pointer drag gesture only, per the "pick ONE gesture" brief.)
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
const needleLeft = ref<number | null>(null)
let plot: uPlot | null = null
let ro: ResizeObserver | null = null
let themeObs: MutationObserver | null = null
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
  const themed = (a: uPlot.Axis): uPlot.Axis => ({
    grid: { stroke: gridStroke, width: 1 },
    ticks: { stroke: gridStroke, width: 1 },
    ...a,
    stroke: a.stroke ?? axisStroke,
  })
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
    cursor: props.centreCursorMode
      ? { focus: { prox: 16 }, x: false, y: false }
      : { focus: { prox: 16 } },
    hooks: {
      setCursor: [
        (u: uPlot) => {
          // B31 — in centre-needle mode the emitted cursor comes from the
          // FIXED centre (see the `setScale` hook below + `emitCentreCursor`),
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
            const xs = u.data[0] as number[]
            emit('cursor', centreCursorIndex(xs, { min, max }))
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
  plot = new uPlot(buildOptions(width), props.data, host.value)
  applyXRange(false) // adopt the shared zoom on (re)create, e.g. a newly added chart
  clearApplyingRangeSoon()
  // T1 — the legend only exists AFTER construction, so the height baked into
  // buildOptions() couldn't subtract it yet; re-measure once now that it's in
  // the DOM so canvas + legend fit the host exactly (fillHeight mode only —
  // fixed-height callers size the canvas to the `height` prop and let the
  // page flow around the legend, unchanged).
  if (props.fillHeight) {
    resize()
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
    void nextTick(resize)
  }
  updateNeedlePos()
}

/** B31 — recompute the fixed needle's `left` offset from uPlot's OWN plot
 *  area (`plot.over`), relative to `wrap`. Called after every layout change
 *  that could move/resize the plot area (create/recreate, resize, including
 *  axis-width changes from a channel add/remove) — mirrors how `resize()`
 *  already re-measures `targetHeight()` on the same triggers. A no-op
 *  (leaves `needleLeft` at whatever it was) when centre-needle mode is off,
 *  the plot doesn't exist yet, or `wrap` isn't mounted. */
function updateNeedlePos(): void {
  if (!props.centreCursorMode || !plot || !wrap.value) {
    needleLeft.value = null
    return
  }
  const wrapRect = wrap.value.getBoundingClientRect()
  const overRect = plot.over.getBoundingClientRect()
  needleLeft.value = overRect.left - wrapRect.left + overRect.width / 2
}

function destroy(): void {
  plot?.destroy()
  plot = null
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
type TouchMode = 'idle' | 'pan' | 'pinch'
let touchMode: TouchMode = 'idle'
let panLastX = 0
let pinchLast: { dist: number; midX: number } | null = null

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
  applyingRange = false
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

// ── B31 centre-needle scrub gesture ─────────────────────────────────────────
// ONE drag gesture for EVERY pointer type (touch/mouse/pen — per DESIGN.md §8
// layer 1, every interaction must be reachable by every input method) while
// centre-needle mode is active: reuses the exact same
// dataXBounds/currentXRange/panRange/emitXRange pipeline the touch-pan
// gesture above already uses, just without the touch-only pointerType gate
// and without pinch (a single active pointer only — "pick ONE gesture" per
// the brief). Kept as its own small set of functions (rather than folding
// into the touch-gesture branches above) so the existing touch/mouse/pen
// pointer handling is untouched when this mode is off.
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
  emitXRange(panRange(range, deltaX, bounds))
  centreScrubLastX = pos.x
}

function onCentrePointerUp(e: PointerEvent): void {
  if (centreScrubPointerId === e.pointerId) centreScrubPointerId = null
}

function onPointerDown(e: PointerEvent): void {
  if (props.centreCursorMode) {
    onCentrePointerDown(e)
    return
  }
  if (!isTouchGesturePointer(e.pointerType)) return // mouse AND pen keep uPlot's native drag-zoom (B35 §8 layer 2)
  const pos = overPos(e)
  if (!pos || !plot) return
  touchPointers.set(e.pointerId, pos)
  ;(e.target as Element).setPointerCapture?.(e.pointerId)

  if (touchPointers.size >= 2) {
    touchMode = 'pinch'
    const mid = touchMidpoint()
    pinchLast = mid ? { dist: touchDist(), midX: mid.x } : null
  } else {
    touchMode = 'pan'
    panLastX = pos.x
  }
  e.preventDefault()
}

function onPointerMove(e: PointerEvent): void {
  if (props.centreCursorMode) {
    onCentrePointerMove(e)
    return
  }
  if (!isTouchGesturePointer(e.pointerType)) return
  if (!touchPointers.has(e.pointerId)) return
  const pos = overPos(e)
  if (!pos || !plot) return
  touchPointers.set(e.pointerId, pos)

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
    const deltaX = midValPrev - midValNow // content should follow the fingers
    emitXRange(pinchRange(range, factor, aboutVal, -deltaX, bounds))
    pinchLast = { dist, midX: mid.x }
    return
  }

  if (touchMode === 'pan') {
    const prevVal = plot.posToVal(panLastX, 'x')
    const curVal = plot.posToVal(pos.x, 'x')
    const deltaX = curVal - prevVal // > 0 when the finger moves right
    // Content should follow the finger (drag right → reveal earlier/smaller X,
    // i.e. the window shifts left) — panRange's deltaX shifts min/max by -deltaX,
    // so pass +deltaX here to get the window to move by -deltaX.
    emitXRange(panRange(range, deltaX, bounds))
    panLastX = pos.x
  }
}

function onPointerUp(e: PointerEvent): void {
  if (props.centreCursorMode) {
    onCentrePointerUp(e)
    return
  }
  if (!isTouchGesturePointer(e.pointerType)) return
  touchPointers.delete(e.pointerId)

  if (touchMode === 'pinch') {
    if (touchPointers.size === 1) {
      touchMode = 'pan'
      panLastX = touchPointers.values().next().value?.x ?? panLastX
      pinchLast = null
    } else if (touchPointers.size === 0) {
      touchMode = 'idle'
      pinchLast = null
    }
    return
  }
  if (touchPointers.size === 0) touchMode = 'idle'
}

/** A signature of the series shape; changing it requires re-creating uPlot. */
function seriesKey(): string {
  return props.series.map((s) => s.label ?? '').join('|')
}

function resize(): void {
  if (plot && host.value) {
    emit('plotWidth', host.value.clientWidth)
    plot.setSize({ width: host.value.clientWidth, height: targetHeight() })
    updateNeedlePos()
  }
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
  ro = new ResizeObserver(() => resize())
  if (host.value) ro.observe(host.value)
  // dpr / viewport changes (e.g. devtools device-mode toggle) don't trigger the
  // element ResizeObserver — also redraw on window resize.
  window.addEventListener('resize', resize)
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
  window.removeEventListener('resize', resize)
  host.value?.removeEventListener('mousedown', onHostMouseDown, true)
  window.removeEventListener('mousemove', onMousePanMove)
  window.removeEventListener('mouseup', onMousePanUp)
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
      plot.setData(props.data)
      applyXRange()
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
</script>

<template>
  <div ref="wrap" class="uplot-wrap" :class="{ fill: fillHeight }">
    <div
      ref="host"
      class="uplot-host"
      :class="{ fill: fillHeight }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    />
    <!-- B31 — always-visible fixed centre needle (replaces uPlot's own hover
         crosshair in this mode, see buildOptions' cursor.x/y). Plain CSS
         overlay positioned against `wrap`, NOT a child of `host` — see
         `wrap`'s doc for why. `pointer-events: none` so it never steals the
         drag gesture from the host underneath it. -->
    <div v-if="centreCursorMode && needleLeft != null" class="centre-needle" :style="{ left: `${needleLeft}px` }" />
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
  top: 0;
  bottom: 0;
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
