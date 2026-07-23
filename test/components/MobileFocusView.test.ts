// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
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
