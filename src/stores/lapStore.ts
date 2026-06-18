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
  // Index of the lap selected in the table (null = none); drives chart zoom and
  // the highlighted segment on the track map.
  const selectedIndex = ref<number | null>(null)

  function setLine(l: LapLine): void {
    line.value = l
  }

  function clearLine(): void {
    line.value = null
  }

  function setSource(s: LapSource): void {
    source.value = s
  }

  function selectLap(i: number | null): void {
    selectedIndex.value = i
  }

  /** Select lap `i`, or deselect when it is already the selected one. */
  function toggleLap(i: number): void {
    selectedIndex.value = selectedIndex.value === i ? null : i
  }

  return {
    line,
    source,
    selectedIndex,
    setLine,
    clearLine,
    setSource,
    selectLap,
    toggleLap,
  }
})
