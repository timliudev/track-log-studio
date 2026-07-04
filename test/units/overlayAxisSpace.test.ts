import { describe, it, expect, beforeAll } from 'vitest'
import type uPlotType from 'uplot'
import { formatElapsed } from '@/domain/analysis/axisFormat'

/**
 * #17 regression test — "timeline chart X axis disappears in 疊圈 (overlay)
 * mode" (no ticks/labels, though the axis line/gridlines may still draw).
 *
 * Root cause (see src/features/analyzer/TimeSeriesChart.vue's `axes` computed):
 * the x-axis entry was built as
 *   { scale: 'x', space: xSpace, values: xValuesFmt }
 * where `xSpace = showClock ? 80 : undefined` and `showClock` is only true in
 * TIMELINE mode with the time axis and a resolvable session start anchor. In
 * every other case — which includes OVERLAY mode unconditionally, and
 * timeline+distance mode — `xSpace` evaluates to `undefined`, but the `space`
 * KEY was still always present in the object literal.
 *
 * uPlot merges axis option objects with an `Object.assign`-style helper that
 * iterates `for (let key in src)` — this copies an explicitly-present
 * `space: undefined` property, unlike an actually-absent key (which would
 * leave uPlot's own numeric default, 50, in place). Once `axis.space` is
 * `undefined`, uPlot's `axis.space = fnOrSelf(axis.space)` wraps it as a
 * function that always returns `undefined`. Every tick-increment candidate
 * uPlot tries then fails its `foundSpace >= minSpace` check (any comparison
 * against `undefined` is `false`), so `findIncr` exhausts every candidate and
 * returns `[0, 0]` — the axis's `_space` becomes 0, and uPlot skips computing
 * `_splits`/`_values` for it entirely (see `axesCalc` in uPlot's source):
 * the axis renders with no ticks and no labels.
 *
 * The fix only spreads the `space` key into the axis object when there's an
 * actual override value, so uPlot's own default applies whenever we don't
 * need to widen the tick spacing (overlay mode, and timeline+distance mode).
 *
 * This test exercises the ACTUAL `uplot` package (not a mock) against a
 * minimal DOM stub sufficient for uPlot to construct and run a real draw
 * cycle (same pattern as uplotChartGuard.test.ts's A13 regression test), so it
 * fails against the original `space: xSpace` shape and passes against the
 * fixed conditional-spread shape.
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
  firstChild: { nodeValue: string } | null
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
    // Legend text nodes write via `.firstChild.nodeValue` — give every element
    // a fake text-node child so `legend: { show: true }` doesn't crash.
    firstChild: { nodeValue: '' } as { nodeValue: string } | null,
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

/** Builds a single-channel dataset spanning a realistic ~90s lap, and the
 * series/axes shape TimeSeriesChart.vue produces for the x-axis, given the
 * caller's `xSpaceMode` — mirroring how the component conditionally includes
 * `space` (fixed) or always includes it (the pre-fix bug). */
function buildXAxisEntry(
  xSpaceMode: 'always-present-key' | 'conditional-spread',
): uPlotType.Axis {
  const xValuesFmt = (_u: uPlotType, splits: number[]): string[] => splits.map((v) => formatElapsed(v))
  const xSpace: number | undefined = undefined // showClock = false: overlay mode, or timeline+distance mode

  if (xSpaceMode === 'always-present-key') {
    // The ORIGINAL (buggy) shape: `space` key always present, even when its
    // value is `undefined`.
    return { scale: 'x', space: xSpace, values: xValuesFmt }
  }
  // The FIXED shape: only spread `space` in when there's a real override.
  const spaceOverride = xSpace != null ? { space: xSpace } : {}
  return { scale: 'x', ...spaceOverride, values: xValuesFmt }
}

async function mountAndReadXAxis(xAxisEntry: uPlotType.Axis): Promise<{
  space: number | undefined
  values: string[] | null
}> {
  const N = 600
  const grid = Array.from({ length: N }, (_, i) => i * (90 / (N - 1))) // 0..90s
  const speed = grid.map((_, i) => 50 + 30 * Math.sin(i / 10))
  const data = [grid, speed]
  const series: uPlotType.Series[] = [{ label: 's' }, { label: '#1 · speed', stroke: 'red', scale: 'speed' }]
  const axes: uPlotType.Axis[] = [xAxisEntry, { scale: 'speed', side: 3, label: 'speed' }]

  const host = makeEl('div')
  const plot = new uPlotCtor(
    {
      width: 600,
      height: 260,
      series,
      axes,
      legend: { show: true },
      scales: { x: { time: false } },
      cursor: { focus: { prox: 16 } },
    } as uPlotType.Options,
    data as unknown as uPlotType.AlignedData,
    host as unknown as HTMLDivElement,
  )

  // Let uPlot's async draw/commit cycle (requestAnimationFrame-driven) settle.
  await new Promise((r) => setTimeout(r, 80))

  const axis0 = plot.axes[0] as unknown as { _space: number | undefined; _values: string[] | null }
  plot.destroy()
  return { space: axis0._space, values: axis0._values }
}

describe('TimeSeriesChart overlay X axis (#17)', () => {
  it('BUG: an always-present `space: undefined` key blanks the x-axis ticks/labels', async () => {
    const result = await mountAndReadXAxis(buildXAxisEntry('always-present-key'))
    // Reproduces the reported bug: uPlot gives up on finding a tick increment
    // and never computes any split labels for this axis.
    expect(result.values).toBeNull()
  })

  it('FIX: omitting the `space` key (conditional spread) restores real tick labels', async () => {
    const result = await mountAndReadXAxis(buildXAxisEntry('conditional-spread'))
    expect(result.space).toBe(50) // uPlot's own default, no longer clobbered
    expect(result.values).not.toBeNull()
    expect(result.values).toEqual(
      expect.arrayContaining(['0:00', '0:10', '0:20', '0:30', '0:40', '0:50', '1:00', '1:10', '1:20', '1:30']),
    )
  })
})
