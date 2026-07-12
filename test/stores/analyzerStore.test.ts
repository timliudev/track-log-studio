import { setActivePinia, createPinia } from 'pinia'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('analyzerStore', () => {
  it('starts with one empty timeseries chart and a time x-axis', () => {
    const s = useAnalyzerStore()
    expect(s.xAxis).toBe('time')
    expect(s.charts).toHaveLength(1)
    expect(s.charts[0].kind).toBe('timeseries')
    if (s.charts[0].kind === 'timeseries') expect(s.charts[0].channels).toEqual([])
  })

  it('addChart() / addChart("timeseries") appends a timeseries chart with a new id', () => {
    const s = useAnalyzerStore()
    const firstId = s.charts[0].id
    s.addChart()
    expect(s.charts).toHaveLength(2)
    expect(s.charts[1].id).not.toBe(firstId)
    expect(s.charts[1].kind).toBe('timeseries')
  })

  it('addChart("scatter") appends a scatter chart, defaulting to empty pickers and AUTO axes (no force pair yet)', () => {
    const s = useAnalyzerStore()
    s.addChart('scatter')
    const chart = s.charts[1]
    expect(chart.kind).toBe('scatter')
    if (chart.kind === 'scatter') {
      expect(chart.xChannel).toBeNull()
      expect(chart.yChannel).toBeNull()
      expect(chart.equalAspect).toBe(false)
      expect(chart.colorChannel).toBeNull()
    }
  })

  it('addChart("scatter", initial) defaults equalAspect true for a force/acceleration pair', () => {
    const s = useAnalyzerStore()
    s.addChart('scatter', { xChannel: 'TC_Xforce', yChannel: 'TC_Yforce' })
    const chart = s.charts[1]
    if (chart.kind === 'scatter') expect(chart.equalAspect).toBe(true)
  })

  it('addChart("scatter", initial) defaults equalAspect false for an arbitrary (non-force) pair — #5 fix', () => {
    const s = useAnalyzerStore()
    s.addChart('scatter', { xChannel: 'RPM', yChannel: 'Vehicle_Speed' })
    const chart = s.charts[1]
    if (chart.kind === 'scatter') expect(chart.equalAspect).toBe(false)
  })

  it('addChart("scatter", initial) defaults equalAspect false when only one side looks like force', () => {
    const s = useAnalyzerStore()
    s.addChart('scatter', { xChannel: 'TC_Xforce', yChannel: 'RPM' })
    const chart = s.charts[1]
    if (chart.kind === 'scatter') expect(chart.equalAspect).toBe(false)
  })

  it('setChartEqualAspect toggles only the targeted scatter chart; no-op on timeseries', () => {
    const s = useAnalyzerStore()
    const timeseriesId = s.charts[0].id
    s.addChart('scatter')
    s.addChart('scatter')
    const [id1, id2] = [s.charts[1].id, s.charts[2].id]
    s.setChartEqualAspect(id1, true)
    s.setChartEqualAspect(timeseriesId, true) // wrong kind — must not throw/mutate
    const c1 = s.charts.find((c) => c.id === id1)
    const c2 = s.charts.find((c) => c.id === id2)
    if (c1?.kind === 'scatter') expect(c1.equalAspect).toBe(true)
    // id2 was never touched — still at its (no-force-pair) default, proving
    // the toggle above only affected id1.
    if (c2?.kind === 'scatter') expect(c2.equalAspect).toBe(false)
    s.setChartEqualAspect(id1, false)
    if (c1?.kind === 'scatter') expect(c1.equalAspect).toBe(false)
  })

  it('setChartColorChannel sets/clears only the targeted scatter chart; no-op on timeseries', () => {
    const s = useAnalyzerStore()
    const timeseriesId = s.charts[0].id
    s.addChart('scatter')
    s.addChart('scatter')
    const [id1, id2] = [s.charts[1].id, s.charts[2].id]
    s.setChartColorChannel(id1, 'Vehicle_Speed')
    s.setChartColorChannel(timeseriesId, 'RPM') // wrong kind — must not throw/mutate
    const c1 = s.charts.find((c) => c.id === id1)
    const c2 = s.charts.find((c) => c.id === id2)
    if (c1?.kind === 'scatter') expect(c1.colorChannel).toBe('Vehicle_Speed')
    // id2 was never touched — still at its default null.
    if (c2?.kind === 'scatter') expect(c2.colorChannel).toBeNull()
    const ts = s.charts.find((c) => c.id === timeseriesId)
    if (ts?.kind === 'timeseries') expect(ts).not.toHaveProperty('colorChannel')
    s.setChartColorChannel(id1, null)
    if (c1?.kind === 'scatter') expect(c1.colorChannel).toBeNull()
  })

  it('addChart("scatter", initial) seeds the initial X/Y channels', () => {
    const s = useAnalyzerStore()
    s.addChart('scatter', { xChannel: 'TC_Xforce', yChannel: 'TC_Yforce' })
    const chart = s.charts[1]
    expect(chart.kind).toBe('scatter')
    if (chart.kind === 'scatter') {
      expect(chart.xChannel).toBe('TC_Xforce')
      expect(chart.yChannel).toBe('TC_Yforce')
    }
  })

  it('setChartXY updates only the targeted scatter chart, one axis at a time', () => {
    const s = useAnalyzerStore()
    s.addChart('scatter')
    s.addChart('scatter')
    const [id1, id2] = [s.charts[1].id, s.charts[2].id]
    s.setChartXY(id1, 'x', 'RPM')
    s.setChartXY(id1, 'y', 'Vehicle_Speed')
    const c1 = s.charts.find((c) => c.id === id1)
    const c2 = s.charts.find((c) => c.id === id2)
    if (c1?.kind === 'scatter') {
      expect(c1.xChannel).toBe('RPM')
      expect(c1.yChannel).toBe('Vehicle_Speed')
    }
    if (c2?.kind === 'scatter') {
      expect(c2.xChannel).toBeNull()
      expect(c2.yChannel).toBeNull()
    }
  })

  it('setChartXY / setChartChannels are no-ops on the wrong chart kind', () => {
    const s = useAnalyzerStore()
    const timeseriesId = s.charts[0].id
    s.addChart('scatter')
    const scatterId = s.charts[1].id
    // Wrong-kind calls shouldn't throw and shouldn't mutate anything.
    s.setChartXY(timeseriesId, 'x', 'RPM')
    s.setChartChannels(scatterId, ['RPM'])
    const ts = s.charts.find((c) => c.id === timeseriesId)
    const sc = s.charts.find((c) => c.id === scatterId)
    if (ts?.kind === 'timeseries') expect(ts.channels).toEqual([])
    if (sc?.kind === 'scatter') {
      expect(sc.xChannel).toBeNull()
      expect(sc.yChannel).toBeNull()
    }
  })

  it('setChartChannels updates the targeted chart only', () => {
    const s = useAnalyzerStore()
    s.addChart()
    const id = s.charts[0].id
    s.setChartChannels(id, ['RPM', 'T_Eng'])
    const c0 = s.charts[0]
    const c1 = s.charts[1]
    if (c0.kind === 'timeseries') expect(c0.channels).toEqual(['RPM', 'T_Eng'])
    if (c1.kind === 'timeseries') expect(c1.channels).toEqual([])
  })

  it('removeChart removes the chart', () => {
    const s = useAnalyzerStore()
    s.addChart()
    const id = s.charts[0].id
    s.removeChart(id)
    expect(s.charts.some((c) => c.id === id)).toBe(false)
  })

  it('setXRange holds and clears the shared zoom range', () => {
    const s = useAnalyzerStore()
    expect(s.xRange).toBeNull()
    s.setXRange({ min: 1, max: 5 })
    expect(s.xRange).toEqual({ min: 1, max: 5 })
    s.setXRange(null)
    expect(s.xRange).toBeNull()
  })

  it('setCursor holds and clears the shared hovered sample index', () => {
    const s = useAnalyzerStore()
    expect(s.cursorIdx).toBeNull()
    s.setCursor(42)
    expect(s.cursorIdx).toBe(42)
    s.setCursor(null)
    expect(s.cursorIdx).toBeNull()
  })

  it('toggleSessionComparison adds/removes a file id from the global comparison set', () => {
    const s = useAnalyzerStore()
    expect(s.selectedSessions).toEqual([])
    s.toggleSessionComparison(7)
    expect(s.selectedSessions).toEqual([7])
    s.toggleSessionComparison(9)
    expect(s.selectedSessions).toEqual([7, 9])
    s.toggleSessionComparison(7)
    expect(s.selectedSessions).toEqual([9])
  })

  it('holds independent per-session alignment offsets and resets them', () => {
    const s = useAnalyzerStore()
    expect(s.sessionOffsetOf(7)).toEqual({ timeSec: 0, distM: 0, mapX: 0, mapY: 0 })
    s.nudgeSessionOffset(7, 'timeSec', 0.5)
    s.nudgeSessionOffset(7, 'distM', -2)
    s.setSessionOffset(7, 'mapX', 3)
    expect(s.sessionOffsetOf(7)).toEqual({ timeSec: 0.5, distM: -2, mapX: 3, mapY: 0 })
    s.resetSessionOffset(7, 'timeSec')
    expect(s.sessionOffsetOf(7).timeSec).toBe(0)
    s.resetSessionOffset(7)
    expect(s.sessionOffsets).toEqual({})
  })

  it('clearSessionComparisons leaves offsets available for re-selecting a session', () => {
    const s = useAnalyzerStore()
    s.toggleSessionComparison(1)
    s.nudgeSessionOffset(1, 'timeSec', 1)
    s.clearSessionComparisons()
    expect(s.selectedSessions).toEqual([])
    expect(s.sessionOffsetOf(1).timeSec).toBe(1)
  })
})

