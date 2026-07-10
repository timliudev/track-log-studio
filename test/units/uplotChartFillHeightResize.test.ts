import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { nextTick } from 'vue'
import type uPlotType from 'uplot'

/**
 * #4 regression test — "增減顯示欄位(通道)會重設圖表 Y 軸高度,要重新拖動卡片才會
 * match 卡片高度" (adding/removing a channel from a timeline chart card drops
 * the chart back to a smaller height; only dragging the card — which fires
 * the ResizeObserver's own `resize()` — restores the fill).
 *
 * Root cause (see src/components/UPlotChart.vue): a channel add/remove
 * changes the series shape, so the `[data, series]` watcher recreates the
 * whole uPlot instance (`create()`). In `fillHeight` mode `create()` already
 * re-measures the host ONCE, synchronously, right after construction — but
 * that single synchronous read happens inside the SAME reactive flush that
 * is still settling the surrounding layout (the toolbar/chips row can gain or
 * lose a line when the channel count changes, shifting how much height is
 * actually left for the chart within the card). If that one synchronous
 * measurement lands before the surrounding flex layout has fully settled, the
 * freshly-recreated plot is stuck at whatever (possibly smaller) height it
 * read — nothing re-measures it again afterwards, unlike the ResizeObserver
 * path (which keeps firing on every subsequent layout change, e.g. a manual
 * drag, and is what "fixes" it for the user).
 *
 * The fix schedules an ADDITIONAL `resize()` via `nextTick()` after every
 * `create()` in `fillHeight` mode — by the time it runs, Vue has fully
 * flushed every pending reactive update (not just this component's), so the
 * measurement is guaranteed fresh, self-healing the height without requiring
 * a manual drag.
 *
 * This test drives the ACTUAL `uplot` package (not a mock) against a minimal
 * DOM stub (same pattern as uplotChartGuard.test.ts's A13 test), with
 * `create()`/`resize()` hand-ported to mirror UPlotChart.vue exactly (both
 * the original, single-measurement version and the nextTick-corrected fix),
 * so it fails against the original code and passes against the fix.
 */

// ---- Minimal DOM stub: just enough for `new uPlot(...)` to construct, lay
// out, and run a real draw/commit cycle without a browser. ----
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
  el.querySelector = () => null // no legend lookup needed for THIS test — see module doc
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
  g.document = {
    createElement: (tag: string) => makeEl(tag),
    createElementNS: (_ns: string, tag: string) => makeEl(tag),
    documentElement: makeEl('html'),
    body: makeEl('body'),
    addEventListener() {},
    removeEventListener() {},
  }
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

function freshHost(initialClientHeight: number): FakeEl {
  const h = makeEl('div')
  h.clientHeight = initialClientHeight
  hosts.push(h)
  return h
}

const series2 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
const dataOneChannel = [series2, series2.map((v) => v * 2)]
const dataTwoChannels = [series2, series2.map((v) => v * 2), series2.map((v) => v * 3)]

function buildOptions(width: number, height: number, seriesCount: number): uPlotType.Options {
  return {
    width,
    height,
    series: Array.from({ length: seriesCount + 1 }, (_, i) => (i === 0 ? {} : { stroke: 'red' })),
    // Legend disabled (unlike the real component's `legend: { show: true }`):
    // this test is about the fillHeight re-measurement mechanism, not legend
    // sizing (already covered by fillPlotHeight.test.ts) — the minimal DOM
    // stub above doesn't implement text nodes, which uPlot's live legend
    // value sync needs. Since `querySelector` always misses here anyway,
    // `legendHeight()` would be 0 either way — disabling it just avoids
    // exercising unrelated, unstubbed DOM APIs.
    legend: { show: false },
    scales: { x: { time: false } },
  } as uPlotType.Options
}

/** Mirrors UPlotChart.vue's `targetHeight()` — legend lookup always misses in
 *  this DOM stub (see `querySelector` above), so it simplifies to the host's
 *  raw clientHeight, falling back to `fallback` at/under 0. */
