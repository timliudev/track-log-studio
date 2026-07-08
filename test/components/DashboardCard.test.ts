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

  it('always shows the pin button (釘選 now works at every breakpoint, not just mobile)', () => {
    expect(mountCard().find('.pin-btn').exists()).toBe(true)
  })

  it('emits update:pinned when the pin button is clicked', async () => {
    const wrapper = mountCard({ pinned: false })
    await wrapper.find('.pin-btn').trigger('click')
    expect(wrapper.emitted('update:pinned')).toEqual([[true]])
  })

  describe('aspectRatio (#18 fix — pinned card keeps its original grid shape)', () => {
    it('applies aspect-ratio inline style when pinned with a valid ratio', () => {
      const wrapper = mountCard({ pinned: true, aspectRatio: 4 / 10 })
      expect(wrapper.attributes('style')).toContain('aspect-ratio: 0.4')
    })

    it('does NOT apply aspect-ratio when the card is not pinned, even if a ratio is given', () => {
      const wrapper = mountCard({ pinned: false, aspectRatio: 4 / 10 })
      expect(wrapper.attributes('style')).toBeUndefined()
    })

    it('does NOT apply aspect-ratio when pinned but no ratio is given (falls back to fixed max-height)', () => {
      const wrapper = mountCard({ pinned: true })
      expect(wrapper.attributes('style')).toBeUndefined()
    })

    it('ignores a non-finite/zero/negative ratio rather than emitting an invalid style', () => {
      for (const bad of [0, -1, NaN, Infinity]) {
        const wrapper = mountCard({ pinned: true, aspectRatio: bad })
        expect(wrapper.attributes('style')).toBeUndefined()
      }
    })

    it('a wide/short card (e.g. a control panel, w:h=4:5) gets a different ratio than a tall/narrow one (e.g. a chart, w:h=4:11)', () => {
      const wide = mountCard({ pinned: true, aspectRatio: 4 / 5 })
      const tall = mountCard({ pinned: true, aspectRatio: 4 / 11 })
      expect(wide.attributes('style')).not.toBe(tall.attributes('style'))
    })
  })
})
