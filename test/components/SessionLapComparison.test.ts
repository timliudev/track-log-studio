// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import SessionLapComparison from '@/features/analyzer/SessionLapComparison.vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { LogSession } from '@/domain/model/LogSession'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import type { Lap } from '@/domain/model/Lap'
import zhHant from '@/i18n/locales/zh-Hant'

const lap = (index: number, lapTimeMs: number): Lap => ({
  index,
  lapTimeMs,
  startIdx: index * 2,
  endIdx: index * 2 + 2,
})

function comparison(): ComparisonSession {
  const session = new LogSession([], { formatId: 'test', createdDate: null, headerInfo: {} })
  return {
    id: 2,
    name: 'comparison.loga',
    color: '#ff0000',
    session,
    xValues: new Float64Array(),
    track: { lat: new Float64Array(), lon: new Float64Array(), valid: new Uint8Array() },
    timeMs: new Float64Array(),
    laps: [lap(0, 61_000), lap(1, 62_000)],
  }
}

beforeEach(() => setActivePinia(createPinia()))

describe('SessionLapComparison', () => {
  it('shows every compared recording lap without a collapsed disclosure', async () => {
    const analyzer = useAnalyzerStore()
    const wrapper = mount(SessionLapComparison, {
      props: {
        primaryLaps: [lap(0, 60_000)],
        primaryExcluded: [],
        comparisons: [comparison()],
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      },
    })

    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.text()).toContain('comparison.loga')
    expect(wrapper.text()).toContain('#1 · 1:01.000')
    expect(wrapper.text()).toContain('#2 · 1:02.000')

    await wrapper.find('.chart-align button').trigger('click')
    expect(analyzer.sessionOffsetOf(2).timeSec).toBeCloseTo(-0.1)
  })
})
