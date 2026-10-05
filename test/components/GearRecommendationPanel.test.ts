// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearRecommendationPanel from '@/features/analyzer/GearRecommendationPanel.vue'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * F8 Stages 2/3/4 — the gear-recommendation output panel. Focuses on the
 * spec's two hard requirements: the target switcher (Stage 3) and the
 * two-point vs curve honesty gating (Stage 4) — see
 * `GearRecommendationPanel.vue`'s header comment for the exact gating rule.
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

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function sessionWithSpeed(speeds: number[]): LogSession {
  return new LogSession([channel('GPS_Speed', speeds)], { formatId: 'nmea', createdDate: null, headerInfo: {} })
}

function mountPanel(session: LogSession | null = null) {
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })
  return mount(GearRecommendationPanel, { props: { session }, global: { plugins: [i18n] } })
}

beforeEach(() => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GearRecommendationPanel — empty state', () => {
  it('shows the "no engine profile" hint when nothing has been entered', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('請先在上方填入引擎特性')
    // Nothing else should render.
    expect(wrapper.find('.rec-table').exists()).toBe(false)
  })
})

describe('GearRecommendationPanel — Stage 4 honesty gating', () => {
  it('two-point profile: shift-rpm section shows the curve-only disabled hint, not a shift list', () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('此區塊需要曲線版引擎資料')
    expect(wrapper.find('.shift-list').exists()).toBe(false)
  })

  it('a valid curve leftover behind an ACTIVE two-point selection still gates as two-point (per the header comment rule)', () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    store.setEngineCurve({ rawText: '3000,40\n6000,55\n9000,48' })
    store.setEngineProfileActiveKind('twoPoint') // curve data present but NOT active
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('此區塊需要曲線版引擎資料')
    expect(wrapper.find('.shift-list').exists()).toBe(false)
  })

  it('curve profile: shift-rpm section renders an actual shift list with a reason', () => {
    const store = useDrivetrainStore()
    store.setEngineProfileActiveKind('curve')
    store.setEngineCurve({ rawText: '3000,40\n6000,55\n9000,48' })
    const wrapper = mountPanel()
    expect(wrapper.find('.shift-list').exists()).toBe(true)
    expect(wrapper.findAll('.shift-list li').length).toBeGreaterThan(0)
  })

  it('an invalid (too-few-points) curve as the ONLY input falls back to the top-level empty state, not a crash', () => {
    const store = useDrivetrainStore()
    store.setEngineProfileActiveKind('curve')
    store.setEngineCurve({ rawText: '3000,40\n6000,55' })
    const wrapper = mountPanel()
    // No usable profile at all yet (curve invalid, no two-point data either)
    // — the panel correctly shows the top-level "fill in a profile" hint
    // rather than a partial/broken recommendation UI.
    expect(wrapper.text()).toContain('請先在上方填入引擎特性')
  })

  it('an invalid curve as the ACTIVE selection takes priority over a valid two-point profile sitting unused behind it', () => {
    // activeKind picks which form is authoritative (see EngineProfileFormState's
    // doc) — a valid twoPoint form is not a silent fallback once the user has
    // switched to curve mode, even if that curve is currently invalid.
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    store.setEngineProfileActiveKind('curve')
    store.setEngineCurve({ rawText: '3000,40\n6000,55' })
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('請先在上方填入引擎特性')
    expect(wrapper.find('.rec-table').exists()).toBe(false)
  })
})

describe('GearRecommendationPanel — Stage 2 ratio table', () => {
  it('renders current ratio + landing rpm rows once a two-point profile exists', () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel()
    const table = wrapper.get('.rec-table')
    // DEFAULT_MT has 6 gears.
    expect(table.findAll('tbody tr').length).toBe(6)
  })

  it('shows a recommended-ratio column only for the acceleration target', async () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('建議齒比')
    const buttons = wrapper.findAll('.target-toggle button')
    await buttons[1].trigger('click') // measuredLog
    expect(wrapper.text()).toContain('「建議齒比」欄僅在「加速優先」目標下提供')
  })
})

describe('GearRecommendationPanel — Stage 3 target switcher', () => {
  it('defaults to the acceleration target', () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel()
    const buttons = wrapper.findAll('.target-toggle button')
    expect(buttons[0].classes()).toContain('active')
  })

  it('measuredLog target shows a "load a session" hint with no session', () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel(null)
    return wrapper.findAll('.target-toggle button')[1].trigger('click').then(() => {
      expect(wrapper.text()).toContain('請先載入記錄才能使用此目標')
    })
  })

  it('measuredLog target shows band-occupancy stats once a session with a speed channel is loaded', async () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const session = sessionWithSpeed(new Array(50).fill(60))
    const wrapper = mountPanel(session)
    await wrapper.findAll('.target-toggle button')[1].trigger('click')
    expect(wrapper.text()).toContain('扭力帶佔有率')
  })

  it('topSpeed target computes a suggested final drive from a target speed input', async () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel()
    await wrapper.findAll('.target-toggle button')[2].trigger('click')
    const input = wrapper.get('.field input[type="number"]')
    await input.setValue('180')
    expect(wrapper.text()).toContain('建議終傳比')
  })

  it('topSpeed target shows sprocket combos when final drive is in teeth mode', async () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    expect(store.mt.finalDrive.mode).toBe('teeth') // DEFAULT_MT default
    const wrapper = mountPanel()
    await wrapper.findAll('.target-toggle button')[2].trigger('click')
    const input = wrapper.get('.field input[type="number"]')
    await input.setValue('180')
    expect(wrapper.text()).toContain('建議齒盤組合')
  })

  it('topSpeed target renders a gearing verdict once an achieved speed is entered', async () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel()
    await wrapper.findAll('.target-toggle button')[2].trigger('click')
    const inputs = wrapper.findAll('.field input[type="number"]')
    // Second number input on this target is the achieved-speed field.
    await inputs[inputs.length - 1].setValue('150')
    expect(wrapper.text()).toMatch(/判定：/)
  })

  it('renders in English when the locale is en', () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })
    const wrapper = mount(GearRecommendationPanel, { props: { session: null }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('Gear recommendation')
  })
})
