// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearPanel from '@/features/analyzer/GearPanel.vue'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * Tire-spec LIVE conversion (2026-07-08 user decision) — panel wiring on top
 * of drivetrainStore.setTireSpec (whose overwrite rules are unit-tested in
 * test/stores/drivetrainStore.test.ts): typing a valid spec auto-applies the
 * converted circumference into the mm field WITHOUT any 套用 button, shows a
 * visual feedback flash, and a manual mm edit dismisses that flash without
 * touching the spec text.
 */

function mountPanel() {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  // session: null — the chart/inversion sections render plain hints, so no
  // canvas stubbing is needed; the spec form under test renders regardless.
  return mount(GearPanel, {
    props: { session: null },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
}

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

beforeEach(() => {
  installMemoryLocalStorage()
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('GearPanel — tire-spec live conversion', () => {
  it('has no 套用 button for the tire spec anymore (live conversion replaced it)', () => {
    const wrapper = mountPanel()
    // The only .apply-btn left is the estimate-from-log button.
    const applyButtons = wrapper.findAll('.apply-btn')
    expect(applyButtons).toHaveLength(1)
    expect(applyButtons[0].text()).toContain('倒算')
  })

  it('typing a valid spec auto-applies the circumference and flashes feedback', async () => {
    const wrapper = mountPanel()
    const store = useDrivetrainStore()

    await wrapper.find('.tire-spec-input').setValue('120/80-12')

    expect(store.mt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 496.8))
    expect(wrapper.find('.tire-spec-applied').exists()).toBe(true)
    expect(wrapper.find('.circumference-input').classes()).toContain('auto-applied')
    // The mm input itself shows the applied value.
    expect((wrapper.find('.circumference-input').element as HTMLInputElement).value).toBe(
      String(Math.round(Math.PI * 496.8)),
    )
  })

  it('an invalid (mid-edit) spec shows the invalid hint and leaves the mm value alone', async () => {
    const wrapper = mountPanel()
    const store = useDrivetrainStore()
    const before = store.mt.wheelCircumferenceMm

    await wrapper.find('.tire-spec-input').setValue('120/80-')

    expect(store.mt.wheelCircumferenceMm).toBe(before)
    expect(wrapper.find('.tire-spec-applied').exists()).toBe(false)
    expect(wrapper.text()).toContain('無法解析輪胎規格')
  })

  it('a manual mm fine-tune dismisses the flash and leaves the spec text untouched', async () => {
    const wrapper = mountPanel()
    const store = useDrivetrainStore()

    await wrapper.find('.tire-spec-input').setValue('120/80-12')
    expect(wrapper.find('.tire-spec-applied').exists()).toBe(true)

    await wrapper.find('.circumference-input').setValue('1550')

    expect(store.mt.wheelCircumferenceMm).toBe(1550)
    expect(store.mt.tireSpec).toBe('120/80-12')
    expect(wrapper.find('.tire-spec-applied').exists()).toBe(false)
    expect(wrapper.find('.circumference-input').classes()).not.toContain('auto-applied')
  })

  it('a cosmetic spec rewrite after a manual tweak does not overwrite the tweak', async () => {
    const wrapper = mountPanel()
    const store = useDrivetrainStore()

    await wrapper.find('.tire-spec-input').setValue('120/70-17')
    await wrapper.find('.circumference-input').setValue('1850')
    await wrapper.find('.tire-spec-input').setValue('120/70ZR17')

    expect(store.mt.wheelCircumferenceMm).toBe(1850)
    // No overwrite -> no "auto-applied" flash either.
    expect(wrapper.find('.tire-spec-applied').exists()).toBe(false)
  })

  it('a real size change after a manual tweak overwrites it again, with feedback', async () => {
    const wrapper = mountPanel()
    const store = useDrivetrainStore()

    await wrapper.find('.tire-spec-input').setValue('120/70-17')
    await wrapper.find('.circumference-input').setValue('1850')
    await wrapper.find('.tire-spec-input').setValue('180/55-17')

    expect(store.mt.wheelCircumferenceMm).toBe(Math.round(Math.PI * (17 * 25.4 + 2 * 99)))
    expect(wrapper.find('.tire-spec-applied').exists()).toBe(true)
  })
})
