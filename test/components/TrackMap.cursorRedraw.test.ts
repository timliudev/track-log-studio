// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import TrackMap from '@/features/analyzer/TrackMap.vue'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'
import { fitProjection } from '@/features/analyzer/projection'

/**
 * B30 — map→chart cursor forwarding only updated on the first hover point,
 * not continuously. Root cause: `watch(() => props.cursorIdx, () => draw())`
 * ran the FULL redraw pipeline (track polyline, heatmap buckets, highlight/
 * comparison segments, gates, extrema label strokeText/fillText, start/finish
 * band) for cursor-only changes. The interaction canvas now owns the cursor:
 * updates are coalesced to one cheap overlay paint per frame and must never
 * clear or project the static map canvas.
 */
let wrapper: VueWrapper | null = null

function straightTrack(n: number): GpsTrack {
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lat[i] = 35 + i * 0.0001
    lon[i] = 135 + i * 0.0001
    valid[i] = 1
  }
  return { lat, lon, valid }
}

function stubContext(clearRectSpy: () => void) {
  return {
    setTransform: vi.fn(),
    clearRect: clearRectSpy,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setLineDash: vi.fn(),
  }
}

function mountMap(track: GpsTrack) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  wrapper = mount(TrackMap, {
    props: { track, cursorIdx: null, line: null },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
  return wrapper
}

/** B30b — TrackMap now reads `useInputCapabilities()` (for the map-hover hit
 *  radius), which pulls in `useSettingsStore()` (a persisted-to-localStorage
 *  Pinia store); happy-dom doesn't provide a working `localStorage` unless
 *  something stubs it in, so every mount needs both an active Pinia AND this
 *  stub — same pattern used by GearPanel's tests. */
function installMemoryLocalStorage(): void {
  let store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store = new Map<string, string>()
    },
  })
}

