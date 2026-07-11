// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearRatioChart from '@/features/analyzer/GearRatioChart.vue'
import TimeSeriesChart from '@/features/analyzer/TimeSeriesChart.vue'
import UPlotChart from '@/components/UPlotChart.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'
import { MEASURED_TOTAL_RATIO_CHANNEL } from '@/domain/analysis/analyzerChannels'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function makeSession(includeSpeed = true): LogSession {
  const channels = [channel('Time', [0, 100, 200]), channel('RPM', [3000, 4000, 5000])]
  if (includeSpeed) channels.push(channel('GPS_Speed', [60, 60, 60]))
  return new LogSession(channels, { formatId: 'test', createdDate: null, headerInfo: {} })
}

function mountChart(session: LogSession) {
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })
  return mount(GearRatioChart, {
    props: {
      mode: 'timeline',
      session,
      xValues: new Float64Array([0, 0.1, 0.2]),
      selectedLaps: [],
    },
    global: {
      plugins: [i18n],
      stubs: { TimeSeriesChart: true },
    },
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  setActivePinia(createPinia())
})

describe('GearRatioChart', () => {
  it('feeds an index-aligned derived ratio into the shared TimeSeriesChart pipeline', () => {
    const wrapper = mountChart(makeSession())
    const plot = wrapper.findComponent(TimeSeriesChart)
    expect(plot.props('chart')).toBeUndefined()
    expect(plot.props('mode')).toBe('timeline')
    expect(plot.props('channelIds')).toEqual([MEASURED_TOTAL_RATIO_CHANNEL])
    expect(plot.props('lockedChannels')).toEqual([MEASURED_TOTAL_RATIO_CHANNEL])

    plot.vm.$emit('updateMode', 'overlay')
    expect(wrapper.emitted('updateMode')).toEqual([['overlay']])
  })

  it('keeps the shared chart pipeline without a separate removable card and supplies a useful prerequisite error', () => {
    const wrapper = mountChart(makeSession(false))
    const plot = wrapper.findComponent(TimeSeriesChart)
    expect(plot.props('channelIds')).toEqual([MEASURED_TOTAL_RATIO_CHANNEL])
    expect(plot.props('emptyMessage')).toContain('缺少速度')
  })

  it('lets the embedded calculator chart add raw channels while retaining the measured ratio', async () => {
    const wrapper = mountChart(makeSession())
    const plot = wrapper.findComponent(TimeSeriesChart)
    plot.vm.$emit('updateChannels', [MEASURED_TOTAL_RATIO_CHANNEL, 'RPM'])
    await wrapper.vm.$nextTick()

    expect(wrapper.findComponent(TimeSeriesChart).props('channelIds')).toEqual([
      MEASURED_TOTAL_RATIO_CHANNEL,
      'RPM',
    ])
  })

  it('feeds the derived ratio through the aligned timeline builder', async () => {
    const i18n = createI18n({
      legacy: false,
      locale: 'zh-Hant',
      fallbackLocale: 'en',
      messages: { 'zh-Hant': zhHant, en },
    })
    const wrapper = mount(GearRatioChart, {
      props: {
        mode: 'timeline',
        session: makeSession(),
        xValues: new Float64Array([0, 0.1, 0.2]),
        selectedLaps: [],
      },
      global: {
        plugins: [i18n],
        stubs: { UPlotChart: true, SearchableSelect: true },
      },
    })
    await wrapper.vm.$nextTick()

    const plot = wrapper.findComponent(UPlotChart)
    const data = plot.props('data') as [number[], Array<number | null>]
    expect(data[0]).toEqual([0, 0.1, 0.2])
    expect(data[1]).toHaveLength(3)
    expect(data[1].every((value) => value != null && Number.isFinite(value))).toBe(true)
  })
})
