// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearPanel from '@/features/analyzer/GearPanel.vue'
import GearRatioChart from '@/features/analyzer/GearRatioChart.vue'
import UPlotChart from '@/components/UPlotChart.vue'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * #8 — "齒比計算機圖表:滑鼠滑過有數值,但線條沒畫出來" (the gear-ratio
 * calculator's chart: hovering shows a value in the tooltip/legend, but no
 * line is actually drawn).
 *
 * Root cause: `mtChartData` merges the measured RPM/speed scatter and every
 * gear's 41-point theoretical speed(rpm) line onto ONE shared x-axis (uPlot's
 * AlignedData requires a single shared x-array across all series). A real log
 * session contributes far more distinct RPM samples than 41, so at nearly
 * every shared x-position a theoretical line's y-value is null (the scatter
 * has a sample there, the line doesn't). uPlot's default line renderer DOES
 * draw path segments connecting real point to real point through those
 * nulls, but then (since `spanGaps` defaults to false) CLIPS the segment
 * wherever it detects a null run — and here the null runs cover almost the
 * entire span between any two of the line's 41 real points, so virtually the
 * whole line gets clipped away. The cursor/legend value lookup is unaffected
 * by that clip (it just reads the nearest/interpolated y at the hovered x),
 * which is exactly why hovering still shows a number while nothing is drawn.
 * The fix sets `spanGaps: true` on each gear-line series so the connecting
 * segments aren't clipped.
 */

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** A realistic-shaped MT session: RPM ramps 1000->9000 over many DENSE
 *  samples (far more than the theoretical line's 41 points), with speed
 *  following the DEFAULT_MT gear-1 reduction so the panel's default spec
 *  resolves valid results and a non-empty measured scatter — reproducing the
 *  real "dense scatter sharing the shared x-axis with a sparse line" shape
 *  that triggers the uPlot gap-clipping bug. */
function denseMtSession(n = 500): LogSession {
  const rpm: number[] = []
  const speed: number[] = []
  for (let i = 0; i < n; i++) {
    const r = 1000 + (8000 * i) / (n - 1)
    rpm.push(r)
    // Arbitrary monotonic speed so the scatter has real (non-degenerate) data;
    // the exact mapping doesn't matter for this test — only that RPM has many
    // more distinct values than the theoretical line's 41 points.
    speed.push(r / 200)
  }
  return new LogSession(
    [channel('RPM', rpm), channel('GPS_Speed', speed)],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

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

function mountPanel(
  session: LogSession | null,
  extra: Record<string, unknown> = {},
) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(GearPanel, {
    props: { session, ...extra },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
}

describe('GearPanel — MT gear-ratio chart lines actually render (#8)', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
    installFakeCanvasContext()
    setActivePinia(createPinia())
  })

  it('renders the MT overlay chart with the measured scatter + per-gear theoretical lines', () => {
    const wrapper = mountPanel(denseMtSession())
    const chart = wrapper.findComponent(UPlotChart)
    expect(chart.exists()).toBe(true)

    const series = chart.props('series')
    // series[0] is uPlot's required x-axis placeholder; series[1] is the
    // measured scatter (points only, no line — that's correct, unaffected by
    // this bug); series[2+] are the per-gear theoretical lines.
    expect(series.length).toBeGreaterThan(2)
    const gearLines = series.slice(2)
    expect(gearLines.length).toBeGreaterThan(0)

    for (const s of gearLines) {
      // The actual #8 fix: without this, uPlot clips away the connecting
      // path segments wherever the shared-x-axis merge introduces a null run
      // (see this file's header doc) — the line data exists (hover/legend
      // shows a value) but nothing visible gets drawn.
      expect(s.spanGaps).toBe(true)
      // Sanity: still a real line (not accidentally turned into a scatter).
      expect(s.stroke).not.toBe('transparent')
      expect(s.points?.show).toBe(false)
    }

    // The measured scatter itself must stay a pure scatter (no spanGaps
    // needed/expected — it never had a "line" to begin with).
    const scatter = series[1]
    expect(scatter.stroke).toBe('transparent')
  })

  it('the shared x-axis really does interleave far more scatter x-positions than the 41 line points (reproduces the gap-clipping shape)', () => {
    const wrapper = mountPanel(denseMtSession())
    const chart = wrapper.findComponent(UPlotChart)
    const data = chart.props('data') as (number | null)[][]
    const xs = data[0]
    const gearLineY = data[2] as (number | null)[]
    const nonNullCount = gearLineY.filter((v) => v != null).length
    // The theoretical line samples 41 points (steps=40, inclusive) — far
    // fewer than the shared axis's total length once the dense scatter's RPM
    // samples are merged in.
    expect(nonNullCount).toBeLessThanOrEqual(41)
    expect(xs.length).toBeGreaterThan(nonNullCount * 3)
  })

  it('renders the CVT ratio-vs-speed sweep with a visible line and points', async () => {
    const wrapper = mountPanel(denseMtSession())
    useDrivetrainStore().setKind('cvt')
    await wrapper.vm.$nextTick()

    const charts = wrapper.findAllComponents(UPlotChart)
    expect(charts).toHaveLength(1)
    const sweep = charts[0].props('series')[1]

    // Regression: stroke was `transparent` and the points inherited that
    // transparent colour. Data and hover values existed, but no pixels were
    // visible in the chart.
    expect(sweep.stroke).not.toBe('transparent')
    expect(sweep.width).toBeGreaterThan(0)
    expect(sweep.points?.show).toBe(true)
    expect(sweep.points?.stroke).not.toBe('transparent')
    expect(sweep.points?.fill).not.toBe('transparent')
  })

  it('embeds the synchronized ratio trace in the calculator card and forwards chart sync events', () => {
    const xValues = new Float64Array([0, 0.1, 0.2])
    const wrapper = mountPanel(denseMtSession(3), {
      xValues,
      xRange: { min: 0, max: 0.2 },
      externalCursor: 1,
      selectedLaps: [],
      gearRatioMode: 'overlay',
    })
    const ratio = wrapper.findComponent(GearRatioChart)

    expect(ratio.exists()).toBe(true)
    expect(ratio.props('mode')).toBe('overlay')
    expect(ratio.props('xValues')).toBe(xValues)
    expect(ratio.props('xRange')).toEqual({ min: 0, max: 0.2 })
    expect(ratio.props('externalCursor')).toBe(1)

    ratio.vm.$emit('cursor', 2)
    ratio.vm.$emit('xZoom', { min: 0.05, max: 0.15 })
    ratio.vm.$emit('updateMode', 'timeline')
    expect(wrapper.emitted('cursor')).toEqual([[2]])
    expect(wrapper.emitted('xZoom')).toEqual([[{ min: 0.05, max: 0.15 }]])
    expect(wrapper.emitted('updateGearRatioMode')).toEqual([['timeline']])
  })
})
