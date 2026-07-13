import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type uPlotType from 'uplot'

/**
 * B31b regression test — "固定中線模式 unusable — 一點用都沒有、還是歪的".
 *
 * Root cause (see src/components/UPlotChart.vue's buildOptions): centre-needle
 * mode turned off uPlot's native cursor CROSSHAIR via `cursor.x: false,
 * cursor.y: false` (to avoid drawing two conflicting cursor indicators
 * alongside the fixed needle), but left `cursor.drag` at its DEFAULT
 * (`{ x: true, setScale: true, ... }`) — which is an entirely separate
 * feature from `cursor.x`/`cursor.y` (confirmed by reading uPlot's own
 * `mouseUp()` handler: it fires `_setScale(xScaleKey, posToVal(...),
 * posToVal(...))` off the drag-select box whenever
 * `drag.setScale && hasSelect && chgSelect`, with NO reference to
 * `cursor.x`/`cursor.y` anywhere in that path).
 *
 * Concretely: this component's own `onCentrePointerDown` calls
 * `e.preventDefault()` on the `pointerdown`, which is enough to suppress the
 * browser's *synthesized* "compatibility" mouse events for touch/pen — but
 * NOT for an actual mouse, whose `mousedown`/`mousemove`/`mouseup` are fired
 * natively and independently of the pointer events (they are not
 * "compatibility" events synthesized FROM the pointer events for that input
 * type). So on every mouse drag in this mode, uPlot's OWN native
 * `mousedown`/`mousemove`/`mouseup` listeners on `.u-over` were STILL live
 * and running their default drag-to-box-zoom behaviour AT THE SAME TIME as
 * this component's own pan gesture — and uPlot's `mouseup` handler
 * unconditionally overwrites the x scale with its own box-zoom result,
 * stomping whatever range our own pan gesture had just set. That's the
 * "一點用都沒有、還是歪的" bug: every mouse drag which was *supposed* to pan
 * the view under the fixed needle instead ended with the view snapped to
 * uPlot's own (irrelevant) box-zoom selection.
 *
 * The fix adds `cursor.drag: { setScale: false, x: false, y: false }`
 * whenever centre-needle mode is on, fully neutralizing uPlot's native drag
 * handling so this component's own pointer handlers are the ONLY thing that
 * can change the x range during a drag.
 *
 * This test drives the ACTUAL `uplot` package (not a mock) against a minimal
 * DOM stub (same pattern as uplotChartGuard.test.ts's A13 test): it
 * constructs a real uPlot instance with each cursor config, sets the scale to
 * an arbitrary "already panned to" range (standing in for what this
 * component's own onCentrePointerMove would have just done), then fires a
 * REAL mousedown → mousemove → mouseup sequence directly at uPlot's own
 * `.u-over` listeners (exactly what a real mouse drag dispatches, regardless
 * of any `preventDefault()` called on a separate `pointerdown` event) and
 * asserts whether uPlot's native box-zoom clobbers that range.
 */

// ---- Minimal DOM stub: just enough for `new uPlot(...)` to construct, lay
// out, and run a real draw/commit cycle without a browser (mirrors
// uplotChartGuard.test.ts / uplotChartFillHeightResize.test.ts). ----
class FakeElement {}

function makeStyle(): Record<string, string> {
  return new Proxy(
    {},
    { get: () => '', set: () => true },
  ) as unknown as Record<string, string>
}

function makeCanvasCtx(): CanvasRenderingContext2D {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'measureText') return () => ({ width: 10 })
        if (typeof prop === 'string') return () => {}
        return undefined
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D
}

interface FakeEl {
  tagName: string
  style: Record<string, string>
  classList: { add(): void; remove(): void; contains(): boolean; toggle(): void }
  children: FakeEl[]
  childNodes: FakeEl[]
  attributes: Record<string, string>
  _listeners: Record<string, Array<(...a: unknown[]) => void>>
  parentNode: FakeEl | null
  firstChild: FakeEl | null
  [key: string]: unknown
}

