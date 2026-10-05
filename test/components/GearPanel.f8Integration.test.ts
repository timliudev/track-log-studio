// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearPanel from '@/features/analyzer/GearPanel.vue'
import EngineProfileInput from '@/features/analyzer/EngineProfileInput.vue'
import GearRecommendationPanel from '@/features/analyzer/GearRecommendationPanel.vue'
import UPlotChart from '@/components/UPlotChart.vue'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * F8 — confirms `EngineProfileInput.vue`/`GearRecommendationPanel.vue` are
 * actually wired into `GearPanel.vue`'s MT tab (each has its own dedicated,
 * much more thorough test suite — this is a lean "did the wiring survive"
 * integration check), and that the usable-band `xBands` prop reaches the
 * chart once a valid engine profile exists.
 */

function installFakeCanvasContext(): void {
  const backing: Record<string, unknown> = {}
  const fakeCtx = new Proxy(backing, {
    get(target, prop) {
      if (prop in target) return target[prop as string]
      if (prop === 'measureText') return () => ({ width: 0 })
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      return () => {}
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => fakeCtx,
    configurable: true,
  })
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo() {}
      lineTo() {}
      closePath() {}
      rect() {}
      arc() {}
      bezierCurveTo() {}
    },
  )
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

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** A session with RPM/GPS_Speed data so the MT chart's own preconditions
 *  (channelsAvailable + mtValid + mtChartHasData) are satisfied and it
 *  actually renders — DEFAULT_MT's own default spec is already valid, this
 *  just needs SOME finite scatter data. */
function sessionWithMeasuredScatter(n = 20): LogSession {
  const rpm = Array.from({ length: n }, (_, i) => 3000 + (6000 * i) / (n - 1))
  const speed = rpm.map((r) => r / 100)
  return new LogSession(
    [channel('RPM', rpm), channel('GPS_Speed', speed)],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

function mountPanel(session: LogSession | null = null) {
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })
  return mount(GearPanel, {
    props: { session },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
}

beforeEach(() => {
  installMemoryLocalStorage()
  installFakeCanvasContext()
  setActivePinia(createPinia())
})

describe('GearPanel — F8 wiring', () => {
  it('mounts EngineProfileInput and GearRecommendationPanel inside the MT tab', () => {
    const wrapper = mountPanel()
    expect(wrapper.findComponent(EngineProfileInput).exists()).toBe(true)
    expect(wrapper.findComponent(GearRecommendationPanel).exists()).toBe(true)
  })

  it('does not pass any xBands to the MT chart before an engine profile is entered', () => {
    const wrapper = mountPanel(sessionWithMeasuredScatter())
    const chart = wrapper.findComponent(UPlotChart)
    expect(chart.exists()).toBe(true)
    expect(chart.props('xBands')).toEqual([])
  })

  it('passes the usable-band xBands to the MT chart once a two-point profile is entered', async () => {
    const store = useDrivetrainStore()
    store.setEngineTwoPoint({ peakTorqueRpm: 6500, peakPowerRpm: 9000 })
    const wrapper = mountPanel(sessionWithMeasuredScatter())
    await wrapper.vm.$nextTick()
    const chart = wrapper.findComponent(UPlotChart)
    const bands = chart.props('xBands') as Array<{ min: number; max: number }>
    expect(bands).toHaveLength(1)
    expect(bands[0].min).toBe(6500)
    expect(bands[0].max).toBe(store.mt.redlineRpm)
  })

  it('GearRecommendationPanel receives the same session prop as the panel', () => {
    const wrapper = mountPanel()
    const rec = wrapper.findComponent(GearRecommendationPanel)
    expect(rec.props('session')).toBeNull()
  })
})
