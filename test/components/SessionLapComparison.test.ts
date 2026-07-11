// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import SessionLapComparison from '@/features/analyzer/SessionLapComparison.vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useLapStore } from '@/stores/lapStore'
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

function mountWith() {
  return mount(SessionLapComparison, {
    props: {
      primaryLaps: [lap(0, 60_000)],
      primaryExcluded: [],
      comparisons: [comparison()],
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      directives: { tooltip: {} },
    },
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('SessionLapComparison', () => {
  it('renders every compared lap as a per-lap table row with markers', async () => {
    const analyzer = useAnalyzerStore()
    const wrapper = mountWith()

    // No collapsed disclosure — the laps are always visible as a table.
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.text()).toContain('comparison.loga')
    // Unified count wording with the primary table ("圈數：{n}").
    expect(wrapper.text()).toContain('圈數：2')

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    // Row 1 is the fastest lap (⚡), row 2 the slowest (🐢).
    expect(rows[0].text()).toContain('1:01.000')
    expect(rows[0].text()).toContain('⚡')
    expect(rows[1].text()).toContain('1:02.000')
    expect(rows[1].text()).toContain('🐢')

    await wrapper.find('.chart-align button').trigger('click')
    expect(analyzer.sessionOffsetOf(2).timeSec).toBeCloseTo(-0.1)
  })

  it('toggles a lap into the cross-recording overlay via its row checkbox', async () => {
    const lapStore = useLapStore()
    const wrapper = mountWith()

    const checkbox = wrapper.findAll('tbody tr input[type="checkbox"]')[0]
    expect(lapStore.isSessionLapSelected(2, 0)).toBe(false)
    await checkbox.setValue(true)
    expect(lapStore.isSessionLapSelected(2, 0)).toBe(true)
  })
})
