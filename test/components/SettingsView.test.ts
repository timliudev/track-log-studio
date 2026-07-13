// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import SettingsView from '@/features/settings/SettingsView.vue'
import { thirdPartyLicenses } from '@/data/licenses'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'
import {
  buildExportBundle,
  serializeExportBundle,
} from '@/domain/settings/settingsTransfer'
import { useSettingsStore } from '@/stores/settingsStore'

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

  it('renders the settings controls (theme / language / timezone / input mode)', () => {
    const wrapper = mountSettings()
    const selects = wrapper.findAll('select').map((s) => s.attributes('name'))
    expect(selects).toContain('theme')
    expect(selects).toContain('locale')
    expect(selects).toContain('timezone')
    expect(selects).toContain('inputMode')
  })

  // B35 — §8 layer-4 manual override fuse.
  it('persists the input-mode preference to the settings store', async () => {
    const wrapper = mountSettings()
    const select = wrapper.find('select[name="inputMode"]')
    await select.setValue('touch')
    await nextTick()
    expect(useSettingsStore().inputModePref).toBe('touch')
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

  // B20 — show the currently-applied value next to an 'auto' control.
  describe('B20 — current value display', () => {
    it('shows the resolved theme/language/timezone next to each control while on "auto"', () => {
      const wrapper = mountSettings()
      // Defaults are all 'auto'; happy-dom's matchMedia stub reports
      // prefers-color-scheme:dark as false, so theme resolves to 'light'.
      const currentValues = wrapper.findAll('.current-value').map((el) => el.text())
      expect(currentValues.length).toBe(3)
      expect(currentValues.some((t) => t.includes('淺色'))).toBe(true)
      expect(currentValues.some((t) => t.includes('繁體中文'))).toBe(true)
      expect(currentValues.some((t) => t.includes('UTC'))).toBe(true)
    })

    it('hides the current-value hint once a control is set to an explicit (non-auto) value', async () => {
      const wrapper = mountSettings()
      const themeSelect = wrapper.find('select[name="theme"]')
      await themeSelect.setValue('dark')
      await nextTick()
      // Only language + timezone remain 'auto' now.
      expect(wrapper.findAll('.current-value').length).toBe(2)
    })
  })

  // B19 — settings export / import.
  describe('B19 — export / import', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })

    it('renders the include-layout toggle and export/import buttons', () => {
      const wrapper = mountSettings()
      expect(wrapper.find('input[name="includeLayout"]').exists()).toBe(true)
      const buttonTexts = wrapper.findAll('button').map((b) => b.text())
      expect(buttonTexts).toContain('匯出設定')
      expect(buttonTexts).toContain('匯入設定…')
    })

    it('clicking export triggers a JSON blob download without throwing', async () => {
      installMemoryLocalStorage()
      const createObjectURL = vi.fn(() => 'blob:mock')
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
      // happy-dom implements `click` on HTMLElement.prototype (not
      // re-declared per-tag), so that's what an <a> instance resolves to.
      const clickSpy = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {})

      const wrapper = mountSettings()
      const exportButton = wrapper.findAll('button').find((b) => b.text() === '匯出設定')!
      await exportButton.trigger('click')

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(clickSpy).toHaveBeenCalledTimes(1)
    })

    it('importing a valid file (confirmed) applies appearance settings immediately', async () => {
      installMemoryLocalStorage()
      vi.stubGlobal('confirm', vi.fn(() => true))

      const wrapper = mountSettings()
      const bundle = buildExportBundle({
        appearance: { themePref: 'dark', localePref: 'en', tzOverride: 480, inputModePref: 'auto' },
        drivetrain: {
          kind: 'mt',
          mt: {
            primaryReduction: 2.833,
            gearRatios: [],
            finalDrive: { mode: 'teeth', ratio: 0, frontTeeth: 15, rearTeeth: 45 },
            circumferenceMode: 'direct',
            tireSpec: '',
            wheelCircumferenceMm: 1884,
            redlineRpm: 10000,
          },
          cvt: { wheelCircumferenceMm: 1400, tireSpec: '', notes: [] },
          inversionWheelCircumferenceMm: 1870,
        },
      })
      const json = serializeExportBundle(bundle)
      const file = new File([json], 'settings.json', { type: 'application/json' })
      const input = wrapper.find('input[type="file"]')
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const inputEl = input.element as HTMLInputElement
      inputEl.files = dataTransfer.files
      await input.trigger('change')
      // Flush the async onImportFileChange handler (awaits file.text()).
      await new Promise((r) => setTimeout(r, 0))
      await nextTick()

      const themeSelect = wrapper.find('select[name="theme"]').element as HTMLSelectElement
      expect(themeSelect.value).toBe('dark')
      expect(wrapper.text()).toContain('設定已匯入並套用')
    })

    it('does not apply anything when the user cancels the overwrite confirmation', async () => {
      installMemoryLocalStorage()
      vi.stubGlobal('confirm', vi.fn(() => false))

      const wrapper = mountSettings()
      const bundle = buildExportBundle({
        appearance: { themePref: 'dark', localePref: 'en', tzOverride: 480, inputModePref: 'auto' },
        drivetrain: {
          kind: 'mt',
          mt: {
            primaryReduction: 2.833,
            gearRatios: [],
            finalDrive: { mode: 'teeth', ratio: 0, frontTeeth: 15, rearTeeth: 45 },
            circumferenceMode: 'direct',
            tireSpec: '',
            wheelCircumferenceMm: 1884,
            redlineRpm: 10000,
          },
          cvt: { wheelCircumferenceMm: 1400, tireSpec: '', notes: [] },
          inversionWheelCircumferenceMm: 1870,
        },
      })
      const json = serializeExportBundle(bundle)
      const file = new File([json], 'settings.json', { type: 'application/json' })
      const input = wrapper.find('input[type="file"]')
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const inputEl = input.element as HTMLInputElement
      inputEl.files = dataTransfer.files
      await input.trigger('change')
      await new Promise((r) => setTimeout(r, 0))
      await nextTick()

      const themeSelect = wrapper.find('select[name="theme"]').element as HTMLSelectElement
      expect(themeSelect.value).toBe('auto')
    })

    it('shows an error message for an invalid (non-JSON) import file', async () => {
      installMemoryLocalStorage()
      const wrapper = mountSettings()
      const file = new File(['not json'], 'settings.json', { type: 'application/json' })
      const input = wrapper.find('input[type="file"]')
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(file)
      const inputEl = input.element as HTMLInputElement
      inputEl.files = dataTransfer.files
      await input.trigger('change')
      await new Promise((r) => setTimeout(r, 0))
      await nextTick()

      expect(wrapper.text()).toContain('不是有效的 JSON')
    })
  })
})
