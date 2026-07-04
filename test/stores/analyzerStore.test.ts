import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
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

  it('addChart("scatter") appends a scatter chart, defaulting to empty pickers', () => {
    const s = useAnalyzerStore()
    s.addChart('scatter')
    const chart = s.charts[1]
    expect(chart.kind).toBe('scatter')
    if (chart.kind === 'scatter') {
      expect(chart.xChannel).toBeNull()
      expect(chart.yChannel).toBeNull()
    }
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

  it('setChartXY / setChartChannels / setChartMode are no-ops on the wrong chart kind', () => {
    const s = useAnalyzerStore()
    const timeseriesId = s.charts[0].id
    s.addChart('scatter')
    const scatterId = s.charts[1].id
    // Wrong-kind calls shouldn't throw and shouldn't mutate anything.
    s.setChartXY(timeseriesId, 'x', 'RPM')
    s.setChartChannels(scatterId, ['RPM'])
    s.setChartMode(scatterId, 'overlay')
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
})
