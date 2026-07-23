// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MobileScrubber from '@/features/analyzer/MobileScrubber.vue'
import en from '@/i18n/locales/en'
import zhHant from '@/i18n/locales/zh-Hant'

/**
 * F1 phases 3-4 — the Focus Stack's shared bottom scrubber: thumb position is
 * a derived view of the `cursorIdx` prop (bidirectional sync for free),
 * dragging emits `scrub` with a session sample index, and the play button
 * drives an rAF loop that also just emits `scrub`. AnalyzerView (not this
 * component) owns feeding `scrub` into `analyzer.setCursor` — see
 * AnalyzerView.vue's `onScrubberScrub`.
 */

function rect(left: number, width: number): DOMRect {
  return { left, top: 0, width, height: 20, right: left + width, bottom: 20, x: left, y: 0, toJSON: () => ({}) }
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, ...init })
}

// 101 samples, 10ms apart (0..1000ms) — sample i is at t = i*10ms.
const TIME_MS = new Float64Array(Array.from({ length: 101 }, (_, i) => i * 10))

let wrapper: VueWrapper | null = null
let rafCallback: FrameRequestCallback | null = null
let intervalCallback: (() => void) | null = null
let now = 0

function mountScrubber(props: Partial<InstanceType<typeof MobileScrubber>['$props']> = {}) {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, 'zh-Hant': zhHant } })
  wrapper = mount(MobileScrubber, {
    props: {
      domain: { startIdx: 0, endIdx: 100 },
      timeMs: TIME_MS,
      cursorIdx: null,
      ...props,
    },
    global: { plugins: [i18n] },
  })
  const track = wrapper.get('.scrubber-track').element as HTMLElement
  track.getBoundingClientRect = () => rect(0, 200) // 200px wide track at x=0
  return wrapper
}

beforeEach(() => {
  now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallback = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafCallback = null
  })
  vi.stubGlobal('setInterval', (cb: () => void) => {
    intervalCallback = cb
    return 1 as unknown as ReturnType<typeof setInterval>
  })
  vi.stubGlobal('clearInterval', () => {
    intervalCallback = null
  })
  // Default: prefers-reduced-motion NOT set (rAF-driven play). Individual
  // tests override this to exercise the reduced-motion path.
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }))
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  rafCallback = null
  intervalCallback = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MobileScrubber — disabled/degenerate states', () => {
  it('renders disabled with a null domain, without throwing', () => {
    mountScrubber({ domain: null })
    expect(wrapper!.get('.scrubber').classes()).toContain('disabled')
    expect((wrapper!.get('.scrubber-play').element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper!.get('.scrubber-track').attributes('aria-disabled')).toBe('true')
  })

  it('renders disabled with no time axis, without throwing', () => {
    mountScrubber({ timeMs: null })
    expect(wrapper!.get('.scrubber').classes()).toContain('disabled')
  })
})

describe('MobileScrubber — thumb position derives from cursorIdx (bidirectional)', () => {
  it('defaults to the domain start (0%) with no cursor set', () => {
    mountScrubber({ cursorIdx: null })
    expect(wrapper!.get('.scrubber-thumb').attributes('style')).toContain('left: 0%')
  })

  it('reflects an initial cursorIdx as a fraction of the domain', () => {
    mountScrubber({ cursorIdx: 50 }) // mid of [0,100] -> 50%
    expect(wrapper!.get('.scrubber-thumb').attributes('style')).toContain('left: 50%')
  })

  it('tracks external cursor moves (e.g. tapping the map) via a prop update', async () => {
    mountScrubber({ cursorIdx: 0 })
    expect(wrapper!.get('.scrubber-thumb').attributes('style')).toContain('left: 0%')
    await wrapper!.setProps({ cursorIdx: 100 })
    expect(wrapper!.get('.scrubber-thumb').attributes('style')).toContain('left: 100%')
  })

  it('clamps a cursor outside the domain into range', async () => {
    mountScrubber({ domain: { startIdx: 10, endIdx: 40 }, cursorIdx: 999 })
    expect(wrapper!.get('.scrubber-thumb').attributes('style')).toContain('left: 100%')
  })
})

describe('MobileScrubber — drag to scrub', () => {
  it('emits `scrub` with the session sample index under the pointer on pointerdown', () => {
    mountScrubber()
    const track = wrapper!.get('.scrubber-track')
    track.element.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 100 })) // 50% of 200px track
    const emitted = wrapper!.emitted('scrub')
    expect(emitted).toBeTruthy()
    expect(emitted![0]).toEqual([50])
  })

  it('emits further `scrub` events as the pointer moves (window-level listener)', () => {
    mountScrubber()
    const track = wrapper!.get('.scrubber-track')
    track.element.dispatchEvent(pointer('pointerdown', { pointerId: 2, clientX: 0 }))
    window.dispatchEvent(pointer('pointermove', { pointerId: 2, clientX: 200 }))
    const emitted = wrapper!.emitted('scrub') as number[][]
    expect(emitted.at(-1)).toEqual([100])
  })

  it('stops emitting after pointerup', () => {
    mountScrubber()
    const track = wrapper!.get('.scrubber-track')
    track.element.dispatchEvent(pointer('pointerdown', { pointerId: 3, clientX: 0 }))
    window.dispatchEvent(pointer('pointerup', { pointerId: 3, clientX: 0 }))
    const countAfterUp = wrapper!.emitted('scrub')!.length
    window.dispatchEvent(pointer('pointermove', { pointerId: 3, clientX: 200 }))
    expect(wrapper!.emitted('scrub')!.length).toBe(countAfterUp)
  })

  it('does nothing on pointerdown when the domain is null', () => {
    mountScrubber({ domain: null })
    const track = wrapper!.get('.scrubber-track')
    track.element.dispatchEvent(pointer('pointerdown', { pointerId: 4, clientX: 100 }))
    expect(wrapper!.emitted('scrub')).toBeFalsy()
  })
})

