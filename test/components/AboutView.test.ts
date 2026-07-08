// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import AboutView from '@/features/about/AboutView.vue'
import { thirdPartyLicenses } from '@/data/licenses'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * Mount smoke test for the "About" page (#16): asserts it renders without
 * error and surfaces the project info + full third-party license list,
 * in both locales (mirrors DashboardCard.test.ts's scaffold pattern).
 */
function mountAbout(locale: 'zh-Hant' | 'en' = 'zh-Hant') {
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })

  return mount(AboutView, { global: { plugins: [i18n] } })
}

describe('AboutView', () => {
  it('mounts and shows the project name', () => {
    const wrapper = mountAbout()
    expect(wrapper.text()).toContain('Track Log Studio')
  })

  it('links to the GitHub repo and the project LICENSE file', () => {
    const wrapper = mountAbout()
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('https://github.com/timliudev/track-log-studio')
    expect(hrefs).toContain('https://github.com/timliudev/track-log-studio/blob/main/LICENSE')
  })

  it('renders every third-party license entry', () => {
    const wrapper = mountAbout()
    for (const pkg of thirdPartyLicenses) {
      expect(wrapper.text()).toContain(pkg.name)
      expect(wrapper.text()).toContain(pkg.license)
    }
  })

  it('renders the same content in English', () => {
    const wrapper = mountAbout('en')
    expect(wrapper.text()).toContain('Third-party open-source licenses')
    expect(wrapper.text()).toContain('vue')
  })
})
