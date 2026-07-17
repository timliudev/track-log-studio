// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TimeSeriesChart from '@/features/analyzer/TimeSeriesChart.vue'
import UPlotChart from '@/components/UPlotChart.vue'
import SearchableSelect from '@/components/SearchableSelect.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { MEASURED_TOTAL_RATIO_CHANNEL } from '@/domain/analysis/analyzerChannels'
import {
  CVT_FRONT_RADIUS_CHANNEL,
  PURE_CVT_RATIO_CHANNEL,
} from '@/domain/analysis/cvtTrace'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useDrivetrainStore } from '@/stores/drivetrainStore'

function channel(name: string, values: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(values) }
}

const session = new LogSession([
  channel('Time', [0, 100, 200]),
  channel('RPM', [3000, 4000, 5000]),
  channel('GPS_Speed', [60, 60, 60]),
], { formatId: 'test', createdDate: null, headerInfo: {} })

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  setActivePinia(createPinia())
})

function mountChart(channels: string[]) {
  return mount(TimeSeriesChart, {
    props: {
      chart: { kind: 'timeseries', id: 1, channels },
      session,
      xValues: new Float64Array([0, 0.1, 0.2]),
      selectedLaps: [],
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })],
      stubs: { UPlotChart: true, SearchableSelect: true },
    },
  })
}

describe('TimeSeriesChart virtual drivetrain channel', () => {
  it('resolves a persisted stable id into chart data on an independent scale', () => {
    const wrapper = mountChart([MEASURED_TOTAL_RATIO_CHANNEL, 'RPM'])
    const plot = wrapper.findComponent(UPlotChart)
    const data = plot.props('data') as [number[], Array<number | null>, Array<number | null>]
    const series = plot.props('series') as Array<{ label?: string; scale?: string }>
    const axes = plot.props('axes') as Array<{ label?: string; scale?: string }>

    expect(data[0]).toEqual([0, 0.1, 0.2])
    expect(data[1].every((value) => value != null && Number.isFinite(value))).toBe(true)
    expect(series[1].label).toContain('總傳動比')
    expect(series[1].scale).toBe(MEASURED_TOTAL_RATIO_CHANNEL)
    expect(series[2].scale).toBe('RPM')
    expect(axes.slice(1).map((axis) => [axis.scale, axis.label])).toEqual([
      [MEASURED_TOTAL_RATIO_CHANNEL, '總傳動比'],
      ['RPM', 'RPM'],
    ])
    expect(wrapper.find('.update-rate').text()).toBe('10.0 Hz')
  })

  it('shows no chart update rate when every selected channel is constant', () => {
    const wrapper = mountChart(['GPS_Speed'])
    expect(wrapper.find('.update-rate').exists()).toBe(false)
  })

  it('offers a translated picker label while emitting only the stable id', () => {
    const wrapper = mountChart([])
    const picker = wrapper.findComponent(SearchableSelect)
    const options = picker.props('options') as Array<{ name: string; value?: string }>
    expect(options).toContainEqual(expect.objectContaining({
      name: '總傳動比',
      value: MEASURED_TOTAL_RATIO_CHANNEL,
    }))

    picker.vm.$emit('update:modelValue', MEASURED_TOTAL_RATIO_CHANNEL)
    expect(useAnalyzerStore().charts[0]).toEqual({
      kind: 'timeseries',
      id: 1,
      channels: [MEASURED_TOTAL_RATIO_CHANNEL],
    })
  })

  it('offers pure CVT ratio before geometry and unlocks belt position only with complete measurements', () => {
    const drivetrain = useDrivetrainStore()
    drivetrain.setKind('cvt')
    drivetrain.setCvtWheelCircumferenceMm(1000)
    drivetrain.updateCvtProfile(drivetrain.activeCvtProfile.id, {
      gearReduction: { mode: 'ratio', ratio: 1 },
      finalReduction: { mode: 'ratio', ratio: 2 },
    })

    const ratioWrapper = mountChart([PURE_CVT_RATIO_CHANNEL])
    const ratioData = ratioWrapper.findComponent(UPlotChart).props('data') as [number[], Array<number | null>]
    expect(ratioData[1]).toEqual([1.5, 2, 2.5])
    const initialOptions = ratioWrapper.findComponent(SearchableSelect).props('options') as Array<{ value?: string }>
    expect(initialOptions.some((option) => option.value === CVT_FRONT_RADIUS_CHANNEL)).toBe(false)

    drivetrain.updateCvtProfile(drivetrain.activeCvtProfile.id, {
      belt: { lengthSource: 'pitch', pitchLengthMm: 650 },
      geometry: {
        centerDistanceMm: 190,
        frontSheaveAngle: { valueDeg: 14, basis: 'half' },
        rearSheaveAngle: { valueDeg: 14, basis: 'half' },
        frontRadiusBoundsMm: { min: 25, max: 90 },
        rearRadiusBoundsMm: { min: 25, max: 100 },
      },
    })
    const geometryWrapper = mountChart([])
    const completeOptions = geometryWrapper.findComponent(SearchableSelect).props('options') as Array<{ value?: string }>
    expect(completeOptions.some((option) => option.value === CVT_FRONT_RADIUS_CHANNEL)).toBe(true)
  })

  it('derives the channel independently for every compared session', () => {
    const comparison = new LogSession([
      channel('Time', [0, 100, 200]),
      channel('RPM', [6000, 7000, 8000]),
      channel('GPS_Speed', [60, 60, 60]),
    ], { formatId: 'test', createdDate: null, headerInfo: {} })
    const wrapper = mount(TimeSeriesChart, {
      props: {
        chart: { kind: 'timeseries', id: 1, channels: [MEASURED_TOTAL_RATIO_CHANNEL] },
        session,
        xValues: new Float64Array([0, 0.1, 0.2]),
        selectedLaps: [],
        primaryFileId: 1,
        primaryFileName: 'A',
        comparisonSessions: [{
          id: 2,
          name: 'B',
          color: '#123456',
          session: comparison,
          xValues: new Float64Array([0, 0.1, 0.2]),
          track: { lat: new Float64Array(3), lon: new Float64Array(3), valid: new Uint8Array(3) },
          timeMs: new Float64Array([0, 100, 200]),
          laps: [],
        }],
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })],
        stubs: { UPlotChart: true, SearchableSelect: true },
      },
    })
    const plot = wrapper.findComponent(UPlotChart)
    const series = plot.props('series') as Array<{ label?: string }>
    expect(series.map((entry) => entry.label)).toEqual(['s', 'A · 總傳動比', 'B · 總傳動比'])
  })
})
