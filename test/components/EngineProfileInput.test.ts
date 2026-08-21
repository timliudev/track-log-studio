// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import EngineProfileInput from '@/features/analyzer/EngineProfileInput.vue'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * F8 Stage 1 — the engine-profile input component. Follows
 * `ChannelRolePicker.test.ts`'s mount+i18n+pinia scaffold.
 */

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

function mountInput() {
  return mount(EngineProfileInput, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })],
    },
  })
}

beforeEach(() => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EngineProfileInput — two-point mode (default)', () => {
  it('defaults to the two-point kind with no incomplete-hint on a blank form', () => {
    const wrapper = mountInput()
    const buttons = wrapper.findAll('.kind-toggle button')
    expect(buttons[0].classes()).toContain('active')
    expect(wrapper.find('.estimate-err').exists()).toBe(false)
  })

  it('typing a peak-torque rpm alone shows the incomplete hint', async () => {
    const wrapper = mountInput()
    const rpmInputs = wrapper.findAll('.field input[type="number"]')
    await rpmInputs[0].setValue('6500')
    expect(wrapper.find('.estimate-err').exists()).toBe(true)
  })

  it('filling both required rpm fields clears the incomplete hint and persists to the store', async () => {
    const wrapper = mountInput()
    const store = useDrivetrainStore()
    const rpmInputs = wrapper.findAll('.field input[type="number"]')
    await rpmInputs[0].setValue('6500')
    await rpmInputs[1].setValue('9000')
    expect(wrapper.find('.estimate-err').exists()).toBe(false)
    expect(store.mt.engineProfile.twoPoint.peakTorqueRpm).toBe(6500)
    expect(store.mt.engineProfile.twoPoint.peakPowerRpm).toBe(9000)
  })

  it('clearing a filled rpm field back to blank stores null, not 0/NaN', async () => {
    const wrapper = mountInput()
    const store = useDrivetrainStore()
    const rpmInputs = wrapper.findAll('.field input[type="number"]')
    await rpmInputs[0].setValue('6500')
    await rpmInputs[0].setValue('')
    expect(store.mt.engineProfile.twoPoint.peakTorqueRpm).toBeNull()
  })

  it('switching the peak-power unit persists to the store', async () => {
    const wrapper = mountInput()
    const store = useDrivetrainStore()
    const unitSelect = wrapper.findAll('select')[0]
    await unitSelect.setValue('PS')
    expect(store.mt.engineProfile.twoPoint.peakPowerUnit).toBe('PS')
  })

  it('clicking the curve tab switches the active kind without discarding two-point data', async () => {
    const wrapper = mountInput()
    const store = useDrivetrainStore()
    const rpmInputs = wrapper.findAll('.field input[type="number"]')
    await rpmInputs[0].setValue('6500')
    const buttons = wrapper.findAll('.kind-toggle button')
    await buttons[1].trigger('click')
    expect(store.mt.engineProfile.activeKind).toBe('curve')
    expect(store.mt.engineProfile.twoPoint.peakTorqueRpm).toBe(6500)
  })
})

describe('EngineProfileInput — curve mode', () => {
  async function switchToCurve(wrapper: ReturnType<typeof mountInput>) {
    const buttons = wrapper.findAll('.kind-toggle button')
    await buttons[1].trigger('click')
  }

  it('shows a "no redline" error before any redline is set (default store has one, so seed a blank one)', async () => {
    const store = useDrivetrainStore()
    store.setMt({ redlineRpm: 0 })
    const wrapper = mountInput()
    await switchToCurve(wrapper)
    expect(wrapper.text()).toContain('請先在下方「傳動規格」填入有效的紅線／換檔轉速')
  })

  it('shows a too-few-points error for fewer than 3 valid rows', async () => {
    const wrapper = mountInput()
    await switchToCurve(wrapper)
    const textarea = wrapper.get('textarea')
    await textarea.setValue('3000,40\n6000,55')
    expect(wrapper.text()).toContain('需要至少 3 點有效資料')
    expect(wrapper.find('.curve-point-count').text()).toContain('已解析 2 點')
  })

  it('parses a valid 3+ point curve with no error shown', async () => {
    const wrapper = mountInput()
    await switchToCurve(wrapper)
    const textarea = wrapper.get('textarea')
    await textarea.setValue('3000,40\n6000,55\n9000,48')
    expect(wrapper.find('.estimate-err').exists()).toBe(false)
    expect(wrapper.find('.curve-point-count').text()).toContain('已解析 3 點')
  })

  it('tolerates and reports a header row + skipped lines', async () => {
    const wrapper = mountInput()
    await switchToCurve(wrapper)
    const textarea = wrapper.get('textarea')
    await textarea.setValue('rpm,torque\n3000,40\n6000,55\n9000,48\ngarbage line')
    const countText = wrapper.find('.curve-point-count').text()
    expect(countText).toContain('已解析 3 點')
    expect(countText).toContain('2 行無法解析')
  })

  it('flags out-of-order (non-increasing) rpm rows', async () => {
    const wrapper = mountInput()
    await switchToCurve(wrapper)
    const textarea = wrapper.get('textarea')
    await textarea.setValue('6000,55\n3000,40\n9000,48')
    expect(wrapper.text()).toContain('rpm 必須嚴格遞增')
  })

  it('rejects hostile/garbage paste content without throwing', async () => {
    const wrapper = mountInput()
    await switchToCurve(wrapper)
    const textarea = wrapper.get('textarea')
    await expect(textarea.setValue('<script>alert(1)</script>\nNaN,Infinity\n1e400,1e400')).resolves.not.toThrow()
    expect(wrapper.find('.curve-point-count').text()).toContain('已解析 0 點')
  })

  it('changing the value-column unit re-parses and persists to the store', async () => {
    const wrapper = mountInput()
    const store = useDrivetrainStore()
    await switchToCurve(wrapper)
    const unitSelect = wrapper.get('select')
    await unitSelect.setValue('kW')
    expect(store.mt.engineProfile.curve.valueUnit).toBe('kW')
  })

  it('renders in English when the locale is en', () => {
    const wrapper = mount(EngineProfileInput, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })],
      },
    })
    expect(wrapper.text()).toContain('Engine profile')
  })
})
