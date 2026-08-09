// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * B117 stage 3 — UPlotChart's touch-pan release momentum. A trimmed copy of
 * UPlotChartPointerInteraction.test.ts's own `MockPlot` (same technique:
 * `vi.mock('uplot', ...)`, since a real uPlot instance can't run headless) —
 * kept in its own file rather than added to that one because this suite
 * needs its OWN rAF stub shape: centre-mode xRange changes also schedule an
 * unrelated needle-position `requestAnimationFrame` pair (`scheduleNeedlePos`
 * — pure DOM-geometry measurement, never calls `plot.setScale`), so a
 * single-slot rAF capture (the pattern TrackMap.panMomentum.test.ts uses,
 * where the map has no other rAF consumer) would nondeterministically race
 * against — and get silently overwritten by — that unrelated scheduler.
 * This suite instead uses a MULTI-slot Map-based stub (every
 * `requestAnimationFrame` call gets tracked by its own id;
 * `cancelAnimationFrame` removes it) and asserts on the OBSERABLE BEHAVIOUR
 * that actually matters — whether `plot.setScale` keeps being called after
 * release, via the exact same `panRange`/`panCentreNeedleRange` +
 * `emitXRange` pipeline the live drag already uses — rather than on which
 * anonymous callback happens to occupy a single slot.
 */

interface RectState { left: number; top: number; width: number; height: number }

const mockState = vi.hoisted(() => ({ instances: [] as MockPlot[] }))

class MockPlot {
  data: number[][]
  over: HTMLDivElement
  scales = { x: { min: 0 as number | null, max: 100 as number | null } }
  cursor = { idx: null as number | null }
  rect: RectState = { left: 40, top: 20, width: 560, height: 180 }
  canvasRect: RectState = { left: 0, top: 0, width: 600, height: 260 }
  ctx: { canvas: { getBoundingClientRect(): DOMRect } }
  setScaleCalls: Array<{ min: number; max: number }> = []

  constructor(
    private readonly options: { hooks?: Record<string, Array<(...args: never[]) => void>> },
    data: number[][],
    host: HTMLElement,
  ) {
    this.data = data
    this.over = document.createElement('div')
    this.over.className = 'u-over'
    this.over.getBoundingClientRect = () => ({
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
      x: this.rect.left,
      y: this.rect.top,
      toJSON: () => ({}),
    })
    host.appendChild(this.over)
    this.ctx = {
      canvas: {
        getBoundingClientRect: () => ({
          ...this.canvasRect,
          right: this.canvasRect.left + this.canvasRect.width,
          bottom: this.canvasRect.top + this.canvasRect.height,
          x: this.canvasRect.left,
          y: this.canvasRect.top,
          toJSON: () => ({}),
        }),
      },
    }
    mockState.instances.push(this)
  }

  setScale(_key: string, range: { min: number; max: number }): void {
    if (this.scales.x.min === range.min && this.scales.x.max === range.max) return
    this.scales.x = { ...range }
    this.setScaleCalls.push({ ...range })
    queueMicrotask(() => this.options.hooks?.setScale?.forEach((hook) => hook(this as never, 'x' as never)))
  }

  setCursor(): void {}

  posToVal(pos: number): number {
    const min = this.scales.x.min ?? 0
    const max = this.scales.x.max ?? 100
    return min + (pos / this.rect.width) * (max - min)
  }

  valToPos(value: number): number {
    const min = this.scales.x.min ?? 0
    const max = this.scales.x.max ?? 100
    return ((value - min) / (max - min)) * this.rect.width
  }

  setSize(): void {}
  setData(data: number[][]): void { this.data = data }
  destroy(): void { this.over.remove() }
}

vi.mock('uplot', () => ({ default: MockPlot }))

let wrapper: VueWrapper | null = null
let UPlotChart: typeof import('@/components/UPlotChart.vue')['default']

beforeAll(async () => {
  UPlotChart = (await import('@/components/UPlotChart.vue')).default
})

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
}

function mountChart(): VueWrapper {
  wrapper = mount(UPlotChart, {
    props: {
      data: [[0, 25, 50, 75, 100], [1, 2, 3, 4, 5]],
      series: [{}, { label: 'RPM' }],
      centreCursorMode: true, // touch pan arms immediately (no long-press gate) — see startTouchGesture's allowLongPress
    },
    global: {
      plugins: [
        createPinia(),
        createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } }),
      ],
    },
  })
  const host = wrapper.get('.uplot-host').element as HTMLElement
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 600 })
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 260 })
  return wrapper
}

// Multi-slot rAF stub (see this file's module doc for why single-slot is
// unsafe here): every request gets a unique id and lands in `pending`;
// cancelling removes it. `flushOneFrame` snapshots the CURRENTLY pending
// callbacks, clears them, advances the mocked clock, then runs the snapshot
// — anything newly scheduled DURING that run (e.g. the next momentum frame)
// waits for the NEXT explicit flush, so a test controls exactly one "tick"
// per call.
let pending = new Map<number, FrameRequestCallback>()
let nextRafId = 1
let mockNowMs = 0

