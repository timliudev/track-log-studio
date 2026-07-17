// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ConvertResults from '@/features/converter/ConvertResults.vue'
import { useAppNavigationStore } from '@/stores/appNavigationStore'
import { useConverterStore } from '@/stores/converterStore'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

function installMemoryLocalStorage(): void {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  })
}

describe('ConvertResults B83 navigation target', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    setActivePinia(createPinia())
    vi.stubGlobal('scrollTo', vi.fn())
    HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('switches to modified .loga, focuses the save region, and consumes the one-shot request', async () => {
    const navigation = useAppNavigationStore()
    navigation.requestConverterSaveModified()
    const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant, en } })
    const wrapper = mount(ConvertResults, {
      attachTo: document.body,
      global: { plugins: [i18n], directives: { tooltip: {} } },
    })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(useConverterStore().outputFormat).toBe('loga')
    expect(navigation.target).toBeNull()
    expect(wrapper.find('.save-modified-region').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.find('.save-modified-region').element)
  })
})
