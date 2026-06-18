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

  it('starts with no lap selected', () => {
    const s = useLapStore()
    expect(s.selectedIndex).toBeNull()
  })

  it('selectLap sets and clears the selected index', () => {
    const s = useLapStore()
    s.selectLap(2)
    expect(s.selectedIndex).toBe(2)
    s.selectLap(null)
    expect(s.selectedIndex).toBeNull()
  })

  it('toggleLap selects, then deselects the same lap on a second toggle', () => {
    const s = useLapStore()
    s.toggleLap(1)
    expect(s.selectedIndex).toBe(1)
    s.toggleLap(1)
    expect(s.selectedIndex).toBeNull()
    s.toggleLap(1)
    s.toggleLap(3)
    expect(s.selectedIndex).toBe(3)
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
