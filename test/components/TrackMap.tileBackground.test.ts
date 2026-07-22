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
 * B54 — the OSM tile background layer wiring in TrackMap.vue: fetches must be
 * debounced to the viewport SETTLING (not fired on every wheel tick), a tile
 * that already loaded must never be re-requested, a tile that failed must
 * never be retried (no retry storm), and the "© OpenStreetMap contributors"
 * attribution must stay visible whenever the osm layer is active. The actual
 * zoom-level-selection / tile-range / LRU-cache / ancestor-placeholder MATH is
 * unit-tested directly in test/analysis/mapTiles.test.ts — these tests only
 * cover how TrackMap.vue wires that math to real fetch scheduling.
 */
let wrapper: VueWrapper | null = null

function makeTrack(n = 5): GpsTrack {
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lat[i] = 35 + i * 0.001
    lon[i] = 135 + i * 0.001
    valid[i] = 1
  }
  return { lat, lon, valid }
}

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
}

function stubContext(drawImageSpy: (...args: unknown[]) => void) {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
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
    drawImage: drawImageSpy,
  }
}

function installMemoryLocalStorage(seed?: Record<string, string>): void {
  let store = new Map<string, string>(Object.entries(seed ?? {}))
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

/** Mounts with the osm background layer already selected (seeded into the
 *  same localStorage key useMapBackground.ts reads on construction), wires a
 *  recording 2D context + fixed canvas size, and forces one real draw. */
async function mountOsmMap(track: GpsTrack, w = 400, h = 300) {
  installMemoryLocalStorage({
    'tracklogstudio.mapBackground.v1': JSON.stringify({
      kind: 'osm',
      imageId: null,
      alignment: { x: 0, y: 0, scale: 1 },
      satelliteApiKey: '',
    }),
  })
  setActivePinia(createPinia())
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  const w0 = mount(TrackMap, {
    props: { track, cursorIdx: null, line: null },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
  wrapper = w0
  const canvas = w0.find('canvas').element as HTMLCanvasElement
  const drawImageCalls: unknown[][] = []
  // @ts-expect-error test stub — happy-dom's canvas has no real 2D context
  canvas.getContext = () => stubContext((...args) => drawImageCalls.push(args))
  Object.defineProperty(canvas, 'clientWidth', { value: w, configurable: true })
  Object.defineProperty(canvas, 'clientHeight', { value: h, configurable: true })
  // Force a real draw with the mocked context wired up (mirrors the pattern
  // used by TrackMap.draw.test.ts).
  await w0.setProps({ track: { ...track } })
  return { wrapper: w0, canvas, drawImageCalls }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  // Flush any pending settle timer before unmount so a stray callback doesn't
  // fire against a torn-down component in a LATER test.
  await vi.runOnlyPendingTimersAsync().catch(() => undefined)
  wrapper?.unmount()
  wrapper = null
  vi.useRealTimers()
})

describe('TrackMap tile background fetching (B54)', () => {
  it('does not request any tile until the viewport settles, not on every wheel tick', async () => {
    const created: FakeImage[] = []
    vi.stubGlobal(
      'Image',
      class extends FakeImage {
        constructor() {
          super()
          created.push(this)
        }
      },
    )

    const track = makeTrack(5)
    await mountOsmMap(track)
    // The initial draw already scheduled a settle timer; nothing fetched yet.
    expect(created.length).toBe(0)

    // Simulate a fast zoom gesture: several wheel ticks close together, each
    // well inside the settle window. test-utils' trigger() assigns arbitrary
    // event properties (deltaY/clientX/clientY) onto a real Event for us.
    for (let i = 0; i < 5; i++) {
      await wrapper!.find('canvas').trigger('wheel', { deltaY: -50, clientX: 200, clientY: 150 })
      await vi.advanceTimersByTimeAsync(50) // well under the 250ms settle window
    }
    expect(created.length).toBe(0)

    // Let the gesture settle.
    await vi.advanceTimersByTimeAsync(400)
    expect(created.length).toBeGreaterThan(0)
    for (const img of created) {
      expect(img.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/)
    }
  })

  it('never re-requests a tile that already loaded successfully', async () => {
    const created: FakeImage[] = []
    vi.stubGlobal(
      'Image',
      class extends FakeImage {
        constructor() {
          super()
          created.push(this)
        }
      },
    )

    const track = makeTrack(5)
    const { wrapper: w0 } = await mountOsmMap(track)
    await vi.advanceTimersByTimeAsync(400)
    expect(created.length).toBeGreaterThan(0)
    const requestedCount = created.length

    // Resolve every in-flight tile successfully.
    for (const img of created) img.onload?.()

    // Redraw several times WITHOUT changing the viewport (e.g. cursor hover
    // redraws) — the settle signature is unchanged, so no new fetch is even
    // scheduled, let alone for already-cached keys.
    await w0.setProps({ cursorIdx: 1 })
    await w0.setProps({ cursorIdx: 2 })
    await vi.advanceTimersByTimeAsync(400)
    expect(created.length).toBe(requestedCount)
  })

  it('never retries a tile that failed to load (no retry storm)', async () => {
    const created: FakeImage[] = []
    vi.stubGlobal(
      'Image',
      class extends FakeImage {
        constructor() {
          super()
          created.push(this)
        }
      },
    )

    const track = makeTrack(5)
    const { wrapper: w0 } = await mountOsmMap(track)
    await vi.advanceTimersByTimeAsync(400)
    expect(created.length).toBeGreaterThan(0)
    const requestedCount = created.length

    // Every tile fails (e.g. transient network error / rate limiting).
    for (const img of created) img.onerror?.()

    // Force several more full redraws of the SAME viewport (simulating the
    // per-frame draw() calls that happen during any ongoing interaction).
    for (let i = 0; i < 10; i++) {
      await w0.setProps({ cursorIdx: i })
      await vi.advanceTimersByTimeAsync(400)
    }
    expect(created.length).toBe(requestedCount)
  })

  it('draws nothing for a still-loading tile, then the normal (non-cropped, 5-arg) drawImage call once it loads', async () => {
    const created: FakeImage[] = []
    vi.stubGlobal(
      'Image',
      class extends FakeImage {
        constructor() {
          super()
          created.push(this)
        }
      },
    )

    const track = makeTrack(5)
    const { wrapper: w0, drawImageCalls } = await mountOsmMap(track)
    await vi.advanceTimersByTimeAsync(400)
    expect(created.length).toBeGreaterThan(0)

    // Before any tile has loaded (and with no cached ancestor to fall back
    // on — this is the very first fetch), the cell is simply left unpainted:
    // no crash, no drawImage call for it at all.
    expect(drawImageCalls.filter((c) => c.length === 5)).toHaveLength(0)

    // Resolve every in-flight tile, then force a redraw of the same viewport
    // (e.g. a hover-driven cursor change) — resolving a load already
    // triggers its own draw() internally, so drawImageCalls should already
    // reflect it, and re-triggering must not duplicate the fetch.
    for (const img of created) img.onload?.()
    await w0.setProps({ cursorIdx: 0 })

    const tileDraws = drawImageCalls.filter((c) => c.length === 5)
    expect(tileDraws.length).toBeGreaterThan(0)
    // 5-arg drawImage(image, dx, dy, dw, dh) — the plain (non-cropped) form
    // used for an exact cache hit, as opposed to the 9-arg cropped form used
    // for an ancestor placeholder.
    for (const call of tileDraws) expect(call).toHaveLength(5)
  })

  it('keeps the OpenStreetMap attribution link visible while the osm layer is active', async () => {
    const track = makeTrack(5)
    await mountOsmMap(track)
    const attribution = wrapper!.find('.osm-attribution')
    expect(attribution.exists()).toBe(true)
    expect(attribution.text()).toContain('OpenStreetMap')
  })
})
