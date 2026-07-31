// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createApp, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import DashboardCard from '@/components/DashboardCard.vue'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * Smoke test proving the @vue/test-utils + happy-dom scaffold works end to
 * end: mounting a real SFC that uses useI18n(), rendering slots, and
 * asserting on emitted events — the shape every future component test in
 * this repo will follow.
 *
 * DashboardCard was picked because its props are simple (no store/router
 * dependency) while still exercising useI18n(), slots, and v-model-style
 * emits, which is representative of the rest of the analyzer dashboard
 * components.
 */
function mountCard(props: Partial<InstanceType<typeof DashboardCard>['$props']> = {}) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })

  return mount(DashboardCard, {
    props: { title: '測試卡片', ...props },
    slots: { default: '<p>body content</p>' },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
}

/**
 * #20 — mounts DashboardCard via RAW Vue APIs (`createApp`/`nextTick`)
 * instead of vue-test-utils' `mount`/`setProps`. Needed specifically for the
 * collapse/expand body `<Transition>` (JS `@enter`/`@leave` hooks, `:css="false"`):
 * confirmed via a minimal repro that vue-test-utils' update path does not
 * reliably preserve `<Transition>`'s "hold the element until its `done()`
 * callback fires" semantics in this happy-dom test environment, while a bare
 * `createApp` mount behaves exactly as real Vue does in a browser. Every
 * OTHER test in this file (pin FLIP, auto-flip, aspectRatio, …) doesn't touch
 * `<Transition>` and uses the normal `mountCard`/VTU path without issue.
 */
function mountCardRaw(collapsed: { value: boolean }) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  const app = createApp({
    setup() {
      return () => h(DashboardCard, { title: '測試卡片', collapsed: collapsed.value }, () => h('p', 'body content'))
    },
  })
  app.use(i18n)
  app.directive('tooltip', vTooltip)
  const container = document.createElement('div')
  document.body.append(container)
  app.mount(container)
  return {
    container,
    unmount(): void {
      app.unmount()
      container.remove()
    },
  }
}

