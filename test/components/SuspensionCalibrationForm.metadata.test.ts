// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import SuspensionCalibrationForm from '@/components/SuspensionCalibrationForm.vue'
import { LogSession } from '@/domain/model/LogSession'
import { useSuspensionStore } from '@/stores/suspensionStore'
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

describe('SuspensionCalibrationForm embedded calibration', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    setActivePinia(createPinia())
  })

  it('does not overwrite the active calibration until the user explicitly applies the imported one', async () => {
    const imported = {
      front: { enabled: true, sourceChannel: 'ImportedFront', minMv: 100, maxMv: 4900, zeroMv: 500, minMm: 0, maxMm: 120 },
      rear: { enabled: false, sourceChannel: 'ImportedRear', minMv: 50, maxMv: 4950, zeroMv: 450, minMm: 0, maxMm: 110 },
    }
    const session = new LogSession([], {
      formatId: 'csv', createdDate: null, headerInfo: {}, exportMetadata: { suspensionCalibration: imported },
    })
    const suspension = useSuspensionStore()
    suspension.setChannel('front', { maxMm: 77 })
    const i18n = createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant, en } })
    const wrapper = mount(SuspensionCalibrationForm, { props: { sessions: [session] }, global: { plugins: [i18n] } })

    const apply = wrapper.get('.apply-imported-calibration')
    expect(suspension.config.front.maxMm).toBe(77)
    await apply.trigger('click')
    expect(suspension.config).toEqual(imported)
  })
})
