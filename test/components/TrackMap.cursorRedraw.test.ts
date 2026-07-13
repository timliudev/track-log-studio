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

/**
 * B30 — map→chart cursor forwarding only updated on the first hover point,
 * not continuously. Root cause: `watch(() => props.cursorIdx, () => draw())`
 * ran the FULL redraw pipeline (track polyline, heatmap buckets, highlight/
 * comparison segments, gates, extrema label strokeText/fillText, start/finish
 * band) synchronously on every single hover-driven cursorIdx change — i.e. on
 * every pointermove pixel, since map→chart forwarding emits a new cursorIdx
 * on every mousemove. On a real multi-lap/heatmap track this floods the main
 * thread with more (expensive) draw() calls than it can keep up with,
 * eventually starving/coalescing the browser's own pointer-event delivery —
 * the map cursor appears to freeze near the first hover point while the
 * backlog can't catch up. Fixed by coalescing cursorIdx-driven redraws to at
 * most one `draw()` per animation frame (`scheduleDraw()` in TrackMap.vue),
 * always reading the LATEST cursorIdx when it finally runs.
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

describe('TrackMap cursorIdx-driven redraw coalescing (B30)', () => {
  it('collapses several synchronous cursorIdx changes into exactly one draw() per animation frame', async () => {
    const track = straightTrack(50)
    const w = mountMap(track)
    const canvas = w.find('canvas').element as HTMLCanvasElement

    const clearRectSpy = vi.fn()
    // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
    canvas.getContext = () => stubContext(clearRectSpy)
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })

    // Force one real draw (with the now-mocked context) so px/py are
    // populated, then reset the spy to isolate the cursorIdx-only changes below.
    await w.setProps({ track: { ...track } })
    clearRectSpy.mockClear()

    // Three rapid cursorIdx changes, same as three fast pointermove events —
    // each triggers the cursorIdx watch, but scheduleDraw()'s guard should
    // only let the FIRST one actually queue a frame.
    await w.setProps({ cursorIdx: 1 })
    await w.setProps({ cursorIdx: 2 })
    await w.setProps({ cursorIdx: 3 })
    expect(clearRectSpy).not.toHaveBeenCalled()

    // Flush exactly one animation frame — the coalesced draw() should now run,
    // exactly once, reflecting the LATEST cursorIdx (3), not a stale one.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(clearRectSpy).toHaveBeenCalledTimes(1)
  })

  it('still redraws again in the NEXT frame for a cursorIdx change that arrives after the previous frame settled', async () => {
    const track = straightTrack(50)
    const w = mountMap(track)
    const canvas = w.find('canvas').element as HTMLCanvasElement

    const clearRectSpy = vi.fn()
    // @ts-expect-error test stub
    canvas.getContext = () => stubContext(clearRectSpy)
    Object.defineProperty(canvas, 'clientWidth', { value: 400, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 300, configurable: true })
    await w.setProps({ track: { ...track } })
    clearRectSpy.mockClear()

    await w.setProps({ cursorIdx: 1 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(clearRectSpy).toHaveBeenCalledTimes(1)

    await w.setProps({ cursorIdx: 2 })
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(clearRectSpy).toHaveBeenCalledTimes(2)
  })
})
