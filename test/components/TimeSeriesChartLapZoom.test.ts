// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TimeSeriesChart from '@/features/analyzer/TimeSeriesChart.vue'
import GearRatioChart from '@/features/analyzer/GearRatioChart.vue'
import UPlotChart from '@/components/UPlotChart.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import type { Lap } from '@/domain/model/Lap'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * B28 regression test — "選圈不再讓圖表 X 軸縮放" (selecting a lap stopped
 * zooming any time-series chart — including the gear-ratio card's chart — to
 * that lap's range; a regression from the B8/B9 chart rework).
 *
 * Root cause (src/features/analyzer/TimeSeriesChart.vue): the `x-bounds` prop
 * handed down to UPlotChart was ALWAYS the full SESSION x-extent, regardless
 * of lap selection. UPlotChart's `applyXRange()` falls back to
 * `dataXBounds()` (which prefers `xBounds` over deriving from the chart's own
 * `data`) whenever `xRange` is null — and `xRange` IS null in lap-selection
 * mode by design (`:x-range="!hasSelection ? xRange : null"` — the
 * lap-relative overlay grid is structurally unrelated to the shared session
 * xRange). So every selection-mode chart got its scale clamped/reset to the
 * whole session's bounds on every lap (re)selection, rendering the overlay's
 * ~lap-duration-wide data as a tiny sliver instead of filling the view — i.e.
 * lap selection visibly stopped zooming the chart.
 *
 * Fix: only pass the session-wide xBounds when `!hasSelection`. In selection
 * mode, `xBounds` is null, so UPlotChart's `dataXBounds()` falls through to
 * computing bounds straight from `props.data[0]` (the overlay's own
 * lap-relative grid) — so the zoom naturally matches the selected lap(s)'
 * extent. GearRatioChart carries no zoom logic of its own; it forwards
 * straight into the same TimeSeriesChart, so it inherits the fix (and the
 * regression) automatically — pinned below too, since the original report
 * called it out explicitly.
 */

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function makeSession(): LogSession {
  return new LogSession(
    [channel('Time', [0, 1, 2, 3, 4]), channel('Speed', [10, 20, 30, 40, 50])],
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

function mountTimeSeriesChart(selectedLaps: Lap[]) {
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

describe('TimeSeriesChart — xBounds gated on lap selection (B28)', () => {
  it('passes the full session xBounds when no lap is selected (session-wide clamp/fallback)', () => {
    const wrapper = mountTimeSeriesChart([])
    const plot = wrapper.findComponent(UPlotChart)
    expect(plot.props('xBounds')).toEqual({ min: 0, max: 4 })
  })

  it('passes null xBounds once a lap is selected, so UPlotChart derives bounds from the overlay data itself instead of the whole session', () => {
    const wrapper = mountTimeSeriesChart([makeLap()])
    const plot = wrapper.findComponent(UPlotChart)
    expect(plot.props('xBounds')).toBeNull()
  })

  it('reverts to the session-wide xBounds once the lap selection is cleared', async () => {
    const wrapper = mountTimeSeriesChart([makeLap()])
    expect(wrapper.findComponent(UPlotChart).props('xBounds')).toBeNull()
    await wrapper.setProps({ selectedLaps: [] })
    expect(wrapper.findComponent(UPlotChart).props('xBounds')).toEqual({ min: 0, max: 4 })
  })
})

describe('GearRatioChart — inherits the B28 xBounds fix from the shared TimeSeriesChart pipeline', () => {
  // The measured-ratio channel (GearRatioChart's own chart) only renders once
  // RPM + a speed channel are both present — unlike the plain TimeSeriesChart
  // tests above, this session needs both so `canRender` is true and UPlotChart
  // actually mounts.
  function makeGearSession(): LogSession {
    return new LogSession(
      [
        channel('Time', [0, 1, 2, 3, 4]),
        channel('RPM', [3000, 3500, 4000, 4500, 5000]),
        channel('GPS_Speed', [60, 60, 60, 60, 60]),
      ],
      { formatId: 'test', createdDate: null, headerInfo: {} },
    )
  }

  function mountGearRatioChart(selectedLaps: Lap[]) {
    const i18n = createI18n({ legacy: false, locale: 'zh-Hant', fallbackLocale: 'en', messages: { 'zh-Hant': zhHant, en } })
    return mount(GearRatioChart, {
      props: {
        session: makeGearSession(),
        xValues: new Float64Array([0, 1, 2, 3, 4]),
        selectedLaps,
      },
      global: {
        plugins: [i18n],
        stubs: { UPlotChart: true, SearchableSelect: true },
      },
    })
  }

  it('passes null xBounds to its underlying chart once a lap is selected (zooms to the lap, not the whole session)', () => {
    const wrapper = mountGearRatioChart([makeLap()])
    const plot = wrapper.findComponent(UPlotChart)
    expect(plot.props('xBounds')).toBeNull()
  })
})