function makeEl(tag: string): FakeEl {
  const el: FakeEl = Object.assign(new FakeElement(), {
    tagName: String(tag).toUpperCase(),
    style: makeStyle(),
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    children: [] as FakeEl[],
    childNodes: [] as FakeEl[],
    attributes: {} as Record<string, string>,
    _listeners: {} as Record<string, Array<(...a: unknown[]) => void>>,
    firstChild: null as FakeEl | null,
    parentNode: null as FakeEl | null,
  }) as unknown as FakeEl

  el.appendChild = (child: FakeEl) => {
    el.children.push(child)
    el.childNodes.push(child)
    child.parentNode = el
    return child
  }
  el.insertBefore = (child: FakeEl, ref: FakeEl | null) => {
    const idx = ref ? el.children.indexOf(ref) : -1
    if (idx === -1) {
      el.children.push(child)
      el.childNodes.push(child)
    } else {
      el.children.splice(idx, 0, child)
      el.childNodes.splice(idx, 0, child)
    }
    child.parentNode = el
    return child
  }
  el.removeChild = (child: FakeEl) => {
    el.children = el.children.filter((c) => c !== child)
    el.childNodes = el.childNodes.filter((c) => c !== child)
    return child
  }
  el.querySelector = () => null
  el.querySelectorAll = () => []
  el.cloneNode = () => makeEl(tag)
  el.remove = () => {
    if (el.parentNode) (el.parentNode.removeChild as (c: FakeEl) => FakeEl)(el)
  }
  el.setAttribute = (k: string, v: string) => {
    el.attributes[k] = v
  }
  el.getAttribute = (k: string) => el.attributes[k]
  el.addEventListener = (type: string, fn: (...a: unknown[]) => void) => {
    ;(el._listeners[type] ??= []).push(fn)
  }
  el.removeEventListener = (type: string, fn: (...a: unknown[]) => void) => {
    if (el._listeners[type]) el._listeners[type] = el._listeners[type].filter((f) => f !== fn)
  }
  el.dispatchEvent = () => true
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 260, right: 600, bottom: 260 })
  el.getContext = () => makeCanvasCtx()
  el.contains = () => false
  el.offsetWidth = 600
  el.offsetHeight = 260
  el.clientWidth = 600
  el.clientHeight = 260
  el.width = 600
  el.height = 260

  return el
}

let uPlotCtor: typeof uPlotType

beforeAll(async () => {
  const g = globalThis as Record<string, unknown>
  g.HTMLElement = FakeElement
  g.window = globalThis
  g.devicePixelRatio = 1
  g.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0)
  g.cancelAnimationFrame = (id: number) => clearTimeout(id)
  // `document` itself needs real (tracked) addEventListener/removeEventListener
  // — uPlot attaches its drag-time `mouseup` listener directly to `document`
  // (see mouseDown: `onMouse(mouseup, doc, mouseUp, false)`), and this file's
  // `fire()` helper needs to find it afterwards via `_listeners`.
  const doc = makeEl('document') as unknown as Record<string, unknown>
  doc.createElement = (tag: string) => makeEl(tag)
  doc.createElementNS = (_ns: string, tag: string) => makeEl(tag)
  doc.documentElement = makeEl('html')
  doc.body = makeEl('body')
  g.document = doc
  g.getComputedStyle = () => ({ getPropertyValue: () => '' })
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
  g.dispatchEvent = () => true
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  g.matchMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  })
  g.CustomEvent = class {
    type: string
    constructor(type: string, opts?: Record<string, unknown>) {
      this.type = type
      Object.assign(this, opts)
    }
  }
  g.Path2D = class {
    moveTo() {}
    lineTo() {}
    closePath() {}
    rect() {}
    arc() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
  }

  const mod = await import('uplot')
  uPlotCtor = mod.default
})

let hosts: FakeEl[] = []
afterEach(() => {
  hosts = []
})

function freshHost(): FakeEl {
  const h = makeEl('div')
  hosts.push(h)
  return h
}

const xs = Array.from({ length: 101 }, (_, i) => i) // 0..100
const ys = xs.map((v) => v)
const data = [xs, ys]

/** Fires a real event by invoking every listener the fake element captured
 *  for `type` directly (the fake `dispatchEvent` above is a no-op stub, so
 *  this is how we simulate the browser actually delivering the event) — same
 *  approach as the rest of this file's DOM stub. */