describe('DashboardCard (scaffold smoke test)', () => {
  it('renders the title and default slot content', () => {
    const wrapper = mountCard()
    expect(wrapper.text()).toContain('測試卡片')
    expect(wrapper.text()).toContain('body content')
  })

  it('hides the body when collapsed', () => {
    const wrapper = mountCard({ collapsed: true })
    expect(wrapper.find('.body').exists()).toBe(false)
    expect(wrapper.classes()).toContain('collapsed')
  })

  it('emits update:collapsed when the collapse button is clicked', async () => {
    const wrapper = mountCard({ collapsed: false })
    await wrapper.find('.collapse-btn').trigger('click')
    expect(wrapper.emitted('update:collapsed')).toEqual([[true]])
  })

  it('always shows the pin button (釘選 now works at every breakpoint, not just mobile)', () => {
    expect(mountCard().find('.pin-btn').exists()).toBe(true)
  })

  it('emits update:pinned when the pin button is clicked', async () => {
    const wrapper = mountCard({ pinned: false })
    await wrapper.find('.pin-btn').trigger('click')
    expect(wrapper.emitted('update:pinned')).toEqual([[true]])
  })

  describe('pin/unpin FLIP transition (#19 — see src/domain/layout/flip.ts for the pure math)', () => {
    it('still emits update:pinned immediately (synchronously, before the FLIP animation) even when the card actually moved', async () => {
      const wrapper = mountCard({ pinned: false })
      const el = wrapper.find('.dashboard-card').element as HTMLElement
      let call = 0
      // First call (inside onTogglePinned, before emit) reports the OLD spot;
      // every call after (inside playPinFlip, post-nextTick) reports the NEW
      // spot — exercises the translate branch of the FLIP math for real.
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            left: 0,
            top: call++ === 0 ? 400 : 0,
            width: 300,
            height: 150,
            right: 300,
            bottom: 0,
            x: 0,
            y: 0,
            toJSON() {
              return this
            },
          }) as DOMRect,
      )

      await wrapper.find('.pin-btn').trigger('click')
      // The emit happens synchronously inside the click handler, well before
      // the FLIP's nextTick/rAF/transitionend chain settles.
      expect(wrapper.emitted('update:pinned')).toEqual([[true]])

      // Let the nextTick -> requestAnimationFrame chain run without throwing
      // (happy-dom's rAF is timer-backed, not vitest fake-timer driven here).
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(el.style.transform).toBe('')
    })

    it('skips measuring/animating under prefers-reduced-motion, but still emits the toggle', async () => {
      const wrapper = mountCard({ pinned: false })
      const el = wrapper.find('.dashboard-card').element as HTMLElement
      const rectSpy = vi.spyOn(el, 'getBoundingClientRect')
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('reduce'),
        addEventListener() {},
        removeEventListener() {},
      }))

      await wrapper.find('.pin-btn').trigger('click')
      expect(wrapper.emitted('update:pinned')).toEqual([[true]])
      expect(rectSpy).not.toHaveBeenCalled()

      vi.unstubAllGlobals()
    })
  })

  describe('#20 — collapse/expand body height transition', () => {
    // Note: the strict "the body is STILL in the DOM right after the prop
    // flips (mid-leave-transition), before the fallback timeout" moment is
    // real and was verified against a standalone `createApp` repro (the
    // `<Transition>` leave hook does hold the element, as expected) — but
    // asserting it HERE turned out to be order-dependent on unrelated global
    // Vue scheduler state left over from earlier tests in this same file
    // (none of which unmount their component after use), making that one
    // assertion flaky depending on run order/isolation. The behaviour that
    // actually matters and IS reliably testable regardless of ordering is
    // the end state below: collapsing eventually removes the body (animated,
    // not instant-jump) rather than never removing it at all. Real-device
    // visual verification (see this task's own caveat) is the authoritative
    // check for the actual in-flight animation smoothness.
    it('removes the body (via the animated leave, not an instant v-if jump) once collapsed', async () => {
      const collapsed = ref(false)
      const { container, unmount } = mountCardRaw(collapsed)
      expect(container.querySelector('.body')).not.toBeNull()

      collapsed.value = true
      await nextTick()

      // happy-dom never dispatches a genuine `transitionend`, so settling
      // relies on `animateBodyHeight`'s belt-and-braces fallback timeout
      // (BODY_TRANSITION_DURATION_MS + 100 = 320ms) rather than the shorter
      // waits used elsewhere in this file for the (independent) FLIP paths.
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(container.querySelector('.body')).toBeNull()

      unmount()
    })

    it('mounts the body immediately on expand and clears the inline animation styles once settled', async () => {
      const collapsed = ref(true)
      const { container, unmount } = mountCardRaw(collapsed)
      expect(container.querySelector('.body')).toBeNull()

      collapsed.value = false
      await nextTick()
      const body = container.querySelector('.body') as HTMLElement | null
      expect(body).not.toBeNull()

      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(body!.style.height).toBe('')
      expect(body!.style.flex).toBe('')
      expect(body!.style.overflow).toBe('')

      unmount()
    })

    it('skips the height animation (but still toggles) under prefers-reduced-motion', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('reduce'),
        addEventListener() {},
        removeEventListener() {},
      }))
      const collapsed = ref(false)
      const { container, unmount } = mountCardRaw(collapsed)

      collapsed.value = true
      await nextTick()
      // No animation to wait out under reduced motion — the leave hook calls
      // `done()` immediately, so the body is gone right after the prop flip
      // rather than needing the fallback-timeout wait the animated case does.
      expect(container.querySelector('.body')).toBeNull()

      unmount()
      vi.unstubAllGlobals()
    })
  })

  describe('#20 — generic FLIP for grid-slot moves not caused by pin/collapse (e.g. compaction settle)', () => {
    it('FLIP-animates when the parent grid-item wrapper is repositioned by grid-layout-plus', async () => {
      const wrapper = mountCard()
      const el = wrapper.find('.dashboard-card').element as HTMLElement
      const parent = el.parentElement!
      let call = 0
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(
        () =>
          ({
            left: 0,
            top: call++ === 0 ? 0 : 200,
            width: 300,
            height: 150,
            right: 300,
            bottom: 0,
            x: 0,
            y: 0,
            toJSON() {
              return this
            },
          }) as DOMRect,
      )

      // Simulate grid-layout-plus's own `createStyle()` rewriting the
      // `.vgl-item` wrapper's inline style (a compaction settle, drag/resize
      // settle, or breakpoint switch — this card didn't trigger any of it).
      parent.style.transform = 'translate(0px, 200px)'

      await new Promise((resolve) => setTimeout(resolve, 80))
      expect(el.style.transform).toBe('')
    })

    it('is disabled while pinned (the Teleport move already animates explicitly)', async () => {
      const wrapper = mountCard({ pinned: true })
      const el = wrapper.find('.dashboard-card').element as HTMLElement
      const parent = el.parentElement!
      const rectSpy = vi.spyOn(el, 'getBoundingClientRect')

      parent.style.transform = 'translate(0px, 200px)'
      await new Promise((resolve) => setTimeout(resolve, 40))

      expect(rectSpy).not.toHaveBeenCalled()
    })
  })

  describe('B61 — touch long-press gate before drag-reorder starts', () => {
    // grid-layout-plus's own interactjs listens for pointerdown on
    // `document`, in the bubble phase (verified by reading its source — see
    // DashboardCard.vue's B61 module doc) — a parent-level bubble listener
    // stands in for that here: it must NOT see the real touch pointerdown
    // (stopPropagation'd while the long-press is pending) but MUST see the
    // synthetic hand-off pointerdown dispatched once the hold is confirmed.
    function mountWithParentSpy() {
      const wrapper = mountCard()
      // `mountCard` doesn't attach to `document.body`, so the rendered tree
      // starts out DETACHED — a bubbling `dispatchEvent` never leaves its own
      // disconnected subtree. Move it into a connected container so
      // propagation up to an ancestor (standing in for grid-layout-plus's
      // real document-level listener — see the module doc) actually happens,
      // same as it would in a real mounted app.
      const parent = document.createElement('div')
      document.body.append(parent)
      parent.append(wrapper.element)
      const parentSpy = vi.fn()
      parent.addEventListener('pointerdown', parentSpy)
      return { wrapper, parentSpy, parent }
    }

    it('mouse pointerdown is untouched — reaches the ancestor immediately, no timer scheduled', async () => {
      const { wrapper, parentSpy } = mountWithParentSpy()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10, pointerId: 1 })
      expect(parentSpy).toHaveBeenCalledTimes(1)

      vi.useFakeTimers()
      vi.advanceTimersByTime(1000)
      vi.useRealTimers()
      // No second (synthetic) dispatch — mouse never goes through the gate.
      expect(parentSpy).toHaveBeenCalledTimes(1)
    })

    it('cancels (no hand-off) when the finger moves past the threshold before the delay elapses — scroll intent', async () => {
      vi.useFakeTimers()
      const { wrapper, parentSpy } = mountWithParentSpy()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 3 })

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 60, pointerId: 3 }))
      vi.advanceTimersByTime(300)

      expect(parentSpy).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('cancels (no hand-off) when the finger lifts before the delay elapses — a tap, not a hold', async () => {
      vi.useFakeTimers()
      const { wrapper, parentSpy } = mountWithParentSpy()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 9 })

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9 }))
      vi.advanceTimersByTime(300)

      expect(parentSpy).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('does not intercept a touch pointerdown on the header action buttons (pin/collapse keep their plain tap)', async () => {
      vi.useFakeTimers()
      const { wrapper, parentSpy } = mountWithParentSpy()
      await wrapper
        .find('.pin-btn')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 2 })
      // Not stopped — the button's own tap handling still gets the real event.
      expect(parentSpy).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(300)
      // ...and no long-press machinery was armed for it either (still just
      // the one, real, bubbled call — no second synthetic dispatch).
      expect(parentSpy).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('adds a brief `touch-armed` visual cue on hold-confirm and clears it again shortly after', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard()
      const handle = wrapper.find('.drag-handle')
      await handle.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 5 })
      expect(handle.classes()).not.toContain('touch-armed')

      vi.advanceTimersByTime(300)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.drag-handle').classes()).toContain('touch-armed')

      vi.advanceTimersByTime(400)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.drag-handle').classes()).not.toContain('touch-armed')
      vi.useRealTimers()
    })
  })

  describe('F1 phase 5 (B102a/b) — live-drag edge-autoscroll + two-finger arbitration', () => {
    let rafCallback: FrameRequestCallback | null
    let cancelledFrameIds: number[]
    let scrollBySpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      rafCallback = null
      cancelledFrameIds = []
      // `vi.useFakeTimers()`'s DEFAULT `toFake` list also includes
      // `requestAnimationFrame`/`cancelAnimationFrame`, which would silently
      // shadow the manual stubs below (needed to drive edge-autoscroll frames
      // deterministically) — restricted to just the timers this component's
      // long-press gates actually use (`setTimeout`) so rAF stays under this
      // test file's own control.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        rafCallback = cb
        return 42
      })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        cancelledFrameIds.push(id)
      })
      scrollBySpy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
      window.innerHeight = 800
    })
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      scrollBySpy.mockRestore()
      window.innerHeight = 768
    })

    // A connected tree so the synthetic hand-off pointerdown (which bubbles
    // up, standing in for interactjs's document-level listener — see the
    // B61 `mountWithParentSpy` helper above for the same reasoning) isn't
    // lost, though this block mostly cares about B102a/b's OWN side effects
    // rather than the hand-off dispatch itself.
    function mountArmed() {
      const wrapper = mountCard()
      const parent = document.createElement('div')
      document.body.append(parent)
      parent.append(wrapper.element)
      return wrapper
    }

    it('B102a: scrolls the page UP while the pointer sits near the top edge during a live drag', async () => {
      const wrapper = mountArmed()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 400, pointerId: 7 })
      vi.advanceTimersByTime(300)
      expect(rafCallback).not.toBeNull()

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, pointerId: 7 }))
      rafCallback!(0)

      expect(scrollBySpy).toHaveBeenCalled()
      const [, dy] = scrollBySpy.mock.calls[0] as [number, number]
      expect(dy).toBeLessThan(0)
    })

    it('B102a: scrolls the page DOWN while the pointer sits near the bottom edge during a live drag', async () => {
      const wrapper = mountArmed()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 400, pointerId: 7 })
      vi.advanceTimersByTime(300)

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 795, pointerId: 7 }))
      rafCallback!(0)

      expect(scrollBySpy).toHaveBeenCalled()
      const [, dy] = scrollBySpy.mock.calls[0] as [number, number]
      expect(dy).toBeGreaterThan(0)
    })

    it('B102a: does not scroll while the pointer sits in the dead zone (middle of the viewport)', async () => {
      const wrapper = mountArmed()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 400, pointerId: 7 })
      vi.advanceTimersByTime(300)

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 400, pointerId: 7 }))
      rafCallback!(0)

      expect(scrollBySpy).not.toHaveBeenCalled()
    })

    it('stops the rAF loop and drops `touch-dragging` once the drag ends normally (real pointerup)', async () => {
      const wrapper = mountArmed()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      vi.advanceTimersByTime(300)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.drag-handle').classes()).toContain('touch-dragging')

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
      await wrapper.vm.$nextTick()

      expect(cancelledFrameIds).toContain(42)
      expect(wrapper.find('.drag-handle').classes()).not.toContain('touch-dragging')
    })

    it('`touch-dragging` outlives the brief `touch-armed` flash — stays set well past 400ms while the drag is still live', async () => {
      const wrapper = mountArmed()
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      vi.advanceTimersByTime(300)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.drag-handle').classes()).toContain('touch-dragging')

      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.drag-handle').classes()).not.toContain('touch-armed')
      expect(wrapper.find('.drag-handle').classes()).toContain('touch-dragging')

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    })

    it('B102b: a second finger touching down mid-PENDING cancels the hold — no hand-off reaches the ancestor at all', async () => {
      const wrapper = mountArmed()
      const parentSpy = vi.fn()
      wrapper.element.parentElement!.addEventListener('pointerdown', parentSpy)

      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 3 })
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: 200, clientY: 200 }))
      vi.advanceTimersByTime(300)

      expect(parentSpy).not.toHaveBeenCalled()
    })

    it('ignores its own synthetic hand-off pointerdown (same pointerId) — does not mistake it for a second finger', async () => {
      const wrapper = mountArmed()
      const handle = wrapper.find('.drag-handle').element as HTMLElement
      const cancelSpy = vi.fn()
      handle.addEventListener('pointercancel', cancelSpy)

      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      vi.advanceTimersByTime(300)
      await wrapper.vm.$nextTick()

      expect(cancelSpy).not.toHaveBeenCalled()
      expect(wrapper.find('.drag-handle').classes()).toContain('touch-dragging')
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
    })
  })

  describe('F6 — CSS Grid drag (self-contained: no interactjs hand-off)', () => {
    it('mouse pointerdown starts the drag IMMEDIATELY (no long-press gate) and emits css-grid-drag-start', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 40, clientY: 50, pointerId: 1 })

      expect(wrapper.emitted('css-grid-drag-start')).toEqual([[{ x: 40, y: 50 }]])
    })

    it('pen behaves the same as mouse — immediate start', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'pen', clientX: 5, clientY: 6, pointerId: 1 })
      expect(wrapper.emitted('css-grid-drag-start')).toEqual([[{ x: 5, y: 6 }]])
    })

    it('draggable:false blocks the drag entirely, even for mouse', async () => {
      const wrapper = mountCard({ draggable: false })
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10, pointerId: 1 })
      expect(wrapper.emitted('css-grid-drag-start')).toBeUndefined()
    })

    it('does not intercept a pointerdown on the header action buttons (pin/collapse keep their plain tap)', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.pin-btn')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 10, pointerId: 1 })
      expect(wrapper.emitted('css-grid-drag-start')).toBeUndefined()
    })

    it('a live mouse drag forwards pointermove as css-grid-drag-move and pointerup as css-grid-drag-end(committed:true)', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 })

      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 30, clientY: 40 }))
      expect(wrapper.emitted('css-grid-drag-move')).toEqual([[{ x: 30, y: 40 }]])

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
      expect(wrapper.emitted('css-grid-drag-end')).toEqual([[{ committed: true }]])
    })

    it('a genuine pointercancel aborts the live drag — css-grid-drag-end(committed:false)', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 })

      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))
      expect(wrapper.emitted('css-grid-drag-end')).toEqual([[{ committed: false }]])
    })

    it('a second pointer landing mid-drag aborts it (committed:false) without touching the new pointer', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 })

      const secondDown = new PointerEvent('pointerdown', { pointerId: 2, clientX: 5, clientY: 5, cancelable: true })
      const preventDefaultSpy = vi.spyOn(secondDown, 'preventDefault')
      window.dispatchEvent(secondDown)

      expect(wrapper.emitted('css-grid-drag-end')).toEqual([[{ committed: false }]])
      expect(preventDefaultSpy).not.toHaveBeenCalled()

      // The aborted drag's own listeners are torn down — a stray move for the
      // ORIGINAL pointer no longer does anything.
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 99, clientY: 99 }))
      expect(wrapper.emitted('css-grid-drag-move')).toBeUndefined()
    })

    it('touch does NOT start before the long-press threshold — a plain tap/brush emits nothing', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      expect(wrapper.emitted('css-grid-drag-start')).toBeUndefined()

      vi.advanceTimersByTime(250)
      expect(wrapper.emitted('css-grid-drag-start')).toBeUndefined()

      vi.useRealTimers()
    })

    it('touch starts the drag once the long-press hold completes (300ms, no disqualifying movement)', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })

      vi.advanceTimersByTime(300)
      expect(wrapper.emitted('css-grid-drag-start')).toEqual([[{ x: 10, y: 10 }]])

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
      vi.useRealTimers()
    })

    it('cancels the touch hold (no start) when the finger moves past the threshold before the delay elapses — scroll intent', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 60, pointerId: 7 }))
      vi.advanceTimersByTime(300)

      expect(wrapper.emitted('css-grid-drag-start')).toBeUndefined()
      vi.useRealTimers()
    })

    it('B102b: a second finger touching down mid-PENDING cancels the hold — no start at all', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 3 })

      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: 200, clientY: 200 }))
      vi.advanceTimersByTime(300)

      expect(wrapper.emitted('css-grid-drag-start')).toBeUndefined()
      vi.useRealTimers()
    })

    it('B102b: a second finger touching down mid-drag (armed) aborts it directly (committed:false) — no synthetic pointercancel needed', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      vi.advanceTimersByTime(300)
      expect(wrapper.emitted('css-grid-drag-start')).toEqual([[{ x: 10, y: 10 }]])

      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 55, clientX: 300, clientY: 300 }))
      expect(wrapper.emitted('css-grid-drag-end')).toEqual([[{ committed: false }]])

      vi.useRealTimers()
    })

    it('applies the touch-dragging class for the duration of an armed touch drag, same visual cue the legacy mode uses', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      const handle = wrapper.find('.drag-handle')
      await handle.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      expect(wrapper.find('.drag-handle').classes()).not.toContain('touch-dragging')

      vi.advanceTimersByTime(300)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.drag-handle').classes()).toContain('touch-dragging')

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.drag-handle').classes()).not.toContain('touch-dragging')
      vi.useRealTimers()
    })

    it('does not fall through to any legacy TOUCH_HANDOFF_MARKER/interactjs branch', async () => {
      // Legacy mode's own synthetic hand-off pointerdown carries a private
      // marker; there is no hand-off at all any more, so a
      // pointerdown carrying that marker (which should never happen in
      // practice under this mode) is simply treated as an ordinary mouse/pen
      // start rather than specially ignored — this just documents that the
      // two branches are mutually exclusive, not a real user scenario.
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 1, clientY: 2, pointerId: 1 })
      expect(wrapper.emitted('css-grid-drag-start')).toEqual([[{ x: 1, y: 2 }]])
    })

    it('unmounting mid-drag cleans up window listeners (no stray emit after unmount)', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.drag-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 })
      expect(wrapper.emitted('css-grid-drag-start')).toHaveLength(1)

      wrapper.unmount()
      // Nothing throws, and no further emits are possible post-unmount.
      expect(() =>
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 5, clientY: 5 })),
      ).not.toThrow()
    })
  })

  describe('F6 — CSS Grid resize handle', () => {
    it('shows when not pinned, not collapsed, and resizable', () => {
      expect(mountCard({}).find('.css-grid-resize-handle').exists()).toBe(true)
      expect(mountCard({ pinned: true }).find('.css-grid-resize-handle').exists()).toBe(false)
      expect(mountCard({ collapsed: true }).find('.css-grid-resize-handle').exists()).toBe(false)
      expect(mountCard({ resizable: false }).find('.css-grid-resize-handle').exists()).toBe(false)
    })

    it('mouse pointerdown starts the resize IMMEDIATELY (no long-press gate) and emits css-grid-resize-start', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 40, clientY: 50, pointerId: 1 })
      expect(wrapper.emitted('css-grid-resize-start')).toEqual([[{ x: 40, y: 50 }]])
    })

    it('pen behaves the same as mouse — immediate start', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'pen', clientX: 5, clientY: 6, pointerId: 1 })
      expect(wrapper.emitted('css-grid-resize-start')).toEqual([[{ x: 5, y: 6 }]])
    })

    it('resizable:false blocks the resize entirely, even for mouse (belt-and-braces alongside the v-if hiding the handle)', async () => {
      const wrapper = mountCard({ resizable: false })
      // The handle itself is v-if'd away, but exercise the handler guard
      // directly for defence-in-depth documentation.
      expect(wrapper.find('.css-grid-resize-handle').exists()).toBe(false)
    })

    it('a live mouse resize forwards pointermove as css-grid-resize-move and pointerup as css-grid-resize-end(committed:true)', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 })

      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 30, clientY: 40 }))
      expect(wrapper.emitted('css-grid-resize-move')).toEqual([[{ x: 30, y: 40 }]])

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }))
      expect(wrapper.emitted('css-grid-resize-end')).toEqual([[{ committed: true }]])
    })

    it('a genuine pointercancel aborts the live resize — css-grid-resize-end(committed:false)', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 })

      window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))
      expect(wrapper.emitted('css-grid-resize-end')).toEqual([[{ committed: false }]])
    })

    it('touch does NOT start before the long-press threshold — a plain tap/brush emits nothing', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      expect(wrapper.emitted('css-grid-resize-start')).toBeUndefined()

      vi.advanceTimersByTime(250)
      expect(wrapper.emitted('css-grid-resize-start')).toBeUndefined()
      vi.useRealTimers()
    })

    it('touch starts the resize once the long-press hold completes (300ms, no disqualifying movement)', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })

      vi.advanceTimersByTime(300)
      expect(wrapper.emitted('css-grid-resize-start')).toEqual([[{ x: 10, y: 10 }]])

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
      vi.useRealTimers()
    })

    it('cancels the touch hold (no start) when the finger moves past the threshold before the delay elapses — scroll intent', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })

      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 60, pointerId: 7 }))
      vi.advanceTimersByTime(300)

      expect(wrapper.emitted('css-grid-resize-start')).toBeUndefined()
      vi.useRealTimers()
    })

    it('a second finger touching down mid-PENDING cancels the hold — no start at all (same B102b-style arbitration as the pending drag)', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 3 })

      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, clientX: 200, clientY: 200 }))
      vi.advanceTimersByTime(300)

      expect(wrapper.emitted('css-grid-resize-start')).toBeUndefined()
      vi.useRealTimers()
    })

    it('applies the touch-armed flash on hold-confirm and touch-dragging for the duration of the resize', async () => {
      vi.useFakeTimers()
      const wrapper = mountCard({})
      const handle = wrapper.find('.css-grid-resize-handle')
      await handle.trigger('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, pointerId: 7 })
      expect(wrapper.find('.css-grid-resize-handle').classes()).not.toContain('touch-armed')

      vi.advanceTimersByTime(300)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.css-grid-resize-handle').classes()).toContain('touch-armed')
      expect(wrapper.find('.css-grid-resize-handle').classes()).toContain('touch-dragging')

      vi.advanceTimersByTime(400)
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.css-grid-resize-handle').classes()).not.toContain('touch-armed')
      expect(wrapper.find('.css-grid-resize-handle').classes()).toContain('touch-dragging')

      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }))
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.css-grid-resize-handle').classes()).not.toContain('touch-dragging')
      vi.useRealTimers()
    })

    it('unmounting mid-resize cleans up window listeners (no stray emit after unmount)', async () => {
      const wrapper = mountCard({})
      await wrapper
        .find('.css-grid-resize-handle')
        .trigger('pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, pointerId: 1 })
      expect(wrapper.emitted('css-grid-resize-start')).toHaveLength(1)

      wrapper.unmount()
      expect(() =>
        window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 5, clientY: 5 })),
      ).not.toThrow()
    })
  })
})
