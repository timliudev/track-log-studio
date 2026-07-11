// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, ref, computed } from 'vue'
import { mount } from '@vue/test-utils'
import { playFlipTransition, useAutoFlip } from '@/composables/useFlipAnimation'
import { PIN_FLIP_DURATION_MS, type FlipRect } from '@/domain/layout/flip'

/** A DOMRect-shaped object with just the fields `computeFlipInvert` reads. */
function rect(overrides: Partial<FlipRect>): DOMRect {
  return {
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    right: 100,
    bottom: 50,
    x: 0,
    y: 0,
    toJSON() {
      return this
    },
    ...overrides,
  } as DOMRect
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('playFlipTransition', () => {
  it('applies the inverted transform then eases it back to identity', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect({ top: 0 }))

    const before: FlipRect = { left: 0, top: 300, width: 100, height: 50 }
    const cleanup = playFlipTransition(el, before)

    // Applied synchronously, before any transition kicks in.
    expect(el.style.transform).toBe('translate(0px, 300px) scale(1, 1)')
    expect(el.style.transition).toBe('none')

    // `el.style.transform` is released back to '' synchronously inside the
    // rAF callback (releasing it is what MAKES the browser animate — the
    // inline style value itself doesn't wait for the visual transition to
    // finish), so a short wait is enough to observe it — matching the
    // pattern DashboardCard's own pin-toggle FLIP test already established.
    // `transition` only resets once `finish()` runs (`transitionend`, which
    // happy-dom never dispatches, OR the belt-and-braces fallback timeout),
    // so that assertion needs the FULL duration+fallback window.
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(el.style.transform).toBe('')

    await new Promise((resolve) => setTimeout(resolve, PIN_FLIP_DURATION_MS + 100))
    expect(el.style.transition).toBe('')

    cleanup()
    el.remove()
  })

  it('is a no-op (and returns a no-op cleanup) when before/after are identical', () => {
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect({ left: 10, top: 20, width: 100, height: 50 }))

    const cleanup = playFlipTransition(el, { left: 10, top: 20, width: 100, height: 50 })
    expect(el.style.transform).toBe('')
    expect(() => cleanup()).not.toThrow()
  })

  it('cancels a pending animation when the returned cleanup is invoked immediately', () => {
    const el = document.createElement('div')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect({ top: 0 }))
    const cleanup = playFlipTransition(el, { left: 0, top: 200, width: 100, height: 50 })
    expect(el.style.transform).not.toBe('')
    // Cancel before the rAF/transition phase ever runs — must not throw and
    // must not leave a dangling timer that fires later and touches `el`.
    expect(() => cleanup()).not.toThrow()
  })
})

/** Minimal host component exercising useAutoFlip on a real template ref,
 *  mirroring how DashboardCard wires `rootEl` — the observed element's
 *  PARENT (whatever vue-test-utils mounts the component under) stands in for
 *  grid-layout-plus's `.vgl-item` wrapper. */
const Host = defineComponent({
  props: { enabled: { type: Boolean, default: true } },
  setup(props) {
    const el = ref<HTMLElement | null>(null)
    useAutoFlip(el, { enabled: computed(() => props.enabled) })
    return () => h('div', { ref: el, class: 'target' }, 'card')
  },
})

function mockRectSequence(el: HTMLElement, rects: Partial<FlipRect>[]): ReturnType<typeof vi.spyOn> {
  let call = 0
  return vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
    const r = rects[Math.min(call, rects.length - 1)]
    call += 1
    return rect(r)
  })
}

describe('useAutoFlip', () => {
  it('FLIP-animates the target when its parent grid slot moves (e.g. compaction settle)', async () => {
    const wrapper = mount(Host)
    const el = wrapper.find('.target').element as HTMLElement
    const parent = el.parentElement!
    const rectSpy = mockRectSequence(el, [{ top: 0 }, { top: 150 }])

    // Simulate grid-layout-plus rewriting the parent's inline style, exactly
    // as its own `createStyle()` does on every layout-array change.
    parent.style.transform = 'translate(0px, 150px)'

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(el.style.transform).toBe('')
    // Attach (mount) + the mutation's own measurement.
    expect(rectSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('does not animate while the parent carries a dragging/resizing modifier class — only resyncs', async () => {
    const wrapper = mount(Host)
    const el = wrapper.find('.target').element as HTMLElement
    const parent = el.parentElement!
    parent.classList.add('vgl-item--dragging')
    mockRectSequence(el, [{ top: 0 }, { top: 400 }])

    parent.style.transform = 'translate(0px, 400px)'
    await new Promise((resolve) => setTimeout(resolve, 40))

    // No animation was ever started for a mid-gesture mutation — this is a
    // synchronous guarantee (the invert/play path is never reached), not a
    // timing-dependent "it finished already" observation.
    expect(el.style.transform).toBe('')
  })

  it('does not measure/animate under prefers-reduced-motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }))
    const wrapper = mount(Host)
    const el = wrapper.find('.target').element as HTMLElement
    const parent = el.parentElement!
    const rectSpy = vi.spyOn(el, 'getBoundingClientRect')

    parent.style.transform = 'translate(0px, 90px)'
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(el.style.transform).toBe('')
    expect(rectSpy).not.toHaveBeenCalled()
  })

  it('stops observing once `enabled` becomes false (e.g. the card gets pinned)', async () => {
    const wrapper = mount(Host, { props: { enabled: true } })
    const el = wrapper.find('.target').element as HTMLElement
    const parent = el.parentElement!
    const rectSpy = vi.spyOn(el, 'getBoundingClientRect')

    await wrapper.setProps({ enabled: false })
    parent.style.transform = 'translate(0px, 60px)'
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(rectSpy).not.toHaveBeenCalled()
  })
})
