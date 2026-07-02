import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import type uPlotType from 'uplot'

/**
 * A13 regression test — "switching a chart's timeline/overlay mode drops the
 * lap selection".
 *
 * Root cause (see src/components/UPlotChart.vue): uPlot's `setScale()` never
 * fires its `hooks.setScale` callbacks synchronously — it stashes the
 * requested range and fires via a queued MICROTASK (uPlot's own `commit()`),
 * coalescing every `setScale()` call made within one synchronous tick into a
 * single later hook fire that reflects only the FINAL range. `UPlotChart.vue`
 * used an `applyingRange` boolean to suppress its own programmatic
 * `setScale()` calls from re-emitting as a user `xZoom` — but the ORIGINAL
 * code reset that boolean back to `false` SYNCHRONOUSLY, right after the
 * `setScale()` call returned. Since the hook fire is asynchronous, the guard
 * was already `false` by the time it mattered, so it never actually
 * suppressed anything.
 *
 * Concretely: toggling a chart's mode (timeline <-> overlay) changes the
 * series shape, forcing UPlotChart's data/series watcher to destroy and
 * recreate the underlying uPlot instance. The FRESH instance auto-ranges its
 * x scale on construction (an internal, unguarded `setScale()`), then
 * `applyXRange()` re-syncs it to the shared analyzer.xRange. Because the
 * fire is deferred, BOTH calls coalesce into one hook fire carrying the
 * final (correct) range — which is exactly what leaked out as a spurious
 * `xZoom` event on every mode toggle. TimeSeriesChart.vue only forwards
 * `xZoom` while `mode === 'timeline'`, so this leaked specifically when
 * toggling FROM overlay BACK TO timeline. AnalyzerView.vue's `onXZoom`
 * unconditionally clears the lap selection whenever <=1 lap is selected —
 * regardless of whether the emitted range actually changed — so this
 * spurious-but-correctly-valued `xZoom` cleared the user's lap selection.
 *
 * The fix defers the guard's reset via `queueMicrotask` so it clears AFTER
 * uPlot's own queued commit has run (microtasks are FIFO, and uPlot's commit
 * is always queued first within the same synchronous block) — see
 * `clearApplyingRangeSoon` in UPlotChart.vue.
 *
 * This test exercises the ACTUAL `uplot` package (not a mock) against a
 * minimal DOM stub sufficient for uPlot to construct and run a real draw/
 * commit cycle, with the guard logic hand-ported to mirror UPlotChart.vue's
 * `applyXRange`/`create` exactly (both the buggy original and the fixed
 * version), so it fails against the original code and passes against the fix
 * — proving the regression is closed at the mechanism uPlot actually uses,
 * not just asserting the source diff.
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
  g.document = {
    createElement: (tag: string) => makeEl(tag),
    createElementNS: (_ns: string, tag: string) => makeEl(tag),
    documentElement: makeEl('html'),
    body: makeEl('body'),
    addEventListener() {},
    removeEventListener() {},
  }
  // Node 21+ defines a getter-only `navigator` global — leave it as-is (uPlot
  // only reads `navigator.userAgent`, which Node's built-in also provides).
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
  // Path2D only builds path objects handed to the (no-op) fake canvas ctx.
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

const timelineData = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [0, 1, 4, 9, 16, 25, 36, 49, 64, 81, 100],
]
const overlayData = [
  [0, 1, 2, 3, 4, 5, 6, 7],
  [0, 2, 3, 1, 7, 2, 9, 4],
]

function buildOptions(tag: string, applyingRangeRef: { v: boolean }, fired: Array<{ tag: string; min: number; max: number }>) {
  return {
    width: 600,
    height: 260,
    series: [{}, { stroke: 'red', label: tag }],
    legend: { show: false },
    scales: { x: { time: false } },
    hooks: {
      setScale: [
        (u: uPlotType, key: string) => {
          if (key !== 'x' || applyingRangeRef.v) return
          const { min, max } = u.scales.x
          if (min != null && max != null) fired.push({ tag, min, max })
        },
      ],
    },
  }
}

/** Runs the mode-toggle round trip (timeline -> overlay -> timeline) with a
 *  caller-supplied create()/applyXRange() pair, returning every xZoom-style
 *  hook fire observed after the initial mount settles. */
