// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
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

  it('only shows the pin button when showPin is true', () => {
    expect(mountCard({ showPin: false }).find('.pin-btn').exists()).toBe(false)
    expect(mountCard({ showPin: true }).find('.pin-btn').exists()).toBe(true)
  })

  it('emits update:pinned when the pin button is clicked', async () => {
    const wrapper = mountCard({ showPin: true, pinned: false })
    await wrapper.find('.pin-btn').trigger('click')
    expect(wrapper.emitted('update:pinned')).toEqual([[true]])
  })
})
