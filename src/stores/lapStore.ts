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
  // Indices of the laps selected in the table, kept in SELECTION ORDER so each
  // lap's color (assigned by order) stays stable as laps are added/removed.
  // Drives chart zoom and the colored segments on the track map.
  const selected = ref<number[]>([])
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

  /** Add lap `i` to the selection (appended), or remove it when already present. */
  function toggleLap(i: number): void {
    selected.value = selected.value.includes(i)
      ? selected.value.filter((x) => x !== i)
      : [...selected.value, i]
  }

  /** Clear the whole lap selection. */
  function clearSelection(): void {
    selected.value = []
  }

  /** Whether lap `i` is currently selected. */
  function isSelected(i: number): boolean {
    return selected.value.includes(i)
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
    selected,
    columns,
    setLine,
    clearLine,
    setSource,
    toggleLap,
    clearSelection,
    isSelected,
    addColumn,
    removeColumn,
    setColumnChannel,
    setColumnAgg,
  }
})