describe('MobileScrubber — keyboard step', () => {
  it('ArrowRight/ArrowLeft step by one sample from the current (prop-driven) cursor', async () => {
    // The component doesn't optimistically update its own `cursorIdx` prop
    // (AnalyzerView owns that round-trip via `setCursor`), so both keydowns
    // here step from the same starting cursorIdx=50.
    mountScrubber({ cursorIdx: 50 })
    const track = wrapper!.get('.scrubber-track')
    await track.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper!.emitted('scrub')!.at(-1)).toEqual([51])
    await track.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper!.emitted('scrub')!.at(-1)).toEqual([49])
  })

  it('Home/End jump to the domain bounds', async () => {
    mountScrubber({ cursorIdx: 50 })
    const track = wrapper!.get('.scrubber-track')
    await track.trigger('keydown', { key: 'End' })
    expect(wrapper!.emitted('scrub')!.at(-1)).toEqual([100])
    await track.trigger('keydown', { key: 'Home' })
    expect(wrapper!.emitted('scrub')!.at(-1)).toEqual([0])
  })
})

describe('MobileScrubber — play / auto-advance', () => {
  it('toggles aria-label and starts an rAF loop on click', async () => {
    mountScrubber({ cursorIdx: 0 })
    const playButton = wrapper!.get('.scrubber-play')
    expect(playButton.attributes('aria-label')).toBe('Play')
    await playButton.trigger('click')
    expect(playButton.attributes('aria-label')).toBe('Pause')
    expect(rafCallback).not.toBeNull()
  })

  it('advances the cursor by real time deltas across frames and emits scrub', async () => {
    mountScrubber({ cursorIdx: 0 })
    await wrapper!.get('.scrubber-play').trigger('click')
    const cb = rafCallback!
    now = 200 // +200ms real time at 1x -> t=200ms -> index 20
    cb(now)
    const emitted = wrapper!.emitted('scrub') as number[][]
    expect(emitted.at(-1)).toEqual([20])
  })

  it('stops automatically at the domain end', async () => {
    mountScrubber({ domain: { startIdx: 90, endIdx: 100 }, cursorIdx: 90 })
    await wrapper!.get('.scrubber-play').trigger('click')
    const cb = rafCallback!
    now = 10_000 // way past the end
    cb(now)
    await wrapper!.vm.$nextTick()
    expect(wrapper!.get('.scrubber-play').attributes('aria-label')).toBe('Play')
    expect(rafCallback).toBeNull()
  })

  it('pausing cancels the rAF loop', async () => {
    mountScrubber({ cursorIdx: 0 })
    const playButton = wrapper!.get('.scrubber-play')
    await playButton.trigger('click')
    expect(rafCallback).not.toBeNull()
    await playButton.trigger('click')
    expect(playButton.attributes('aria-label')).toBe('Play')
    expect(rafCallback).toBeNull()
  })

  it('stops playback when the domain changes (e.g. a different lap selected)', async () => {
    mountScrubber({ cursorIdx: 0 })
    await wrapper!.get('.scrubber-play').trigger('click')
    expect(rafCallback).not.toBeNull()
    await wrapper!.setProps({ domain: { startIdx: 0, endIdx: 50 } })
    expect(wrapper!.get('.scrubber-play').attributes('aria-label')).toBe('Play')
  })

  it('is disabled (no play) when the domain is null', () => {
    mountScrubber({ domain: null })
    expect((wrapper!.get('.scrubber-play').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('under prefers-reduced-motion, plays via a fixed-interval step instead of rAF', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }))
    mountScrubber({ cursorIdx: 0 })
    await wrapper!.get('.scrubber-play').trigger('click')
    expect(rafCallback).toBeNull()
    expect(intervalCallback).not.toBeNull()
    intervalCallback!()
    const emitted = wrapper!.emitted('scrub') as number[][]
    // REDUCED_MOTION_STEP_MS = 250ms -> t=250ms -> nearest non-overshooting sample = 25.
    expect(emitted.at(-1)).toEqual([25])
  })

  it('unmounting mid-play cancels the loop cleanly (no thrown error, no further emits)', async () => {
    mountScrubber({ cursorIdx: 0 })
    await wrapper!.get('.scrubber-play').trigger('click')
    expect(() => wrapper!.unmount()).not.toThrow()
    wrapper = null
  })
})