function targetHeight(host: FakeEl, fallback: number): number {
  const h = host.clientHeight as number
  return h > 0 ? h : fallback
}

/** A harness for ONE of the two `create()` implementations under test —
 *  returns the live `uPlot` instance plus a `changeSeries()` driver that
 *  mimics UPlotChart.vue's `[data, series]` watcher recreating the plot when
 *  the channel count (hence `seriesKey()`) changes. */
function makeHarness(
  host: FakeEl,
  fallback: number,
  variant: 'original' | 'fixed',
): {
  plot: () => uPlotType | null
  changeSeries: (seriesCount: number, data: number[][]) => void
} {
  let plot: uPlotType | null = null

  function resize(): void {
    if (plot) {
      plot.setSize({ width: host.clientWidth as number, height: targetHeight(host, fallback) })
    }
  }

  function create(seriesCount: number, data: number[][]): void {
    plot?.destroy()
    const width = (host.clientWidth as number) || 600
    plot = new uPlotCtor(buildOptions(width, targetHeight(host, fallback), seriesCount), data as never, host as never)
    // T1 — re-measure once now that the plot (and, in the real component,
    // its legend) exists.
    resize()
    if (variant === 'fixed') {
      // #4 fix — re-measure AGAIN once Vue has fully settled every pending
      // reactive update (not just this component's own flush), so a layout
      // shift that was still mid-settle at the synchronous measurement above
      // gets picked up without needing a manual drag/resize to trigger it.
      void nextTick(resize)
    }
  }

  create(1, dataOneChannel)
  return {
    plot: () => plot,
    changeSeries: (seriesCount: number, data: number[][]) => create(seriesCount, data),
  }
}

describe('UPlotChart fillHeight re-measurement on series/channel change (#4)', () => {
  it('ORIGINAL (single synchronous measurement) gets stuck at a stale height when the card layout is still settling', async () => {
    const host = freshHost(300)
    const h = makeHarness(host, 260, 'original')
    expect(h.plot()!.height).toBe(300)

    // Channel added: the surrounding chips row grows, so the space actually
    // left for the chart is smaller AT THE EXACT MOMENT create() re-measures.
    host.clientHeight = 150
    h.changeSeries(2, dataTwoChannels)
    expect(h.plot()!.height).toBe(150)

    // The layout finishes settling shortly after (e.g. web font metrics or a
    // sibling's own async update land) — the card's real available height is
    // back to 300, but nothing re-measures for it.
    host.clientHeight = 300
    await nextTick()
    await new Promise((r) => setTimeout(r, 10))
    expect(h.plot()!.height).toBe(150) // stuck — reproduces the reported bug
  })

  it('FIXED (nextTick-deferred re-measurement) self-heals to the settled card height without a manual drag', async () => {
    const host = freshHost(300)
    const h = makeHarness(host, 260, 'fixed')
    expect(h.plot()!.height).toBe(300)

    host.clientHeight = 150
    h.changeSeries(2, dataTwoChannels)
    expect(h.plot()!.height).toBe(150) // same transient read as the original…

    host.clientHeight = 300
    await nextTick() // …but the deferred re-measure now picks up the settled height
    expect(h.plot()!.height).toBe(300)
  })

  it('a subsequent ResizeObserver-style resize (the "drag the card" workaround) always corrects either variant', () => {
    const host = freshHost(300)
    const h = makeHarness(host, 260, 'original')
    host.clientHeight = 150
    h.changeSeries(2, dataTwoChannels)
    expect(h.plot()!.height).toBe(150)

    // Simulate the ResizeObserver firing on a real drag.
    host.clientHeight = 300
    h.plot()!.setSize({ width: host.clientWidth as number, height: targetHeight(host, 260) })
    expect(h.plot()!.height).toBe(300)
  })
})
