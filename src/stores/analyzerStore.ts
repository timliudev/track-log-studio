import { defineStore } from 'pinia'
import { ref } from 'vue'

export type XAxis = 'time' | 'distance'

/** One chart on the analyzer dashboard. (type fixed to time-series until 4e.) */
export interface ChartConfig {
  id: number
  channels: string[]
}

/** Transient analyzer UI state. The data itself comes from converterStore. */
export const useAnalyzerStore = defineStore('analyzer', () => {
  const activeFileId = ref<number | null>(null)
  const xAxis = ref<XAxis>('time')
  const charts = ref<ChartConfig[]>([{ id: 1, channels: [] }])
  // Shared X-axis zoom range across all charts (null = auto / full extent).
  const xRange = ref<{ min: number; max: number } | null>(null)
  let nextId = 2

  function setXRange(range: { min: number; max: number } | null): void {
    xRange.value = range
  }

  function addChart(): void {
    charts.value.push({ id: nextId++, channels: [] })
  }

  function removeChart(id: number): void {
    charts.value = charts.value.filter((c) => c.id !== id)
  }

  function setChartChannels(id: number, channels: string[]): void {
    const chart = charts.value.find((c) => c.id === id)
    if (chart) chart.channels = channels
  }

  return {
    activeFileId,
    xAxis,
    charts,
    xRange,
    setXRange,
    addChart,
    removeChart,
    setChartChannels,
  }
})
