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
  let nextId = 2

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

  return { activeFileId, xAxis, charts, addChart, removeChart, setChartChannels }
})