beforeEach(() => {
  mockState.instances.length = 0
  mockNowMs = 0
  pending = new Map()
  nextRafId = 1
  vi.stubGlobal('performance', { now: () => mockNowMs })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextRafId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id)
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

function flushOneFrame(deltaMs: number): void {
  mockNowMs += deltaMs
  const snapshot = [...pending.values()]
  pending.clear()
  for (const cb of snapshot) cb(mockNowMs)
}

/** A brisk rightward touch-pan drag inside the plotting area (over rect
 *  left=40, width=560, so clientX 40..600), spaced `stepMs` apart on the
 *  mocked clock. */
async function dragPanRight(w: VueWrapper, steps = 4, stepPx = 20, stepMs = 16): Promise<void> {
  const host = w.get('.uplot-host').element
  let x = 300
  host.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 100 }))
  for (let i = 0; i < steps; i++) {
    mockNowMs += stepMs
    x += stepPx
    host.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 100 }))
  }
  host.dispatchEvent(pointer('pointerup', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 100 }))
  await Promise.resolve() // MockPlot.setScale's hooks fire via queueMicrotask
}

describe('UPlotChart touch-pan-release momentum (B117 stage 3)', () => {
  it('the glide keeps calling setScale (via the SAME panRange/emitXRange pipeline the drag used) after release, moving further in the SAME direction, then stops', async () => {
    const w = mountChart()
    await dragPanRight(w)
    const plot = mockState.instances[0]
    const callsAfterRelease = plot.setScaleCalls.length
    const rangeAfterRelease = plot.setScaleCalls[callsAfterRelease - 1]

    flushOneFrame(16)
    await Promise.resolve()
    expect(plot.setScaleCalls.length).toBeGreaterThan(callsAfterRelease)
    const rangeAfterOneGlideFrame = plot.setScaleCalls[plot.setScaleCalls.length - 1]
    // Content keeps moving in the SAME (rightward-drag) direction: `min`
    // keeps decreasing further, same sign as the live drag's own pan.
    expect(rangeAfterOneGlideFrame.min).toBeLessThan(rangeAfterRelease.min)

    // Run enough frames for the glide to decay below its stop threshold and
    // self-terminate — once stopped, further flushes produce no more calls.
    for (let i = 0; i < 200; i++) flushOneFrame(16)
    await Promise.resolve()
    const callsAfterSettling = plot.setScaleCalls.length
    flushOneFrame(16)
    await Promise.resolve()
    expect(plot.setScaleCalls.length).toBe(callsAfterSettling)
  })

  it('a released-but-barely-moved drag does not start a glide (setScale never called again after release)', async () => {
    const w = mountChart()
    const host = w.get('.uplot-host').element
    host.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 100 }))
    mockNowMs += 500
    host.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 301, clientY: 100 }))
    host.dispatchEvent(pointer('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 301, clientY: 100 }))
    await Promise.resolve()
    const plot = mockState.instances[0]
    const callsAfterRelease = plot.setScaleCalls.length

    flushOneFrame(16)
    await Promise.resolve()
    expect(plot.setScaleCalls.length).toBe(callsAfterRelease)
  })

  it('a new pointerdown mid-glide cancels it — no further glide-driven setScale calls after that point', async () => {
    const w = mountChart()
    await dragPanRight(w)
    const plot = mockState.instances[0]
    flushOneFrame(16) // let the glide get moving
    await Promise.resolve()
    const callsBeforeInterrupt = plot.setScaleCalls.length

    w.get('.uplot-host').element.dispatchEvent(
      pointer('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 350, clientY: 100 }),
    )
    // The interrupting pointerdown alone (no move yet) must not itself call
    // setScale, and flushing further frames must not resume the old glide.
    expect(plot.setScaleCalls.length).toBe(callsBeforeInterrupt)
    flushOneFrame(16)
    await Promise.resolve()
    expect(plot.setScaleCalls.length).toBe(callsBeforeInterrupt)
  })

  it('respects prefers-reduced-motion: no glide-driven setScale call after release', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }))
    const w = mountChart()
    await dragPanRight(w)
    const plot = mockState.instances[0]
    const callsAfterRelease = plot.setScaleCalls.length

    flushOneFrame(16)
    await Promise.resolve()
    expect(plot.setScaleCalls.length).toBe(callsAfterRelease)
  })

  it('cancels an in-flight glide on unmount (no stray callback survives)', async () => {
    const w = mountChart()
    await dragPanRight(w)
    flushOneFrame(16)
    await Promise.resolve()
    expect(pending.size).toBeGreaterThan(0) // momentum's next frame (and/or the needle scheduler) is pending

    w.unmount()
    wrapper = null
    // Nothing throws when running whatever (now-orphaned) callbacks would
    // otherwise still be pending — belt-and-braces, mirrors the existing
    // drag-composable/TrackMap unmount tests' own convention.
    expect(() => flushOneFrame(16)).not.toThrow()
  })
})
