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
 * B117 stage 3 — TrackMap's pan-release momentum. Same mount/stub harness as
 * TrackMap.cursorRedraw.test.ts's pointer-drag tests (pointerdown/move/up
 * trigger sequence, stubbed getContext/getBoundingClientRect/pointer
 * capture) plus a controllable `performance.now()`/`requestAnimationFrame`
 * clock (same convention useCssGridDashboardDrag.test.ts's B117 settle-spring
 * tests already established) — momentum's release-velocity estimate and its
 * glide loop both need a REALISTIC, MANUALLY-ADVANCED clock, not real
 * (sub-millisecond-flaky) wall time.
 *
 * These tests deliberately do NOT reach for TrackMap's internal `panX`/`panY`
 * (not exposed — no `defineExpose`, and shouldn't need one just for this).
 * Instead they use the SAME recording-canvas-context technique
 * TrackMap.draw.test.ts already established: the first `moveTo` call's X
 * coordinate is the track's first point's drawn pixel X, which shifts 1:1
 * with `panX` — comparing that coordinate across "before drag" / "right
 * after release" / "after one glide frame" proves whether content kept
 * moving after the finger lifted, without needing any internal state access.
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

/** Records every `moveTo` call's X coordinate (rounded) in draw order — the
 *  FIRST one in a fresh draw() is the track's first point, which is what we
 *  compare across frames to detect a pan shift. */
function recordingContext(moveToXs: number[]) {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: (x: number) => moveToXs.push(Math.round(x * 1000) / 1000),
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

let rafCallback: FrameRequestCallback | null = null
let rafCancelSpy: ReturnType<typeof vi.fn>
let mockNowMs = 0

beforeEach(() => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
  mockNowMs = 0
  vi.stubGlobal('performance', { now: () => mockNowMs })
  rafCallback = null
  rafCancelSpy = vi.fn(() => {
    rafCallback = null
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallback = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', rafCancelSpy)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

/** Advances the mock clock and fires whatever rAF callback is pending. */
function flushRafAt(ms: number): void {
  mockNowMs = ms
  const cb = rafCallback
  rafCallback = null
  cb?.(ms)
}

const W = 400
const H = 300

async function setupMountedMap(moveToXs: number[]): Promise<VueWrapper> {
  const track = straightTrack(50)
  const w = mountMap(track)
  const canvas = w.find('canvas.track').element as HTMLCanvasElement
  const overlay = w.find('canvas.track-interaction').element as HTMLCanvasElement
  // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
  canvas.getContext = () => recordingContext(moveToXs)
  // @ts-expect-error test stub
  overlay.getContext = () => recordingContext([])
  for (const element of [canvas, overlay]) {
    Object.defineProperty(element, 'clientWidth', { value: W, configurable: true })
    Object.defineProperty(element, 'clientHeight', { value: H, configurable: true })
  }
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  })
  canvas.setPointerCapture = vi.fn()
  canvas.releasePointerCapture = vi.fn()
  await w.setProps({ track: { ...track } }) // trigger the real draw()
  return w
}

/** A brisk rightward pan drag, well clear of any line/gate handle (there are
 *  none — `line`/`gates` are both unset) so it's unambiguously 'pan' mode.
 *  Each pointermove is spaced `stepMs` apart on the mocked clock and moves
 *  `stepPx` further right, building up a real rightward release velocity. */
async function dragPanRight(w: VueWrapper, steps = 4, stepPx = 30, stepMs = 16): Promise<void> {
  const canvas = w.find('canvas.track')
  let x = 200
  const y = 150
  await canvas.trigger('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y })
  for (let i = 0; i < steps; i++) {
    mockNowMs += stepMs
    x += stepPx
    await canvas.trigger('pointermove', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y })
  }
  await canvas.trigger('pointerup', { pointerId: 1, pointerType: 'touch', clientX: x, clientY: y })
}

describe('TrackMap pan-release momentum (B117 stage 3)', () => {
  it('a brisk pan release starts a glide (schedules a rAF frame)', async () => {
    const moveToXs: number[] = []
    const w = await setupMountedMap(moveToXs)
    await dragPanRight(w)
    expect(rafCallback).not.toBeNull()
  })

  it('the glide keeps moving content in the SAME direction after release, then eventually stops', async () => {
    const moveToXs: number[] = []
    const w = await setupMountedMap(moveToXs)
    await dragPanRight(w)

    const afterReleaseX = moveToXs[moveToXs.length - 1]
    expect(rafCallback).not.toBeNull()

    // One glide frame ~16ms later.
    flushRafAt(mockNowMs + 16)
    const afterOneFrameX = moveToXs[moveToXs.length - 1]
    expect(afterOneFrameX).toBeGreaterThan(afterReleaseX) // kept panning rightward

    // Run enough frames (spaced realistically) for the glide to decay below
    // its stop threshold and self-terminate.
    for (let i = 0; i < 200 && rafCallback; i++) {
      flushRafAt(mockNowMs + 16)
    }
    expect(rafCallback).toBeNull()
  })

  it('a released-but-barely-moved drag does not start a glide (below the minimum velocity)', async () => {
    const moveToXs: number[] = []
    const w = await setupMountedMap(moveToXs)
    const canvas = w.find('canvas.track')
    await canvas.trigger('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 150 })
    // A tiny move spread over a long time — negligible velocity.
    mockNowMs += 500
    await canvas.trigger('pointermove', { pointerId: 1, pointerType: 'touch', clientX: 201, clientY: 150 })
    await canvas.trigger('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 201, clientY: 150 })

    expect(rafCallback).toBeNull()
  })

  it('a new pointerdown mid-glide cancels it (interruptible)', async () => {
    const moveToXs: number[] = []
    const w = await setupMountedMap(moveToXs)
    await dragPanRight(w)
    expect(rafCallback).not.toBeNull()

    await w.find('canvas.track').trigger('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 250, clientY: 150 })
    expect(rafCancelSpy).toHaveBeenCalled()
    expect(rafCallback).toBeNull()
  })

  it('respects prefers-reduced-motion: no glide is scheduled at all', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }))
    const moveToXs: number[] = []
    const w = await setupMountedMap(moveToXs)
    await dragPanRight(w)
    expect(rafCallback).toBeNull()
  })

  it('cancels an in-flight glide on unmount', async () => {
    const moveToXs: number[] = []
    const w = await setupMountedMap(moveToXs)
    await dragPanRight(w)
    expect(rafCallback).not.toBeNull()

    w.unmount()
    wrapper = null
    expect(rafCancelSpy).toHaveBeenCalled()
  })
})
