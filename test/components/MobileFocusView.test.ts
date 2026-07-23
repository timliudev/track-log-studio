// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
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
function mountView(ids: string[], currentViewId = '') {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, 'zh-Hant': zhHant },
  })
  return shallowMount(MobileFocusView, {
    props: {
      ids,
      ctx: {} as unknown as AnalyzerCardContext,
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
