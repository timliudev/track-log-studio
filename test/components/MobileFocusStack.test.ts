// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import MobileFocusStack from '@/features/analyzer/MobileFocusStack.vue'
import AnalyzerCardBody from '@/features/analyzer/AnalyzerCardBody.vue'
import type { AnalyzerCardContext } from '@/features/analyzer/analyzerCardContext'
import en from '@/i18n/locales/en'
import zhHant from '@/i18n/locales/zh-Hant'

/**
 * F1 phase 1 — the Focus Stack renders one slim panel per curated id (title +
 * expand affordance over the shared card body), applies the per-panel weight
 * as flex-grow, and emits `expand` so AnalyzerView can switch back to the full
 * dashboard. shallowMount stubs AnalyzerCardBody (already covered on its own).
 */
function mountStack(ids: string[], weightFor: (id: string) => number = () => 1) {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en, 'zh-Hant': zhHant } })
  return shallowMount(MobileFocusStack, {
    props: {
      ids,
      ctx: {} as unknown as AnalyzerCardContext,
      titleFor: (id: string) => `title:${id}`,
      weightFor,
    },
    global: { plugins: [i18n] },
  })
}

describe('MobileFocusStack', () => {
  it('renders one panel per id, in order, each with its title and a body', () => {
    const wrapper = mountStack(['map', 'chart-1'])
    const panels = wrapper.findAll('.focus-panel')
    expect(panels).toHaveLength(2)
    expect(panels[0].attributes('data-card-id')).toBe('map')
    expect(panels[1].attributes('data-card-id')).toBe('chart-1')
    expect(panels[0].find('.focus-panel-title').text()).toBe('title:map')
    // One card body per panel.
    expect(wrapper.findAllComponents(AnalyzerCardBody)).toHaveLength(2)
  })

  it('applies the per-panel weight as flex-grow', () => {
    const wrapper = mountStack(['map', 'chart-1'], (id) => (id === 'map' ? 55 : 45))
    const panels = wrapper.findAll('.focus-panel')
    expect(panels[0].attributes('style')).toContain('flex-grow: 55')
    expect(panels[1].attributes('style')).toContain('flex-grow: 45')
  })

  it('emits `expand` when a panel expand affordance is tapped', async () => {
    const wrapper = mountStack(['map'])
    await wrapper.find('.focus-expand').trigger('click')
    expect(wrapper.emitted('expand')).toHaveLength(1)
  })

  it('renders an empty stack (no panels) for an empty id list', () => {
    const wrapper = mountStack([])
    expect(wrapper.findAll('.focus-panel')).toHaveLength(0)
  })
})