/** T5 — chart-card persistence: added charts + their config survive a
 *  "reload" (fresh pinia instance re-runs the store setup, which re-loads
 *  from localStorage). In-memory localStorage stub, same approach as
 *  dashboardLayout.test.ts. */
describe('analyzerStore — chart persistence (T5)', () => {
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

  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dynamically added charts + config are restored by a fresh store (reload)', async () => {
    const s = useAnalyzerStore()
    s.addChart()
    s.setChartChannels(s.charts[1].id, ['RPM', 'T_Eng'])
    s.addChart('scatter', { xChannel: 'TC_Xforce', yChannel: 'TC_Yforce' })
    await nextTick() // deep watch persists on the next flush

    // Simulated reload: a fresh pinia re-runs the store setup -> loadCharts().
    setActivePinia(createPinia())
    const s2 = useAnalyzerStore()
    expect(s2.charts).toEqual([
      { kind: 'timeseries', id: 1, channels: [] },
      { kind: 'timeseries', id: 2, channels: ['RPM', 'T_Eng'] },
      { kind: 'scatter', id: 3, xChannel: 'TC_Xforce', yChannel: 'TC_Yforce', equalAspect: true, colorChannel: null },
    ])
  })

  it('a picked colour-axis channel survives reload (persisted with the chart card)', async () => {
    const s = useAnalyzerStore()
    s.addChart('scatter', { xChannel: 'TC_Xforce', yChannel: 'TC_Yforce' })
    s.setChartColorChannel(s.charts[1].id, 'Vehicle_Speed')
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useAnalyzerStore()
    const restored = s2.charts.find((c) => c.kind === 'scatter')
    expect(restored?.kind).toBe('scatter')
    if (restored?.kind === 'scatter') expect(restored.colorChannel).toBe('Vehicle_Speed')
  })

  it('a toggled-off equalAspect survives reload (persisted with the chart card)', async () => {
    const s = useAnalyzerStore()
    s.addChart('scatter', { xChannel: 'RPM', yChannel: 'Vehicle_Speed' })
    s.setChartEqualAspect(s.charts[1].id, false)
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useAnalyzerStore()
    const restored = s2.charts.find((c) => c.kind === 'scatter')
    expect(restored?.kind).toBe('scatter')
    if (restored?.kind === 'scatter') expect(restored.equalAspect).toBe(false)
  })

  it('new ids continue past the restored maximum (no card-id collisions)', async () => {
    const s = useAnalyzerStore()
    s.addChart()
    await nextTick()
    setActivePinia(createPinia())
    const s2 = useAnalyzerStore()
    s2.addChart('scatter')
    expect(s2.charts.map((c) => c.id)).toEqual([1, 2, 3])
  })

  it('an emptied dashboard (every chart removed) survives reload as empty', async () => {
    const s = useAnalyzerStore()
    s.removeChart(s.charts[0].id)
    await nextTick()
    setActivePinia(createPinia())
    expect(useAnalyzerStore().charts).toHaveLength(0)
  })

  it('falls back to the single default chart when storage is corrupt', () => {
    localStorage.setItem('aracer-loga.analyzerCharts.v1', '{corrupt')
    setActivePinia(createPinia())
    const s = useAnalyzerStore()
    expect(s.charts).toEqual([{ kind: 'timeseries', id: 1, channels: [] }])
  })
})
