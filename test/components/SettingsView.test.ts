// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import SettingsView from '@/features/settings/SettingsView.vue'
import { thirdPartyLicenses } from '@/data/licenses'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

// settingsStore reads/writes localStorage on construction — happy-dom's jsdom
// shim doesn't ship one here, so stub an in-memory implementation (mirrors
// SuspensionCard.test.ts's installMemoryLocalStorage helper).
function installMemoryLocalStorage(): void {
  let store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store = new Map<string, string>()
    },
  })
}

/**
 * Mount smoke test for the Settings tab (#16 follow-up): the standalone
 * "About" tab was folded into the bottom of Settings (see App.vue /
 * BottomNav.vue — the 4th tab was removed), so this replaces the old
 * dedicated AboutView.test.ts and asserts the merged view still renders both
 * the settings controls and the project info + full third-party license
 * list, in both locales (mirrors DashboardCard.test.ts's scaffold pattern).
 */
function mountSettings(locale: 'zh-Hant' | 'en' = 'zh-Hant') {
  setActivePinia(createPinia())

  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })

  return mount(SettingsView, { global: { plugins: [i18n] } })
}

describe('SettingsView', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('renders the settings controls (theme / language / timezone)', () => {
    const wrapper = mountSettings()
    const selects = wrapper.findAll('select').map((s) => s.attributes('name'))
    expect(selects).toContain('theme')
    expect(selects).toContain('locale')
    expect(selects).toContain('timezone')
  })

  it('renders the project name in the merged About section', () => {
    const wrapper = mountSettings()
    expect(wrapper.text()).toContain('Track Log Studio')
  })

  it('links to the GitHub repo and the project LICENSE file', () => {
    const wrapper = mountSettings()
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('https://github.com/timliudev/track-log-studio')
    expect(hrefs).toContain('https://github.com/timliudev/track-log-studio/blob/main/LICENSE')
  })

  it('renders every third-party license entry', () => {
    const wrapper = mountSettings()
    for (const pkg of thirdPartyLicenses) {
      expect(wrapper.text()).toContain(pkg.name)
      expect(wrapper.text()).toContain(pkg.license)
    }
  })

  it('renders the same content in English', () => {
    const wrapper = mountSettings('en')
    expect(wrapper.text()).toContain('Third-party open-source licenses')
    expect(wrapper.text()).toContain('vue')
  })
})
