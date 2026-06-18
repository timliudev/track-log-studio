import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useAnalyzerStore } from '@/stores/analyzerStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('analyzerStore', () => {
  it('starts with one empty chart and a time x-axis', () => {
    const s = useAnalyzerStore()
    expect(s.xAxis).toBe('time')
    expect(s.charts).toHaveLength(1)
    expect(s.charts[0].channels).toEqual([])
  })

  it('addChart appends a chart with a new id', () => {
    const s = useAnalyzerStore()
    const firstId = s.charts[0].id
    s.addChart()
    expect(s.charts).toHaveLength(2)
    expect(s.charts[1].id).not.toBe(firstId)
  })

  it('setChartChannels updates the targeted chart only', () => {
    const s = useAnalyzerStore()
    s.addChart()
    const id = s.charts[0].id
    s.setChartChannels(id, ['RPM', 'T_Eng'])
    expect(s.charts[0].channels).toEqual(['RPM', 'T_Eng'])
    expect(s.charts[1].channels).toEqual([])
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
