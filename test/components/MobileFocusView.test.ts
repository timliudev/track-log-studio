// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { shallowMount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MobileFocusView from '@/features/analyzer/MobileFocusView.vue'
import AnalyzerCardBody from '@/features/analyzer/AnalyzerCardBody.vue'
import type { AnalyzerCardContext } from '@/features/analyzer/analyzerCardContext'
import en from '@/i18n/locales/en'
import zhHant from '@/i18n/locales/zh-Hant'

/**
 * F5 phase 1 — the single-focus view renders a top tab bar for the visible id
 * set plus exactly ONE active card body (unlike F1's retired MobileFocusStack,
 * which rendered every id at once). shallowMount stubs AnalyzerCardBody
 * (already covered on its own, see AnalyzerCardBody.test.ts) so this only
 * asserts MobileFocusView's own routing/emit behaviour.
 */
function mountView(ids: string[], currentViewId = '', ctxOverrides: Record<string, unknown> = {}) {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, 'zh-Hant': zhHant },
  })
  return shallowMount(MobileFocusView, {
    props: {
      ids,
      ctx: ctxOverrides as unknown as AnalyzerCardContext,
      titleFor: (id: string) => `title:${id}`,
      currentViewId,
    },
    global: { plugins: [i18n] },
  })
}

describe('MobileFocusView', () => {
  it('renders one tab per id, in order, with its title', () => {
    const wrapper = mountView(['map', 'chart-1', 'gear'], 'map')
    const tabs = wrapper.findAll('.focus-tab')
    expect(tabs).toHaveLength(3)
    expect(tabs.map((t) => t.text())).toEqual(['title:map', 'title:chart-1', 'title:gear'])
  })

  it('renders exactly ONE active card body, matching currentViewId', () => {
    const wrapper = mountView(['map', 'chart-1', 'gear'], 'chart-1')
    const bodies = wrapper.findAllComponents(AnalyzerCardBody)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].props('id')).toBe('chart-1')
  })

  it('marks the tab matching currentViewId as active', () => {
    const wrapper = mountView(['map', 'chart-1'], 'chart-1')
    const tabs = wrapper.findAll('.focus-tab')
    expect(tabs[0].classes()).not.toContain('active')
    expect(tabs[1].classes()).toContain('active')
    expect(tabs[1].attributes('aria-selected')).toBe('true')
  })

  it('emits `select` with the tapped id when a tab is clicked', async () => {
    const wrapper = mountView(['map', 'chart-1'], 'map')
    await wrapper.findAll('.focus-tab')[1].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['chart-1']])
  })

  it('emits `select` even for a re-tap of the already-active tab', async () => {
    const wrapper = mountView(['map', 'chart-1'], 'map')
    await wrapper.findAll('.focus-tab')[0].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['map']])
  })

  it('falls back to the first id when currentViewId is empty', () => {
    const wrapper = mountView(['map', 'chart-1'], '')
    const bodies = wrapper.findAllComponents(AnalyzerCardBody)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].props('id')).toBe('map')
    expect(wrapper.findAll('.focus-tab')[0].classes()).toContain('active')
  })

  it('falls back to the first id when currentViewId is stale (not in ids)', () => {
    const wrapper = mountView(['map', 'chart-1'], 'chart-9-removed')
    const bodies = wrapper.findAllComponents(AnalyzerCardBody)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].props('id')).toBe('map')
    expect(wrapper.findAll('.focus-tab')[0].classes()).toContain('active')
  })

  it('renders no tabs and no body for an empty id list', () => {
    const wrapper = mountView([], '')
    expect(wrapper.findAll('.focus-tab')).toHaveLength(0)
    expect(wrapper.findComponent(AnalyzerCardBody).exists()).toBe(false)
  })
})

/**
 * F5 phase 2 — swipe-to-switch, opt-in per active id via
 * `consumesHorizontalDrag` (`@/domain/layout/horizontalGestureCards`). All
 * sequences below use `pointerType: 'touch'` and a shared `pointerId` across
 * down/move/up, mirroring the real gesture the component implements (see its
 * module doc): pointerdown arms tracking, pointermove resolves horizontal-vs-
 * vertical past a small slop, pointerup measures net travel against the
 * trigger threshold and decides whether to emit.
 */