function fire(el: FakeEl, type: string, props: Record<string, unknown>): void {
  const target = (props.target as FakeEl | undefined) ?? el
  const evt = { type, target, button: 0, movementX: 0, movementY: 0, ...props }
  for (const fn of el._listeners[type] ?? []) fn(evt)
}

/** Builds a real uPlot instance with the given `cursor` config (the thing
 *  under test — everything else mirrors buildOptions()'s shape) and returns
 *  it plus its `.over` element (uPlot's real drag-zoom listeners live there). */
function buildPlot(cursor: uPlotType.Cursor): { plot: uPlotType; over: FakeEl } {
  const host = freshHost()
  const plot = new uPlotCtor(
    {
      width: 600,
      height: 260,
      series: [{}, { stroke: 'red' }],
      legend: { show: false },
      scales: { x: { time: false } },
      cursor,
    } as uPlotType.Options,
    data as never,
    host as never,
  )
  return { plot, over: plot.over as unknown as FakeEl }
}

/** Simulates a real mouse drag: mousedown at `downX`, mousemove to `upX`
 *  (nonzero movementX so uPlot's Chrome-stray-mousemove guard doesn't ignore
 *  it), then mouseup — exactly what a real mouse dispatches regardless of
 *  whatever a separate `pointerdown`'s `preventDefault()` did (see this
 *  file's module doc for why that doesn't suppress these for mouse input). */
function simulateMouseDrag(over: FakeEl, downX: number, upX: number): void {
  fire(over, 'mousedown', { clientX: downX, clientY: 50 })
  fire(over, 'mousemove', { clientX: upX, clientY: 50, movementX: upX - downX, movementY: 0 })
  // uPlot attaches its mouseup listener to `document` (not `.over`) once a
  // drag starts (see uPlot's mouseDown: `onMouse(mouseup, doc, mouseUp, false)`).
  const doc = (globalThis as unknown as { document: FakeEl }).document
  fire(doc, 'mouseup', { clientX: upX, clientY: 50 })
}

// uPlot's setScale() never fires/commits synchronously — it stashes the
// requested range and applies it via a queued microtask (see uplotChartGuard
// .test.ts's A13 doc for the full explanation) — so every assertion on
// `plot.scales.x` below needs to wait a tick first.
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 20))
}

describe('UPlotChart centre-needle mode vs uPlot native drag-zoom (B31b)', () => {
  it('BUGGY config (cursor.x/y: false only) — a real mouse drag still runs uPlot\'s own box-zoom and clobbers our pan', async () => {
    const { plot, over } = buildPlot({ focus: { prox: 16 }, x: false, y: false } as uPlotType.Cursor)

    // Stand-in for what this component's own onCentrePointerMove would have
    // just done during the drag: pan the range to [30, 70].
    const ourPanRange = { min: 30, max: 70 }
    plot.setScale('x', ourPanRange)
    await settle()
    expect(plot.scales.x.min).toBe(30)
    expect(plot.scales.x.max).toBe(70)

    // The SAME physical drag also dispatches real mousedown/mousemove/mouseup
    // at uPlot's own `.u-over` listeners (unaffected by any preventDefault()
    // on a separate pointerdown, for real mouse hardware).
    simulateMouseDrag(over, 100, 500)
    await settle()

    // Reproduces the bug: uPlot's own drag-to-zoom overwrote our pan with its
    // own box-zoom result — the range is no longer [30, 70].
    expect(plot.scales.x.min === 30 && plot.scales.x.max === 70).toBe(false)
  })

  it('FIXED config (cursor.drag disabled) — the same mouse drag leaves our pan range untouched', async () => {
    const { plot, over } = buildPlot({
      focus: { prox: 16 },
      x: false,
      y: false,
      drag: { setScale: false, x: false, y: false },
    } as uPlotType.Cursor)

    const ourPanRange = { min: 30, max: 70 }
    plot.setScale('x', ourPanRange)
    await settle()
    expect(plot.scales.x.min).toBe(30)
    expect(plot.scales.x.max).toBe(70)

    simulateMouseDrag(over, 100, 500)
    await settle()

    // uPlot's native drag-zoom is fully neutralized — our pan range survives.
    expect(plot.scales.x.min).toBe(30)
    expect(plot.scales.x.max).toBe(70)
  })
})
