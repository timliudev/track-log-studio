import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useLapStore } from '@/stores/lapStore'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('lapStore', () => {
  it('starts with no line and a line source', () => {
    const s = useLapStore()
    expect(s.line).toBeNull()
    expect(s.source).toBe('line')
  })

  it('setLine holds the line and clearLine resets it', () => {
    const s = useLapStore()
    const line = { a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } }
    s.setLine(line)
    expect(s.line).toEqual(line)
    s.clearLine()
    expect(s.line).toBeNull()
  })

  it('setSource switches the detection mode', () => {
    const s = useLapStore()
    s.setSource('ecu')
    expect(s.source).toBe('ecu')
    s.setSource('line')
    expect(s.source).toBe('line')
  })

  it('starts with no laps selected', () => {
    const s = useLapStore()
    expect(s.selected).toEqual([])
  })

  it('toggleLap adds laps in selection order and removes on a second toggle', () => {
    const s = useLapStore()
    s.toggleLap(1)
    expect(s.selected).toEqual([1])
    s.toggleLap(3)
    s.toggleLap(0)
    // Kept in selection order (not sorted) so colors stay stable.
    expect(s.selected).toEqual([1, 3, 0])
    // Removing the middle one preserves the order of the rest.
    s.toggleLap(3)
    expect(s.selected).toEqual([1, 0])
    s.toggleLap(1)
    s.toggleLap(0)
    expect(s.selected).toEqual([])
  })

  it('isSelected reflects membership', () => {
    const s = useLapStore()
    s.toggleLap(2)
    expect(s.isSelected(2)).toBe(true)
    expect(s.isSelected(5)).toBe(false)
  })

  it('clearSelection empties the selection', () => {
    const s = useLapStore()
    s.toggleLap(1)
    s.toggleLap(4)
    s.clearSelection()
    expect(s.selected).toEqual([])
  })

  it('selection changes leave columns/line/source untouched', () => {
    const s = useLapStore()
    s.setLine({ a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } })
    s.setSource('ecu')
    s.addColumn('RPM', 'max')
    s.toggleLap(1)
    s.toggleLap(2)
    s.clearSelection()
    expect(s.line).not.toBeNull()
    expect(s.source).toBe('ecu')
    expect(s.columns).toHaveLength(1)
  })

  it('starts with no configured columns', () => {
    const s = useLapStore()
    expect(s.columns).toEqual([])
  })

  it('addColumn appends columns with unique incremental ids', () => {
    const s = useLapStore()
    s.addColumn('GPS_Speed', 'max')
    s.addColumn('Vehicle_Speed', 'avg')
    expect(s.columns).toHaveLength(2)
    expect(s.columns[0]).toMatchObject({ channel: 'GPS_Speed', agg: 'max' })
    expect(s.columns[1]).toMatchObject({ channel: 'Vehicle_Speed', agg: 'avg' })
    const ids = s.columns.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('removeColumn drops only the matching column and keeps ids unique afterwards', () => {
    const s = useLapStore()
    s.addColumn('A', 'max')
    s.addColumn('B', 'min')
    const removeId = s.columns[0].id
    s.removeColumn(removeId)
    expect(s.columns).toHaveLength(1)
    expect(s.columns[0].channel).toBe('B')
    // A new column must not reuse the removed id.
    s.addColumn('C', 'avg')
    const ids = s.columns.map((c) => c.id)
    expect(ids).not.toContain(removeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('setColumnChannel and setColumnAgg update the targeted column', () => {
    const s = useLapStore()
    s.addColumn('', 'max')
    const id = s.columns[0].id
    s.setColumnChannel(id, 'RPM')
    s.setColumnAgg(id, 'avg')
    expect(s.columns[0]).toMatchObject({ channel: 'RPM', agg: 'avg' })
  })

  it('setColumnChannel/setColumnAgg ignore unknown ids', () => {
    const s = useLapStore()
    s.addColumn('A', 'max')
    s.setColumnChannel(999, 'X')
    s.setColumnAgg(999, 'min')
    expect(s.columns[0]).toMatchObject({ channel: 'A', agg: 'max' })
  })
})
