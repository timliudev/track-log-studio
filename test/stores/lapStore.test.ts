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
    s.addColumn({ kind: 'channel', channel: 'RPM', agg: 'max' })
    s.toggleLap(1)
    s.toggleLap(2)
    s.clearSelection()
    expect(s.line).not.toBeNull()
    expect(s.source).toBe('ecu')
    expect(s.columns).toHaveLength(1)
  })

  it('starts with no laps excluded', () => {
    const s = useLapStore()
    expect(s.excluded).toEqual([])
  })

  it('toggleExcluded marks and un-marks garbage laps', () => {
    const s = useLapStore()
    s.toggleExcluded(2)
    expect(s.excluded).toEqual([2])
    expect(s.isExcluded(2)).toBe(true)
    expect(s.isExcluded(5)).toBe(false)
    s.toggleExcluded(4)
    expect(s.excluded).toContain(2)
    expect(s.excluded).toContain(4)
    s.toggleExcluded(2)
    expect(s.excluded).toEqual([4])
  })

  it('clearExcluded empties the exclusions', () => {
    const s = useLapStore()
    s.toggleExcluded(1)
    s.toggleExcluded(3)
    s.clearExcluded()
    expect(s.excluded).toEqual([])
  })

  it('exclusion and selection are independent', () => {
    const s = useLapStore()
    s.toggleLap(2)
    s.toggleExcluded(2)
    // A lap can be both selected (for inspection) and excluded (from best-lap).
    expect(s.isSelected(2)).toBe(true)
    expect(s.isExcluded(2)).toBe(true)
    s.clearExcluded()
    expect(s.isSelected(2)).toBe(true)
    expect(s.isExcluded(2)).toBe(false)
  })

  it('offsetOf returns 0 for laps with no nudge, per axis', () => {
    const s = useLapStore()
    expect(s.offsetOf(0, 'time')).toBe(0)
    expect(s.offsetOf(0, 'distance')).toBe(0)
  })

  it('nudgeOffset accumulates per lap and per axis independently', () => {
    const s = useLapStore()
    s.nudgeOffset(2, 'time', 0.05)
    s.nudgeOffset(2, 'time', 0.05)
    s.nudgeOffset(2, 'distance', -3)
    expect(s.offsetOf(2, 'time')).toBeCloseTo(0.1)
    expect(s.offsetOf(2, 'distance')).toBe(-3)
    // Other laps are unaffected.
    expect(s.offsetOf(5, 'time')).toBe(0)
  })

  it('resetOffset clears one lap on both axes; clearOffsets clears all', () => {
    const s = useLapStore()
    s.nudgeOffset(1, 'time', 0.2)
    s.nudgeOffset(1, 'distance', 5)
    s.nudgeOffset(4, 'time', -0.1)
    s.resetOffset(1)
    expect(s.offsetOf(1, 'time')).toBe(0)
    expect(s.offsetOf(1, 'distance')).toBe(0)
    expect(s.offsetOf(4, 'time')).toBeCloseTo(-0.1)
    s.clearOffsets()
    expect(s.offsetOf(4, 'time')).toBe(0)
  })

  it('offsets are independent of selection and exclusion', () => {
    const s = useLapStore()
    s.toggleLap(2)
    s.nudgeOffset(2, 'time', 0.05)
    s.clearSelection()
    // Deselecting a lap keeps its alignment offset (re-selecting restores it).
    expect(s.offsetOf(2, 'time')).toBeCloseTo(0.05)
  })

  it('starts with no configured columns', () => {
    const s = useLapStore()
    expect(s.columns).toEqual([])
  })

  it('addColumn appends channel-metric columns with unique incremental ids', () => {
    const s = useLapStore()
    s.addColumn({ kind: 'channel', channel: 'GPS_Speed', agg: 'max' })
    s.addColumn({ kind: 'channel', channel: 'Vehicle_Speed', agg: 'avg' })
    expect(s.columns).toHaveLength(2)
    expect(s.columns[0].metric).toEqual({ kind: 'channel', channel: 'GPS_Speed', agg: 'max' })
    expect(s.columns[1].metric).toEqual({ kind: 'channel', channel: 'Vehicle_Speed', agg: 'avg' })
    const ids = s.columns.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('addColumn accepts non-channel metrics (e.g. distance)', () => {
    const s = useLapStore()
    s.addColumn({ kind: 'distance' })
    expect(s.columns).toHaveLength(1)
    expect(s.columns[0].metric).toEqual({ kind: 'distance' })
  })

  it('removeColumn drops only the matching column and keeps ids unique afterwards', () => {
    const s = useLapStore()
    s.addColumn({ kind: 'channel', channel: 'A', agg: 'max' })
    s.addColumn({ kind: 'channel', channel: 'B', agg: 'min' })
    const removeId = s.columns[0].id
    s.removeColumn(removeId)
    expect(s.columns).toHaveLength(1)
    expect(s.columns[0].metric).toMatchObject({ kind: 'channel', channel: 'B' })
    // A new column must not reuse the removed id.
    s.addColumn({ kind: 'channel', channel: 'C', agg: 'avg' })
    const ids = s.columns.map((c) => c.id)
    expect(ids).not.toContain(removeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('setColumnChannel and setColumnAgg mutate a channel-metric column', () => {
    const s = useLapStore()
    s.addColumn({ kind: 'channel', channel: '', agg: 'max' })
    const id = s.columns[0].id
    s.setColumnChannel(id, 'RPM')
    s.setColumnAgg(id, 'avg')
    expect(s.columns[0].metric).toEqual({ kind: 'channel', channel: 'RPM', agg: 'avg' })
  })

  it('setColumnChannel/setColumnAgg ignore unknown ids', () => {
    const s = useLapStore()
    s.addColumn({ kind: 'channel', channel: 'A', agg: 'max' })
    s.setColumnChannel(999, 'X')
    s.setColumnAgg(999, 'min')
    expect(s.columns[0].metric).toEqual({ kind: 'channel', channel: 'A', agg: 'max' })
  })

  it('setColumnChannel/setColumnAgg are no-ops on a non-channel metric column', () => {
    const s = useLapStore()
    s.addColumn({ kind: 'distance' })
    const id = s.columns[0].id
    s.setColumnChannel(id, 'RPM')
    s.setColumnAgg(id, 'avg')
    // The distance metric is untouched (it has no channel/agg to set).
    expect(s.columns[0].metric).toEqual({ kind: 'distance' })
  })
})
