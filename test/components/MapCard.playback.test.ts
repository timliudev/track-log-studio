// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MapCard from '@/features/analyzer/cards/MapCard.vue'
import TrackMap from '@/features/analyzer/TrackMap.vue'
import type { AnalyzerCardContext } from '@/features/analyzer/analyzerCardContext'
import type { Lap } from '@/domain/model/Lap'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * ⑤/⑥ — MapCard's ▶/⏸ playback control. Real px/py/canvas concerns belong to
 * TrackMap's own tests (TrackMap.cursorRedraw.test.ts etc.); this stubs
 * TrackMap out (shallow) and only asserts MapCard's own playback wiring: the
 * button toggles, it advances the shared cursor forward via `ctx.setCursorAt`
 * (never the plain `ctx.setCursor`, which would wrongly zero the glide
 * fraction every frame), a disabled (too-short) domain disables the button,
 * and a NON-playback `setCursor` call is a completely separate path (covered
 * at the store level in test/stores/analyzerStore.test.ts — this only proves
 * MapCard forwards TrackMap's own `@cursor` emit to `ctx.setCursor`, not
 * `setCursorAt`).
 */

function lap(index: number, startIdx: number, endIdx: number): Lap {
  return { index, startIdx, endIdx, lapTimeMs: (endIdx - startIdx) * 10 }
}

// 101 samples, timeMs = 0..1000ms in 10ms steps.
const TIME_MS = new Float64Array(Array.from({ length: 101 }, (_, i) => i * 10))

function makeCtx(overrides: Partial<AnalyzerCardContext> = {}): AnalyzerCardContext {
  const base: Partial<AnalyzerCardContext> = {
    mapMaximized: ref(false),
    track: ref(null),
    cursorIdx: ref(null),
    cursorFrac: ref(0),
    line: ref(null),
    highlightLaps: ref([]),
    comparisonLapHighlights: ref([]),
    focusRange: ref(null),
    colorValues: ref(null),
    trackColormap: ref('viridis' as never),
    mapGates: ref([]),
    allExtremaMarkers: ref([]),
    overlayTracks: ref([]),
    heatNorm: ref(null),
    legendGradient: ref(''),
    trackChannel: ref(null),
    laps: ref([]),
    selectedLaps: ref([]),
    timeMs: ref(TIME_MS),
    xValues: ref(TIME_MS),
    excludedCount: ref(0),
    bandMin: ref(null),
    bandMax: ref(null),
    distBandMin: ref(null),
    distBandMax: ref(null),
    bandExcludedCount: ref(0),
    distBandExcludedCount: ref(0),
    hasLapTimeBand: ref(false),
    hasLapDistanceBand: ref(false),
    setCursor: vi.fn(),
    setCursorAt: vi.fn(),
    setLine: vi.fn(),
    onUpdateGate: vi.fn(),
    setMapMaximized: vi.fn(),
    sessionOffsetOf: vi.fn(() => ({ mapX: 0, mapY: 0 })),
    setComparisonMapOffset: vi.fn(),
    resetSessionOffset: vi.fn(),
    fmtVal: (v: number) => String(v),
    resetLine: vi.fn(),
    onBandInput: vi.fn(),
    clearLapTimeBand: vi.fn(),
    onDistBandInput: vi.fn(),
    clearLapDistanceBand: vi.fn(),
  }
  return { ...base, ...overrides } as AnalyzerCardContext
}

function mountCard(ctx: AnalyzerCardContext): VueWrapper {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(MapCard, {
    props: { ctx },
    global: { plugins: [i18n], stubs: { TrackMap: true } },
  })
}

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('MapCard — playback control', () => {
  it('renders a play button, disabled when the domain has fewer than 2 samples', () => {
    const ctx = makeCtx({ xValues: ref(new Float64Array([1])) })
    wrapper = mountCard(ctx)
    const btn = wrapper.find('button.play-toggle')
    expect(btn.exists()).toBe(true)
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables the button once there is a real playable domain', () => {
    const ctx = makeCtx()
    wrapper = mountCard(ctx)
    const btn = wrapper.find('button.play-toggle')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('clicking play advances the shared cursor via setCursorAt (never plain setCursor), then pause stops it', async () => {
    const ctx = makeCtx()
    wrapper = mountCard(ctx)
    const btn = wrapper.find('button.play-toggle')

    expect(btn.attributes('aria-label')).toBe('播放軌跡')
    await btn.trigger('click')
    expect(btn.attributes('aria-label')).toBe('暫停播放')

    // Let a couple of animation frames elapse — the rAF loop should have
    // stepped the cursor forward at least once by now.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    expect(ctx.setCursorAt).toHaveBeenCalled()
    expect(ctx.setCursor).not.toHaveBeenCalled()
    const [idx, frac] = (ctx.setCursorAt as ReturnType<typeof vi.fn>).mock.calls.at(-1)!
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(frac).toBeGreaterThanOrEqual(0)
    expect(frac).toBeLessThanOrEqual(1)

    const callsAtPause = (ctx.setCursorAt as ReturnType<typeof vi.fn>).mock.calls.length
    await btn.trigger('click')
    expect(btn.attributes('aria-label')).toBe('播放軌跡')
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    // Paused — no further advancement.
    expect((ctx.setCursorAt as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAtPause)
  })

  it('TrackMap receives cursorFrac straight through (so the marker can interpolate)', async () => {
    const ctx = makeCtx({ cursorFrac: ref(0.42) })
    wrapper = mountCard(ctx)
    await nextTick()
    const trackMap = wrapper.findComponent(TrackMap)
    expect(trackMap.props('cursorFrac')).toBe(0.42)
  })

  it('forwards TrackMap\'s own @cursor emit to ctx.setCursor (a plain hover move, not playback)', async () => {
    const ctx = makeCtx()
    wrapper = mountCard(ctx)
    const trackMap = wrapper.findComponent(TrackMap)
    trackMap.vm.$emit('cursor', 7)
    await nextTick()
    expect(ctx.setCursor).toHaveBeenCalledWith(7)
  })

  it('stops playback when the lap selection changes the domain out from under it', async () => {
    const selectedLaps = ref<Lap[]>([])
    const ctx = makeCtx({ selectedLaps })
    wrapper = mountCard(ctx)
    const btn = wrapper.find('button.play-toggle')
    await btn.trigger('click')
    expect(btn.attributes('aria-label')).toBe('暫停播放')

    // A degenerate single-lap selection collapses the domain to null.
    selectedLaps.value = [lap(0, 5, 5)]
    await nextTick()
    expect(btn.attributes('aria-label')).toBe('播放軌跡')
  })
})