describe('MobileFocusView — swipe-to-switch (F5 phase 2)', () => {
  const POINTER_ID = 7

  function swipe(
    wrapper: ReturnType<typeof mountView>,
    { downX, downY, moveX, moveY, upX, upY }: { downX: number; downY: number; moveX: number; moveY: number; upX: number; upY: number },
  ): Promise<unknown> {
    const body = wrapper.find('.focus-view-body')
    return (async () => {
      await body.trigger('pointerdown', { pointerType: 'touch', pointerId: POINTER_ID, clientX: downX, clientY: downY })
      await body.trigger('pointermove', { pointerType: 'touch', pointerId: POINTER_ID, clientX: moveX, clientY: moveY })
      await body.trigger('pointerup', { pointerType: 'touch', pointerId: POINTER_ID, clientX: upX, clientY: upY })
    })()
  }

  it('a horizontal swipe (finger moves left) on a swipe-enabled view emits `select` with the NEXT id', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    await swipe(wrapper, { downX: 300, downY: 200, moveX: 220, moveY: 202, upX: 200, upY: 202 })
    expect(wrapper.emitted('select')).toEqual([['laptable']])
  })

  it('a horizontal swipe (finger moves right) on a swipe-enabled view emits `select` with the PREVIOUS id', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'laptable')
    await swipe(wrapper, { downX: 100, downY: 200, moveX: 180, moveY: 198, upX: 200, upY: 198 })
    expect(wrapper.emitted('select')).toEqual([['gear']])
  })

  it('the SAME swipe on a map view emits NOTHING — the map owns horizontal drag', async () => {
    const wrapper = mountView(['map', 'gear'], 'map')
    await swipe(wrapper, { downX: 300, downY: 200, moveX: 220, moveY: 202, upX: 200, upY: 202 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('the SAME swipe on a chart view emits NOTHING — the chart owns horizontal drag', async () => {
    const wrapper = mountView(['chart-1', 'gear'], 'chart-1')
    await swipe(wrapper, { downX: 300, downY: 200, moveX: 220, moveY: 202, upX: 200, upY: 202 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('a mostly-vertical drag emits nothing, even past the horizontal trigger distance', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    // dy (120) dominates dx (10) well past the slop -> resolved as 'scroll',
    // tracking stops; the eventual net dx at pointerup is irrelevant.
    await swipe(wrapper, { downX: 300, downY: 200, moveX: 290, moveY: 320, upX: 150, upY: 320 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('swiping past the LAST tab is a no-op (v1: no wrap-around)', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'laptable')
    await swipe(wrapper, { downX: 300, downY: 200, moveX: 220, moveY: 202, upX: 200, upY: 202 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('swiping past the FIRST tab is a no-op (v1: no wrap-around)', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    await swipe(wrapper, { downX: 100, downY: 200, moveX: 180, moveY: 198, upX: 200, upY: 198 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('a mouse drag over the same distance never switches views — swipe is touch-only', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    const body = wrapper.find('.focus-view-body')
    await body.trigger('pointerdown', { pointerType: 'mouse', pointerId: POINTER_ID, clientX: 300, clientY: 200 })
    await body.trigger('pointermove', { pointerType: 'mouse', pointerId: POINTER_ID, clientX: 220, clientY: 202 })
    await body.trigger('pointerup', { pointerType: 'mouse', pointerId: POINTER_ID, clientX: 200, clientY: 202 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('a swipe that never clears the slop (short jitter) emits nothing', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    await swipe(wrapper, { downX: 300, downY: 200, moveX: 297, moveY: 201, upX: 296, upY: 201 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('pointercancel resets tracking without emitting', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    const body = wrapper.find('.focus-view-body')
    await body.trigger('pointerdown', { pointerType: 'touch', pointerId: POINTER_ID, clientX: 300, clientY: 200 })
    await body.trigger('pointermove', { pointerType: 'touch', pointerId: POINTER_ID, clientX: 220, clientY: 202 })
    await body.trigger('pointercancel', { pointerType: 'touch', pointerId: POINTER_ID, clientX: 220, clientY: 202 })
    await body.trigger('pointerup', { pointerType: 'touch', pointerId: POINTER_ID, clientX: 200, clientY: 202 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('tap-to-switch (phase 1) still works unchanged alongside swipe', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    await wrapper.findAll('.focus-tab')[1].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['laptable']])
  })
})

/** F5 phase 3-ish — keeping the active tab scrolled into view (cheap enough
 *  to land alongside phase 2, see MobileFocusView.vue's own comment on the
 *  `watch(activeId, ...)` block). happy-dom doesn't implement
 *  `scrollIntoView`, so it's stubbed like ConvertResults.navigation.test.ts
 *  already does for the same reason. */
describe('MobileFocusView — active tab scroll-into-view', () => {
  it('calls scrollIntoView on the newly-active tab when currentViewId changes', async () => {
    const scrollIntoView = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    try {
      const wrapper = mountView(['map', 'chart-1', 'gear'], 'map')
      await wrapper.setProps({ currentViewId: 'gear' })
      await nextTick() // the watcher itself awaits nextTick before querying/scrolling
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })
})

/**
 * F5 phase 3 — per-view scroll-position memory. `.focus-view-body` is a
 * single shared element whose content is swapped on every tab switch (unlike
 * F1's retired stack, which mounted every card body permanently) — these
 * tests assert each view's scrollTop offset survives a round trip through
 * switching away and back, per MobileFocusView.vue's own module doc.
 *
 * happy-dom stores `scrollTop` as a raw, unclamped property (verified
 * directly — it has no real layout engine, so nothing computes
 * scrollHeight/clientHeight for a plain mounted element), so the "async
 * layout hasn't caught up yet, first restore attempt gets clamped" scenario
 * is simulated explicitly below via a fake clamping `scrollTop` accessor —
 * the ONLY test that needs it; the rest rely on the real (unclamped)
 * property, which is enough to prove save/restore wiring is correct.
 */
describe('MobileFocusView — per-view scroll-position memory (F5 phase 3)', () => {
  it('restores a scrolled view\'s offset after switching away and back', async () => {
    const wrapper = mountView(['map', 'gear'], 'map')
    const body = wrapper.get('.focus-view-body').element as HTMLElement
    body.scrollTop = 240

    await wrapper.setProps({ currentViewId: 'gear' })
    await nextTick() // restoreScrollPosition's own nextTick before it touches scrollTop
    expect(body.scrollTop).toBe(0) // fresh view, never scrolled — starts at 0

    await wrapper.setProps({ currentViewId: 'map' })
    await nextTick()
    expect(body.scrollTop).toBe(240) // 'map' remembers where it was left
  })

  it('a never-visited view starts at scrollTop 0', async () => {
    const wrapper = mountView(['map', 'gear', 'laptable'], 'map')
    const body = wrapper.get('.focus-view-body').element as HTMLElement
    await wrapper.setProps({ currentViewId: 'laptable' })
    await nextTick()
    expect(body.scrollTop).toBe(0)
  })

  it('each view remembers its OWN offset independently', async () => {
    const wrapper = mountView(['map', 'gear', 'laptable'], 'map')
    const body = wrapper.get('.focus-view-body').element as HTMLElement

    body.scrollTop = 50
    await wrapper.setProps({ currentViewId: 'gear' })
    await nextTick()
    body.scrollTop = 90
    await wrapper.setProps({ currentViewId: 'laptable' })
    await nextTick()
    expect(body.scrollTop).toBe(0)

    await wrapper.setProps({ currentViewId: 'map' })
    await nextTick()
    expect(body.scrollTop).toBe(50)

    await wrapper.setProps({ currentViewId: 'gear' })
    await nextTick()
    expect(body.scrollTop).toBe(90)
  })

  it('drops a stale id\'s remembered offset once it disappears from `ids`', async () => {
    const wrapper = mountView(['map', 'gear'], 'map')
    const body = wrapper.get('.focus-view-body').element as HTMLElement
    body.scrollTop = 77
    await wrapper.setProps({ currentViewId: 'gear' })
    await nextTick()

    // 'map' is removed from the visible set (e.g. CardMenu hid it) — its
    // remembered offset should be dropped, not silently kept around.
    await wrapper.setProps({ ids: ['gear'] })
    // 'map' is added back later (a fresh id, from the component's point of
    // view — no memory of the old 77 offset survives).
    await wrapper.setProps({ ids: ['gear', 'map'], currentViewId: 'map' })
    await nextTick()
    expect(body.scrollTop).toBe(0)
  })

  it('clears every remembered offset on a file/session switch (ctx.primaryFileId change)', async () => {
    const primaryFileId = ref<number | null>(1)
    const wrapper = mountView(['map', 'gear'], 'map', { primaryFileId })
    const body = wrapper.get('.focus-view-body').element as HTMLElement
    body.scrollTop = 65
    await wrapper.setProps({ currentViewId: 'gear' })
    await nextTick()

    primaryFileId.value = 2 // a different file loaded
    await nextTick()

    await wrapper.setProps({ currentViewId: 'map' })
    await nextTick()
    expect(body.scrollTop).toBe(0) // offset dropped, not carried into the new file
  })

  it('retries a restore once via requestAnimationFrame if content is not tall enough on the first attempt', async () => {
    let rafCallback: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallback = cb
      return 1
    })
    try {
      const wrapper = mountView(['map', 'gear'], 'map')
      const body = wrapper.get('.focus-view-body').element as HTMLElement

      // 'map' genuinely was scrolled to 300 (real, unclamped property, same
      // as every other test above) — this is what gets SAVED when switching
      // away from it.
      body.scrollTop = 300
      await wrapper.setProps({ currentViewId: 'gear' })
      await nextTick()

      // NOW simulate the remount-time layout gap: when switching back to
      // 'map', its (still-the-same, single shared) body isn't tall enough
      // yet on the very first write — scrollTop clamps toward a small max —
      // then "layout" catches up a frame later.
      let raw = 0
      let maxScroll = 10 // not tall enough yet — clamps writes above this
      Object.defineProperty(body, 'scrollTop', {
        configurable: true,
        get: () => raw,
        set: (v: number) => {
          raw = Math.max(0, Math.min(v, maxScroll))
        },
      })

      await wrapper.setProps({ currentViewId: 'map' })
      await nextTick() // first restore attempt: clamped to maxScroll (10)
      expect(body.scrollTop).toBe(10)

      maxScroll = 500 // layout has now caught up
      expect(rafCallback).not.toBeNull()
      const fireRetry = rafCallback as unknown as FrameRequestCallback
      fireRetry(0) // fire the retry
      expect(body.scrollTop).toBe(300)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not restore into a view the user already switched away from again before the rAF retry fires', async () => {
    let rafCallback: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallback = cb
      return 1
    })
    try {
      const wrapper = mountView(['map', 'gear', 'laptable'], 'map')
      const body = wrapper.get('.focus-view-body').element as HTMLElement

      body.scrollTop = 300
      await wrapper.setProps({ currentViewId: 'gear' })
      await nextTick()

      let raw = 0
      const maxScroll = 10
      Object.defineProperty(body, 'scrollTop', {
        configurable: true,
        get: () => raw,
        set: (v: number) => {
          raw = Math.max(0, Math.min(v, maxScroll))
        },
      })

      await wrapper.setProps({ currentViewId: 'map' })
      await nextTick() // clamped restore attempt queues a rAF retry for 'map'

      // Before that retry fires, the user switches to a third view.
      await wrapper.setProps({ currentViewId: 'laptable' })
      await nextTick()
      const beforeRetry = body.scrollTop

      const fireStaleRetry = rafCallback as unknown as FrameRequestCallback
      fireStaleRetry(0) // the stale 'map' retry fires late — must be a no-op now
      expect(body.scrollTop).toBe(beforeRetry)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/**
 * F5 phase 3 — tab bar scroll "edge fade". `.focus-tabs-wrap` gets a
 * `can-scroll-left`/`can-scroll-right` class from `computeScrollEdgeFade`
 * (unit-tested standalone in test/layout/scrollEdgeFade.test.ts) — these
 * tests only check the component wires real DOM measurements into it and
 * reacts to scroll/resize/id-set changes.
 */
describe('MobileFocusView — tab bar scroll edge fade (F5 phase 3)', () => {
  function setTabsExtent(wrapper: ReturnType<typeof mountView>, extent: { scrollLeft: number; scrollWidth: number; clientWidth: number }): HTMLElement {
    const tabs = wrapper.get('.focus-tabs').element as HTMLElement
    Object.defineProperty(tabs, 'scrollLeft', { configurable: true, value: extent.scrollLeft })
    Object.defineProperty(tabs, 'scrollWidth', { configurable: true, value: extent.scrollWidth })
    Object.defineProperty(tabs, 'clientWidth', { configurable: true, value: extent.clientWidth })
    return tabs
  }

  it('has neither can-scroll class when all tabs fit', async () => {
    const wrapper = mountView(['map', 'gear'], 'map')
    setTabsExtent(wrapper, { scrollLeft: 0, scrollWidth: 200, clientWidth: 200 })
    wrapper.get('.focus-tabs').trigger('scroll')
    await nextTick()
    const wrap = wrapper.get('.focus-tabs-wrap')
    expect(wrap.classes()).not.toContain('can-scroll-left')
    expect(wrap.classes()).not.toContain('can-scroll-right')
  })

  it('adds can-scroll-right when scrolled to the start of overflowing content', async () => {
    const wrapper = mountView(['map', 'gear', 'chart-1', 'laptable'], 'map')
    setTabsExtent(wrapper, { scrollLeft: 0, scrollWidth: 600, clientWidth: 200 })
    await wrapper.get('.focus-tabs').trigger('scroll')
    const wrap = wrapper.get('.focus-tabs-wrap')
    expect(wrap.classes()).toContain('can-scroll-right')
    expect(wrap.classes()).not.toContain('can-scroll-left')
  })

  it('adds can-scroll-left when scrolled to the end of overflowing content', async () => {
    const wrapper = mountView(['map', 'gear', 'chart-1', 'laptable'], 'map')
    setTabsExtent(wrapper, { scrollLeft: 400, scrollWidth: 600, clientWidth: 200 })
    await wrapper.get('.focus-tabs').trigger('scroll')
    const wrap = wrapper.get('.focus-tabs-wrap')
    expect(wrap.classes()).toContain('can-scroll-left')
    expect(wrap.classes()).not.toContain('can-scroll-right')
  })

  it('adds both classes while scrolled in the middle', async () => {
    const wrapper = mountView(['map', 'gear', 'chart-1', 'laptable'], 'map')
    setTabsExtent(wrapper, { scrollLeft: 200, scrollWidth: 600, clientWidth: 200 })
    await wrapper.get('.focus-tabs').trigger('scroll')
    const wrap = wrapper.get('.focus-tabs-wrap')
    expect(wrap.classes()).toContain('can-scroll-left')
    expect(wrap.classes()).toContain('can-scroll-right')
  })

  it('does not render the tabs-wrap (or any fade) for an empty id list', () => {
    const wrapper = mountView([], '')
    expect(wrapper.find('.focus-tabs-wrap').exists()).toBe(false)
  })
})

/** Regression: phase 1 tap and phase 2 swipe must still behave identically
 *  after the phase-3 scroll-memory/edge-fade additions — the tab bar markup
 *  gained an extra wrapping element (`.focus-tabs-wrap`) and the body gained
 *  a `ref`, neither of which should change routing/emit behaviour. */
describe('MobileFocusView — phase 1/2 regression after phase 3 additions', () => {
  it('tap-to-switch still emits select with the tapped id', async () => {
    const wrapper = mountView(['map', 'chart-1', 'gear'], 'map')
    await wrapper.findAll('.focus-tab')[2].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['gear']])
  })

  it('swipe-to-switch still works on a swipe-enabled view', async () => {
    const wrapper = mountView(['gear', 'laptable'], 'gear')
    const body = wrapper.find('.focus-view-body')
    await body.trigger('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 300, clientY: 200 })
    await body.trigger('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 220, clientY: 202 })
    await body.trigger('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 202 })
    expect(wrapper.emitted('select')).toEqual([['laptable']])
  })

  it('swipe is still suppressed on a map/chart view (owns horizontal drag)', async () => {
    const wrapper = mountView(['map', 'gear'], 'map')
    const body = wrapper.find('.focus-view-body')
    await body.trigger('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 300, clientY: 200 })
    await body.trigger('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 220, clientY: 202 })
    await body.trigger('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 200, clientY: 202 })
    expect(wrapper.emitted('select')).toBeUndefined()
  })
})
