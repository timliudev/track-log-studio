// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ConverterView from '@/features/converter/ConverterView.vue'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

// converterStore/suspensionStore/fileStore all read/write localStorage on
// construction — same in-memory stub other store-backed component tests in
// this repo use (see SettingsView.test.ts).
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

function mountConverter() {
  setActivePinia(createPinia())
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(ConverterView, { global: { plugins: [i18n], directives: { tooltip: vTooltip } } })
}

describe('ConverterView — B21 suspension-calibration placement', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('renders without throwing', () => {
    expect(() => mountConverter()).not.toThrow()
  })

  it('nests the suspension-calibration <details> inside the FIRST (output/convert) column, not full-width below the grid', () => {
    const wrapper = mountConverter()
    const cols = wrapper.findAll('.grid > .col')
    expect(cols.length).toBe(2)
    const suspensionInFirstCol = cols[0].find('.suspension-section')
    expect(suspensionInFirstCol.exists()).toBe(true)
    expect(cols[1].find('.suspension-section').exists()).toBe(false)
    // Not a sibling of .grid anymore (the old full-width placement).
    expect(wrapper.find('.converter > .suspension-section').exists()).toBe(false)
  })

  it('still shows the suspension toggle summary text', () => {
    const wrapper = mountConverter()
    expect(wrapper.text()).toContain('避震校正')
  })
})
