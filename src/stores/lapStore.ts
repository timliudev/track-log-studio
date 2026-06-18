import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LapLine } from '@/domain/analysis/laps'

/** How laps are detected: a user-placed start/finish line, or the ECU channel. */
export type LapSource = 'line' | 'ecu'

/** Transient lap-detection UI state: the start/finish line and detection mode. */
export const useLapStore = defineStore('lap', () => {
  // Stored in GEO coords (lat/lon) so it survives canvas resize / refit.
  const line = ref<LapLine | null>(null)
  const source = ref<LapSource>('line')

  function setLine(l: LapLine): void {
    line.value = l
  }

  function clearLine(): void {
    line.value = null
  }

  function setSource(s: LapSource): void {
    source.value = s
  }

  return { line, source, setLine, clearLine, setSource }
})
