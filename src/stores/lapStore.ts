import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LapLine } from '@/domain/analysis/laps'
import type { Aggregation } from '@/domain/analysis/lapAggregate'

/** How laps are detected: a user-placed start/finish line, or the ECU channel. */
export type LapSource = 'line' | 'ecu'

/**
 * One configurable statistics column in the lap table: a channel aggregated
 * (max/min/avg) over each lap's sample span. `channel` may be '' until the user
 * picks one (rendered as '—' meanwhile). `id` is a stable, unique handle.
 */
export interface LapColumn {
  id: number
  channel: string
  agg: Aggregation
}

/** Transient lap-detection UI state: the start/finish line and detection mode. */
export const useLapStore = defineStore('lap', () => {
  // Stored in GEO coords (lat/lon) so it survives canvas resize / refit.
  const line = ref<LapLine | null>(null)
  const source = ref<LapSource>('line')
  // Index of the lap selected in the table (null = none); drives chart zoom and
  // the highlighted segment on the track map.
  const selectedIndex = ref<number | null>(null)
  // User-configured statistics columns for the lap table.
  const columns = ref<LapColumn[]>([])
  // Monotonic id source so column ids stay unique across add/remove.
  let nextColumnId = 1

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

  function addColumn(channel: string, agg: Aggregation): void {
    columns.value.push({ id: nextColumnId++, channel, agg })
  }

  function removeColumn(id: number): void {
    columns.value = columns.value.filter((c) => c.id !== id)
  }

  function setColumnChannel(id: number, channel: string): void {
    const col = columns.value.find((c) => c.id === id)
    if (col) col.channel = channel
  }

  function setColumnAgg(id: number, agg: Aggregation): void {
    const col = columns.value.find((c) => c.id === id)
    if (col) col.agg = agg
  }

  return {
    line,
    source,
    selectedIndex,
    columns,
    setLine,
    clearLine,
    setSource,
    selectLap,
    toggleLap,
    addColumn,
    removeColumn,
    setColumnChannel,
    setColumnAgg,
  }
})
