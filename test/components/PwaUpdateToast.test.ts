// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { ref } from 'vue'
import PwaUpdateToast from '@/components/PwaUpdateToast.vue'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

const needRefresh = ref(false)
const offlineReady = ref(false)
const updateServiceWorker = vi.fn().mockResolvedValue(undefined)

vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({ needRefresh, offlineReady, updateServiceWorker }),
}))

function mountToast() {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(PwaUpdateToast, { global: { plugins: [i18n] } })
}

describe('PwaUpdateToast', () => {
  beforeEach(() => {
    needRefresh.value = false
    offlineReady.value = false
    updateServiceWorker.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when there is no pending update or offline-ready signal', () => {
    const wrapper = mountToast()
    expect(wrapper.find('.pwa-toast').exists()).toBe(false)
  })

  it('shows the update toast with a reload action, announced via an aria-live status region', async () => {
    needRefresh.value = true
    const wrapper = mountToast()
    await wrapper.vm.$nextTick()

    const toast = wrapper.get('.pwa-toast')
    expect(toast.attributes('role')).toBe('status')
    expect(toast.attributes('aria-live')).toBe('polite')
    expect(toast.text()).toContain('有新版本可用')

    const reloadBtn = wrapper.get('.pwa-toast-reload')
    await reloadBtn.trigger('click')
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('shows the offline-ready toast without a reload button, and dismiss hides it', async () => {
    offlineReady.value = true
    const wrapper = mountToast()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.pwa-toast-reload').exists()).toBe(false)
    expect(wrapper.get('.pwa-toast').text()).toContain('應用程式已可離線使用')

    await wrapper.get('.pwa-toast-dismiss').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.pwa-toast').exists()).toBe(false)
  })
})
