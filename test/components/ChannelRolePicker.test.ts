// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ChannelRolePicker from '@/features/analyzer/ChannelRolePicker.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { useChannelRoleStore } from '@/stores/channelRoleStore'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * B134 — the empty-state dropdown a user hits when the resolver
 * (channelRoles.ts) can't find an rpm/speed/gear channel automatically. This
 * follows the mount+i18n+pinia scaffold `CvtDynamicsCard.test.ts` (a real
 * host of this component) already established.
 */

function channel(name: string): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array([1, 2, 3]) }
}

const session = new LogSession(
  [channel('EngineRPM_rpm'), channel('VehicleSpeed_kmh'), channel('CoolantTemp_degC')],
  { formatId: 'test', createdDate: null, headerInfo: {} },
)

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(ChannelRolePicker, {
    props: { session, role: 'rpm', message: '此記錄缺少轉速(RPM)頻道', ...props },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })],
    },
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChannelRolePicker', () => {
  it('shows the hint message and an "auto" option selected by default', () => {
    const wrapper = mountPicker()
    expect(wrapper.get('.hint').text()).toBe('此記錄缺少轉速(RPM)頻道')
    const select = wrapper.get('select')
    expect(select.element.value).toBe('')
    expect(wrapper.find('.applied-hint').exists()).toBe(false)
  })

  it('lists every session channel as an option', () => {
    const wrapper = mountPicker()
    const optionTexts = wrapper.findAll('option').map((o) => o.text())
    expect(optionTexts).toContain('EngineRPM_rpm')
    expect(optionTexts).toContain('VehicleSpeed_kmh')
    expect(optionTexts).toContain('CoolantTemp_degC')
  })

  it('selecting a channel saves it to the device-wide store as an override', async () => {
    const wrapper = mountPicker()
    const store = useChannelRoleStore()
    await wrapper.get('select').setValue('EngineRPM_rpm')
    expect(store.overrides).toEqual({ EngineRPM_rpm: 'rpm' })
    expect(wrapper.get('.applied-hint').text()).toContain('EngineRPM_rpm')
  })

  it('reflects an override already set in the store on mount', () => {
    const store = useChannelRoleStore()
    store.setOverride('EngineRPM_rpm', 'rpm')
    const wrapper = mountPicker()
    expect(wrapper.get('select').element.value).toBe('EngineRPM_rpm')
    expect(wrapper.find('.applied-hint').exists()).toBe(true)
  })

  it('picking "auto" again clears the override', async () => {
    const store = useChannelRoleStore()
    store.setOverride('EngineRPM_rpm', 'rpm')
    const wrapper = mountPicker()
    await wrapper.get('select').setValue('')
    expect(store.overrides).toEqual({})
    expect(wrapper.find('.applied-hint').exists()).toBe(false)
  })

  it('an override saved for a different role does not show as applied here', () => {
    const store = useChannelRoleStore()
    store.setOverride('VehicleSpeed_kmh', 'speed')
    const wrapper = mountPicker({ role: 'rpm' })
    expect(wrapper.get('select').element.value).toBe('')
  })
})