beforeEach(() => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('TrackMap cursor overlay redraw coalescing', () => {
  it('collapses several synchronous cursorIdx changes into one overlay paint without redrawing the map', async () => {
    const track = straightTrack(50)
    const w = mountMap(track)
    const canvas = w.find('canvas.track').element as HTMLCanvasElement
    const overlay = w.find('canvas.track-interaction').element as HTMLCanvasElement

    const clearRectSpy = vi.fn()
    const overlayClearRectSpy = vi.fn()
    // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
    canvas.getContext = () => stubContext(clearRectSpy)
    // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
    overlay.getContext = () => stubContext(overlayClearRectSpy)
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(overlay, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(overlay, 'clientHeight', { value: 300, configurable: true })

    // Force one real draw (with the now-mocked context) so px/py are
    // populated, then reset the spy to isolate the cursorIdx-only changes below.
    await w.setProps({ track: { ...track } })
    clearRectSpy.mockClear()
    overlayClearRectSpy.mockClear()

    // Three rapid cursorIdx changes, same as three fast pointermove events —
    // each triggers the cursorIdx watch, but scheduleDraw()'s guard should
    // only let the FIRST one actually queue a frame.
    await w.setProps({ cursorIdx: 1 })
    await w.setProps({ cursorIdx: 2 })
    await w.setProps({ cursorIdx: 3 })
    expect(clearRectSpy).not.toHaveBeenCalled()
    expect(overlayClearRectSpy).not.toHaveBeenCalled()

    // Flush exactly one animation frame — the coalesced draw() should now run,
    // exactly once, reflecting the LATEST cursorIdx (3), not a stale one.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(clearRectSpy).not.toHaveBeenCalled()
    expect(overlayClearRectSpy).toHaveBeenCalledTimes(1)
  })

  it('still redraws again in the NEXT frame for a cursorIdx change that arrives after the previous frame settled', async () => {
    const track = straightTrack(50)
    const w = mountMap(track)
    const canvas = w.find('canvas.track').element as HTMLCanvasElement
    const overlay = w.find('canvas.track-interaction').element as HTMLCanvasElement

    const clearRectSpy = vi.fn()
    const overlayClearRectSpy = vi.fn()
    // @ts-expect-error test stub
    canvas.getContext = () => stubContext(clearRectSpy)
    // @ts-expect-error test stub
    overlay.getContext = () => stubContext(overlayClearRectSpy)
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(overlay, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(overlay, 'clientHeight', { value: 300, configurable: true })
    await w.setProps({ track: { ...track } })
    clearRectSpy.mockClear()
    overlayClearRectSpy.mockClear()

    await w.setProps({ cursorIdx: 1 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(clearRectSpy).not.toHaveBeenCalled()
    expect(overlayClearRectSpy).toHaveBeenCalledTimes(1)

    await w.setProps({ cursorIdx: 2 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(clearRectSpy).not.toHaveBeenCalled()
    expect(overlayClearRectSpy).toHaveBeenCalledTimes(2)
  })
})

describe('TrackMap ⑤/⑥ cursor-marker interpolation (cursorFrac)', () => {
  it('draws the marker at the exact sample when cursorFrac is 0, and glides toward the next sample as cursorFrac rises', async () => {
    const track = straightTrack(50)
    const w = mountMap(track)
    const canvas = w.find('canvas.track').element as HTMLCanvasElement
    const overlay = w.find('canvas.track-interaction').element as HTMLCanvasElement

    const arcSpy = vi.fn()
    // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
    canvas.getContext = () => stubContext(vi.fn())
    // @ts-expect-error test stub
    overlay.getContext = () => ({ ...stubContext(vi.fn()), arc: arcSpy })
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(overlay, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(overlay, 'clientHeight', { value: 300, configurable: true })
    await w.setProps({ track: { ...track } })

    const projection = fitProjection(track, 400, 300, 16)!
    const p10 = projection.toPixel(track.lat[10], track.lon[10])
    const p11 = projection.toPixel(track.lat[11], track.lon[11])

    await w.setProps({ cursorIdx: 10, cursorFrac: 0 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(arcSpy).toHaveBeenCalledTimes(1)
    expect(arcSpy.mock.calls[0][0]).toBeCloseTo(p10.x, 5)
    expect(arcSpy.mock.calls[0][1]).toBeCloseTo(p10.y, 5)

    arcSpy.mockClear()
    // Same cursorIdx, only cursorFrac changes — must still redraw (its own
    // watcher, not piggybacking on the cursorIdx one).
    await w.setProps({ cursorFrac: 0.5 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(arcSpy).toHaveBeenCalledTimes(1)
    expect(arcSpy.mock.calls[0][0]).toBeCloseTo((p10.x + p11.x) / 2, 5)
    expect(arcSpy.mock.calls[0][1]).toBeCloseTo((p10.y + p11.y) / 2, 5)
  })

  it('falls back to the exact sample (frac ignored) when there is no next sample to glide toward', async () => {
    const track = straightTrack(50)
    const w = mountMap(track)
    const canvas = w.find('canvas.track').element as HTMLCanvasElement
    const overlay = w.find('canvas.track-interaction').element as HTMLCanvasElement

    const arcSpy = vi.fn()
    // @ts-expect-error test stub
    canvas.getContext = () => stubContext(vi.fn())
    // @ts-expect-error test stub
    overlay.getContext = () => ({ ...stubContext(vi.fn()), arc: arcSpy })
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(overlay, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(overlay, 'clientHeight', { value: 300, configurable: true })
    await w.setProps({ track: { ...track } })

    const projection = fitProjection(track, 400, 300, 16)!
    const pLast = projection.toPixel(track.lat[49], track.lon[49])

    await w.setProps({ cursorIdx: 49, cursorFrac: 0.9 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(arcSpy).toHaveBeenCalledTimes(1)
    expect(arcSpy.mock.calls[0][0]).toBeCloseTo(pLast.x, 5)
    expect(arcSpy.mock.calls[0][1]).toBeCloseTo(pLast.y, 5)
  })
})

describe('TrackMap overlay-top-right slot', () => {
  it('renders host content passed into #overlay-top-right inside the top-right control row, alongside reset-view', async () => {
    const track = straightTrack(50)
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-Hant',
      fallbackLocale: 'en',
      messages: { 'zh-Hant': zhHant, en },
    })
    wrapper = mount(TrackMap, {
      props: { track, cursorIdx: null, line: null },
      global: { plugins: [i18n], directives: { tooltip: vTooltip } },
      slots: {
        'overlay-top-right': '<button type="button" class="host-play-toggle">▶</button>',
      },
    })

    const row = wrapper.find('.map-controls-tr')
    expect(row.exists()).toBe(true)
    const hostButton = row.find('button.host-play-toggle')
    expect(hostButton.exists()).toBe(true)

    // No reset-view yet (view hasn't been zoomed/panned) — the slot content
    // is the row's only child so far.
    expect(row.find('.reset-view').exists()).toBe(false)

    // Once the view is zoomed (showReset becomes true), reset-view joins the
    // SAME row rather than reclaiming the corner for itself — proving the
    // two controls can never overlap regardless of `showReset`.
    const canvas = wrapper.find('canvas.track').element as HTMLCanvasElement
    const overlay = wrapper.find('canvas.track-interaction').element as HTMLCanvasElement
    // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
    canvas.getContext = () => stubContext(vi.fn())
    // @ts-expect-error test stub
    overlay.getContext = () => stubContext(vi.fn())
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(overlay, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(overlay, 'clientHeight', { value: 300, configurable: true })
    await wrapper.find('canvas.track').trigger('wheel', { deltaY: -100 })

    const rowAfterZoom = wrapper.find('.map-controls-tr')
    expect(rowAfterZoom.find('.reset-view').exists()).toBe(true)
    expect(rowAfterZoom.find('button.host-play-toggle').exists()).toBe(true)
  })
})

describe('TrackMap line drag commit boundary', () => {
  it('previews pointer moves locally and emits only the final line on pointer-up', async () => {
    const track = straightTrack(50)
    const line: LapLine = {
      a: { lat: track.lat[10], lon: track.lon[10] - 0.0005 },
      b: { lat: track.lat[10], lon: track.lon[10] + 0.0005 },
    }
    const w = mountMap(track)
    await w.setProps({ line })
    const canvas = w.find('canvas.track').element as HTMLCanvasElement
    const overlay = w.find('canvas.track-interaction').element as HTMLCanvasElement
    // @ts-expect-error test stub
    canvas.getContext = () => stubContext(vi.fn())
    // @ts-expect-error test stub
    overlay.getContext = () => stubContext(vi.fn())
    for (const element of [canvas, overlay]) {
      Object.defineProperty(element, 'clientWidth', { value: 400, configurable: true })
      Object.defineProperty(element, 'clientHeight', { value: 300, configurable: true })
    }
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    await w.setProps({ track: { ...track } })

    const endpoint = fitProjection(track, 400, 300, 16)!.toPixel(line.a.lat, line.a.lon)
    await w.find('canvas.track').trigger('pointerdown', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: endpoint.x,
      clientY: endpoint.y,
    })
    await w.find('canvas.track').trigger('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: endpoint.x + 20,
      clientY: endpoint.y + 10,
    })
    expect(w.emitted('update:line')).toBeUndefined()

    await w.find('canvas.track').trigger('pointerup', {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: endpoint.x + 20,
      clientY: endpoint.y + 10,
    })
    const updates = w.emitted<LapLine[]>('update:line')
    expect(updates).toHaveLength(1)
    expect(updates?.[0][0].a).not.toEqual(line.a)
    expect(updates?.[0][0].b).toEqual(line.b)
  })

  it('moves a whole sector gate from its numbered midpoint and commits on pointer-up', async () => {
    const track = straightTrack(50)
    const gate: LapLine = {
      a: { lat: track.lat[20] - 0.0005, lon: track.lon[20] },
      b: { lat: track.lat[20] + 0.0005, lon: track.lon[20] },
    }
    const w = mountMap(track)
    await w.setProps({ gates: [{ line: gate, confirmed: true }] })
    const canvas = w.find('canvas.track').element as HTMLCanvasElement
    const overlay = w.find('canvas.track-interaction').element as HTMLCanvasElement
    // @ts-expect-error test stub
    canvas.getContext = () => stubContext(vi.fn())
    // @ts-expect-error test stub
    overlay.getContext = () => stubContext(vi.fn())
    for (const element of [canvas, overlay]) {
      Object.defineProperty(element, 'clientWidth', { value: 400, configurable: true })
      Object.defineProperty(element, 'clientHeight', { value: 300, configurable: true })
    }
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }),
      configurable: true,
    })
    canvas.setPointerCapture = vi.fn()
    canvas.releasePointerCapture = vi.fn()
    await w.setProps({ track: { ...track } })
    const projection = fitProjection(track, 400, 300, 16)!
    const a = projection.toPixel(gate.a.lat, gate.a.lon)
    const b = projection.toPixel(gate.b.lat, gate.b.lon)
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    await w.find('canvas.track').trigger('pointerdown', { pointerId: 2, pointerType: 'mouse', clientX: midpoint.x, clientY: midpoint.y })
    await w.find('canvas.track').trigger('pointermove', { pointerId: 2, pointerType: 'mouse', clientX: midpoint.x + 20, clientY: midpoint.y + 10 })
    expect(w.emitted('update:gate')).toBeUndefined()
    await w.find('canvas.track').trigger('pointerup', { pointerId: 2, pointerType: 'mouse', clientX: midpoint.x + 20, clientY: midpoint.y + 10 })
    const updates = w.emitted<[number, LapLine]>('update:gate')
    expect(updates).toHaveLength(1)
    expect(updates?.[0][0]).toBe(0)
    expect(updates?.[0][1].a).not.toEqual(gate.a)
    expect(updates?.[0][1].b).not.toEqual(gate.b)
  })
})
