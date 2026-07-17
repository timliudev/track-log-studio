// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TimeSeriesChart from '@/features/analyzer/TimeSeriesChart.vue'
import UPlotChart from '@/components/UPlotChart.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import type { Lap } from '@/domain/model/Lap'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * B8 — the old "timeline"/"overlay" mode TOGGLE was removed; overlay is now
 * the only display, and with NO lap selected it must fall back to showing
 * the full session (not blank — the old overlay mode used to render NOTHING
 * without a lap selection, which is the bug this replaces). These tests pin
 * that fallback behaviour and its lap-selected counterpart directly against
 * TimeSeriesChart's rendering, independent of any mode prop (which no longer
 * exists on the component at all).
 */

function channel(name: string, data: number[], unit?: string): Channel {
  return { name, rawName: name, description: undefined, unit, data: new Float32Array(data) }
}

function makeSession(): LogSession {
  return new LogSession(
    [channel('Time', [0, 1, 2, 3, 4], 'ms'), channel('Speed', [10, 20, 30, 40, 50], 'km/h')],
    { formatId: 'test', createdDate: null, headerInfo: {} },
  )
}

function makeLap(overrides: Partial<Lap> = {}): Lap {
  return {
    index: 0,
    startIdx: 0,
    endIdx: 4,
    lapTimeMs: 4000,
    ...overrides,
  }
}

function mountChart(selectedLaps: Lap[]) {
  const i18n = createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })
  return mount(TimeSeriesChart, {
    props: {
      chart: { kind: 'timeseries', id: 1, channels: ['Speed'] },
      session: makeSession(),
      xValues: new Float64Array([0, 1, 2, 3, 4]),
      selectedLaps,
    },
    global: {
      plugins: [i18n],
      stubs: { UPlotChart: true, SearchableSelect: true },
    },
  })
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  setActivePinia(createPinia())
})

describe('TimeSeriesChart — overlay fallback with no lap selected (B8)', () => {
  it('renders the full-session data (not blank) when no lap is selected', () => {
    const wrapper = mountChart([])
    const plot = wrapper.findComponent(UPlotChart)
    expect(plot.exists()).toBe(true)
    const data = plot.props('data') as [number[], Array<number | null>]
    // Full session on the session-wide X (not a lap-relative grid).
    expect(data[0]).toEqual([0, 1, 2, 3, 4])
    expect(data[1]).toEqual([10, 20, 30, 40, 50])
    expect((plot.props('series') as Array<{ scale?: string }>)[1].scale).toBe('unit:km/h')
    // No "select laps to see anything" hint any more — there's nothing to
    // show in its place since the fallback always renders.
    expect(wrapper.text()).not.toContain('疊比')
  })

  it('switches to the lap-relative overlay once a lap is selected', () => {
    const wrapper = mountChart([makeLap()])
    const plot = wrapper.findComponent(UPlotChart)
    expect(plot.exists()).toBe(true)
    const data = plot.props('data') as [number[], Array<number | null>]
    // The lap-relative grid starts at 0 regardless of the lap's absolute X.
    expect(data[0][0]).toBe(0)
    expect((plot.props('series') as Array<{ scale?: string }>)[1].scale).toBe('unit:km/h')
  })

  it('forwards xZoom to the parent only while no lap is selected', () => {
    const noSelection = mountChart([])
    noSelection.findComponent(UPlotChart).vm.$emit('xZoom', { min: 1, max: 3 })
    expect(noSelection.emitted('xZoom')).toEqual([[{ min: 1, max: 3 }]])

    const withSelection = mountChart([makeLap()])
    withSelection.findComponent(UPlotChart).vm.$emit('xZoom', { min: 1, max: 3 })
    expect(withSelection.emitted('xZoom')).toBeUndefined()
  })
})