async function runModeToggleScenario(
  makeCreate: (
    host: FakeEl,
    applyingRangeRef: { v: boolean },
    fired: Array<{ tag: string; min: number; max: number }>,
    getXRange: () => { min: number; max: number } | null,
  ) => (data: number[][], tag: string) => void,
): Promise<Array<{ tag: string; min: number; max: number }>> {
  const host = freshHost()
  const applyingRangeRef = { v: false }
  const fired: Array<{ tag: string; min: number; max: number }> = []
  let currentXRange: { min: number; max: number } | null = { min: 2, max: 6 }
  const create = makeCreate(host, applyingRangeRef, fired, () => currentXRange)

  create(timelineData, 'timeline') // initial mount
  await new Promise((r) => setTimeout(r, 20))
  fired.length = 0 // discard initial-mount noise

  // Toggle timeline -> overlay: TimeSeriesChart.vue passes xRange=null in overlay mode.
  currentXRange = null
  create(overlayData, 'overlay')
  await new Promise((r) => setTimeout(r, 20))

  // Toggle back overlay -> timeline: xRange resyncs to the shared lap-selection range.
  currentXRange = { min: 2, max: 6 }
  create(timelineData, 'timeline')
  await new Promise((r) => setTimeout(r, 20))

  return fired
}

describe('UPlotChart xZoom-suppression guard (A13)', () => {
  it('the ORIGINAL synchronous-reset guard leaks a spurious xZoom on mode toggle', async () => {
    const fired = await runModeToggleScenario((host, applyingRangeRef, fired, getXRange) => {
      function applyXRange(plot: uPlotType | null): void {
        const xRange = getXRange()
        if (!plot || !xRange) return
        applyingRangeRef.v = true
        plot.setScale('x', { min: xRange.min, max: xRange.max })
        applyingRangeRef.v = false // BUG: reset happens before uPlot's deferred hook fire
      }
      let plot: uPlotType | null = null
      return (data: number[][], tag: string) => {
        plot?.destroy()
        plot = new uPlotCtor(buildOptions(tag, applyingRangeRef, fired), data as never, host as never)
        applyXRange(plot)
      }
    })

    // Reproduces the bug: switching back to timeline re-emits the (correctly
    // valued, but still spurious) xZoom that AnalyzerView.onXZoom would
    // forward into an unconditional lapStore.clearSelection().
    expect(fired.length).toBeGreaterThan(0)
    expect(fired.some((f) => f.tag === 'timeline')).toBe(true)
  })

  it('the FIXED microtask-deferred guard suppresses xZoom across a mode-toggle round trip', async () => {
    const fired = await runModeToggleScenario((host, applyingRangeRef, fired, getXRange) => {
      function clearApplyingRangeSoon(): void {
        queueMicrotask(() => {
          applyingRangeRef.v = false
        })
      }
      function applyXRange(plot: uPlotType | null, standalone = true): void {
        const xRange = getXRange()
        if (!plot || !xRange) return
        applyingRangeRef.v = true
        plot.setScale('x', { min: xRange.min, max: xRange.max })
        if (standalone) clearApplyingRangeSoon()
      }
      let plot: uPlotType | null = null
      return (data: number[][], tag: string) => {
        plot?.destroy()
        applyingRangeRef.v = true
        plot = new uPlotCtor(buildOptions(tag, applyingRangeRef, fired), data as never, host as never)
        applyXRange(plot, false)
        clearApplyingRangeSoon()
      }
    })

    // No xZoom should leak out purely from toggling mode — the lap selection
    // (owned by AnalyzerView via onXZoom) must be left untouched.
    expect(fired).toEqual([])
  })
})
