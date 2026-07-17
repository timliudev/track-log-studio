// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

interface RectState { left: number; top: number; width: number; height: number }

const mockState = vi.hoisted(() => ({ instances: [] as MockPlot[] }))

class MockPlot {
  data: number[][]
  over: HTMLDivElement
  scales = { x: { min: 0 as number | null, max: 100 as number | null } }
  cursor = { idx: null as number | null }
  rect: RectState = { left: 40, top: 20, width: 560, height: 180 }
  setCursorCalls: Array<{ left: number; top: number }> = []
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
    mockState.instances.push(this)
  }

  setScale(_key: string, range: { min: number; max: number }): void {
    if (this.scales.x.min === range.min && this.scales.x.max === range.max) return
    this.scales.x = { ...range }
    this.setScaleCalls.push({ ...range })
    queueMicrotask(() => this.options.hooks?.setScale?.forEach((hook) => hook(this as never, 'x' as never)))
  }

  setCursor(point: { left: number; top: number }): void {
    this.setCursorCalls.push(point)
    const value = this.posToVal(point.left)
    const xs = this.data[0]
    let best = 0
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - value) < Math.abs(xs[best] - value)) best = i
    }
    this.cursor.idx = best
    this.options.hooks?.setCursor?.forEach((hook) => hook(this as never))
  }

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

let resizeCallbacks: ResizeObserverCallback[] = []
let wrapper: VueWrapper | null = null
let UPlotChart: typeof import('@/components/UPlotChart.vue')['default']

beforeAll(async () => {
  UPlotChart = (await import('@/components/UPlotChart.vue')).default
})

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
}

function mountChart(centreCursorMode = false): VueWrapper {
  wrapper = mount(UPlotChart, {
    props: {
      data: [[0, 25, 50, 75, 100], [1, 2, 3, 4, 5]],
      series: [{}, { label: 'RPM' }],
      centreCursorMode,
    },
    global: {
      plugins: [
        createPinia(),
        createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } }),
      ],
    },
  })
  return wrapper
}

beforeEach(() => {
  vi.useFakeTimers()
  mockState.instances.length = 0
  resizeCallbacks = []
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback) }
    observe() {}
    disconnect() {}
  })
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('UPlotChart fixed centre geometry', () => {
  it('emits the centre sample at initial full bounds even when uPlot does not change its scale', async () => {
    const w = mountChart(true)
    await Promise.resolve()

    expect(w.emitted('cursor')).toEqual([[2]])
  })

  it('re-emits from replacement data when its x bounds stay unchanged', async () => {
    const w = mountChart(true)
    await Promise.resolve()
    expect(w.emitted('cursor')).toEqual([[2]])

    await w.setProps({ data: [[0, 60, 100], [1, 2, 3]] })
    await Promise.resolve()

    // The midpoint remains x=50, but its nearest sample is now index 1.
    // MockPlot intentionally suppresses same-range setScale hooks above, so
    // this proves the data-update lifecycle queues its own centre emission.
    expect(w.emitted('cursor')).toEqual([[2], [1]])
  })

  it('does not publish a fixed-centre cursor while centre mode is disabled', async () => {
    const w = mountChart(false)
    await Promise.resolve()

    expect(w.emitted('cursor')).toBeUndefined()
  })

  it('tracks the live plot rectangle after resize and never spans axes/legend', async () => {
    const w = mountChart(true)
    const wrap = w.get('.uplot-wrap').element as HTMLElement
    wrap.getBoundingClientRect = () => rect(100, 50, 700, 300)
    const plot = mockState.instances[0]
    plot.rect = { left: 160, top: 80, width: 600, height: 210 }
    resizeCallbacks[0]([], {} as ResizeObserver)
    await vi.advanceTimersByTimeAsync(0)

    const needle = w.get('.centre-needle')
    expect(needle.attributes('style')).toContain('left: 360px')
    expect(needle.attributes('style')).toContain('top: 30px')
    expect(needle.attributes('style')).toContain('height: 210px')

    plot.rect = { left: 180, top: 90, width: 300, height: 120 }
    resizeCallbacks[0]([], {} as ResizeObserver)
    await vi.advanceTimersByTimeAsync(0)
    expect(needle.attributes('style')).toContain('left: 230px')
    expect(needle.attributes('style')).toContain('top: 40px')
    expect(needle.attributes('style')).toContain('height: 120px')
  })

  it('keeps the centre value correct through wheel zoom and pointer pan', async () => {
    const w = mountChart(true)
    const host = w.get('.uplot-host').element
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -200 })
    host.dispatchEvent(wheel)
    await vi.advanceTimersByTimeAsync(0)

    const zoom = w.emitted('xZoom')?.at(-1)?.[0] as { min: number; max: number }
    expect(wheel.defaultPrevented).toBe(true)
    expect(zoom.max - zoom.min).toBeLessThan(100)
    expect(w.emitted('cursor')?.at(-1)).toEqual([2])

    host.dispatchEvent(pointer('pointerdown', { pointerId: 9, pointerType: 'mouse', clientX: 320, clientY: 100 }))
    host.dispatchEvent(pointer('pointermove', { pointerId: 9, pointerType: 'mouse', clientX: 460, clientY: 100 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(w.emitted('cursor')?.at(-1)).toEqual([1])
  })

  it('preserves two-finger pinch zoom while centre mode is enabled', async () => {
    const w = mountChart(true)
    const host = w.get('.uplot-host').element
    host.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 }))
    host.dispatchEvent(pointer('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 }))
    host.dispatchEvent(pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 450, clientY: 100 }))
    await vi.advanceTimersByTimeAsync(0)
    expect(w.emitted('xZoom')?.length).toBeGreaterThan(0)
  })
})

describe('UPlotChart touch long press', () => {
  it('selects and retains the value at the pressed plot position', async () => {
    const w = mountChart(false)
    const host = w.get('.uplot-host').element
    const down = pointer('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: 320, clientY: 100 })
    host.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)

    await vi.advanceTimersByTimeAsync(450)
    const plot = mockState.instances[0]
    expect(plot.setCursorCalls.at(-1)).toEqual({ left: 280, top: 80 })
    expect(w.emitted('cursor')?.at(-1)).toEqual([2])
    expect(w.get('.uplot-host').classes()).toContain('touch-selecting')
  })

  it('cedes a dominant vertical gesture to native page scroll and cancels selection', async () => {
    const w = mountChart(false)
    const host = w.get('.uplot-host').element
    host.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 }))
    const move = pointer('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 203, clientY: 130 })
    host.dispatchEvent(move)
    expect(move.defaultPrevented).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(mockState.instances[0].setCursorCalls).toHaveLength(0)
  })

  it('cancels long press when a second touch starts and keeps pinch zoom active', async () => {
    const w = mountChart(false)
    const host = w.get('.uplot-host').element
    host.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 }))
    host.dispatchEvent(pointer('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 100 }))
    host.dispatchEvent(pointer('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 450, clientY: 100 }))
    await vi.advanceTimersByTimeAsync(500)

    expect(mockState.instances[0].setCursorCalls).toHaveLength(0)
    expect(w.emitted('xZoom')?.length).toBeGreaterThan(0)
  })
})
