import { defineStore } from 'pinia'
import { ref } from 'vue'

export type XAxis = 'time' | 'distance'

/** Transient analyzer UI state. The data itself comes from converterStore. */
export const useAnalyzerStore = defineStore('analyzer', () => {
  const activeFileId = ref<number | null>(null)
  const xAxis = ref<XAxis>('time')
  /** Channel names plotted on the time-series chart. */
  const selectedChannels = ref<string[]>([])

  return { activeFileId, xAxis, selectedChannels }
})
