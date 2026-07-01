import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import type { Lap } from '@/domain/model/Lap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'

/** Build a Lap with a lap time given in seconds (the band works in seconds). */
function lap(index: number, lapTimeSec: number): Lap {
  return { index, startIdx: index * 10, endIdx: index * 10 + 10, lapTimeMs: lapTimeSec * 1000 }
}

/** Build a GpsTrack from lat/lon arrays, marking every sample valid by default. */
function makeTrack(lat: number[], lon: number[]): GpsTrack {
  return {
    lat: new Float64Array(lat),
    lon: new Float64Array(lon),
    valid: new Uint8Array(lat.length).fill(1),
  }
}

/** A vertical gate line at lon = x, spanning lat [-1, 1]. */
function gateAt(lon: number): LapLine {
  return { a: { lat: -1, lon }, b: { lat: 1, lon } }
}

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

  it('starts with no lap-time band and an excluded set equal to manual', () => {
    const s = useLapStore()
    expect(s.lapTimeBand).toBeNull()
    expect(s.bandExcluded).toEqual([])
    s.toggleExcluded(2)
    // With no band, the effective excluded union equals the manual set exactly.
    expect(s.excluded).toEqual(s.manualExcluded)
    expect(s.excluded).toEqual([2])
  })

  it('setting a band folds out-of-band laps into the excluded set', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48), lap(1, 60), lap(2, 51), lap(3, 40)])
    s.setLapTimeBand({ minSec: 46, maxSec: 53 })
    // 60s (slow) and 40s (fast) are out of band.
    expect([...s.bandExcluded].sort()).toEqual([1, 3])
    expect([...s.excluded].sort()).toEqual([1, 3])
    expect(s.isExcluded(1)).toBe(true)
    expect(s.isExcluded(0)).toBe(false)
    // Band exclusion is NOT a manual exclusion.
    expect(s.isManuallyExcluded(1)).toBe(false)
  })

  it('clearing the band restores the previous (manual-only) excluded set', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48), lap(1, 60), lap(2, 51)])
    s.toggleExcluded(0)
    s.setLapTimeBand({ minSec: 46, maxSec: 53 })
    expect([...s.excluded].sort()).toEqual([0, 1])
    s.clearLapTimeBand()
    expect(s.lapTimeBand).toBeNull()
    expect(s.excluded).toEqual([0])
  })

  it('band composes with a manual exclusion (union, de-duplicated)', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48), lap(1, 60), lap(2, 40)])
    s.toggleExcluded(0) // manual
    s.setLapTimeBand({ minSec: 46, maxSec: 53 }) // out-of-band: 1, 2
    expect([...s.excluded].sort()).toEqual([0, 1, 2])
    // A lap that is BOTH manually excluded and out-of-band appears once.
    s.toggleExcluded(1)
    expect([...s.excluded].sort()).toEqual([0, 1, 2])
    expect(s.excluded.filter((x) => x === 1)).toHaveLength(1)
  })

  it('an all-null band is normalised to no constraint', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 60)])
    s.setLapTimeBand({ minSec: null, maxSec: null })
    expect(s.lapTimeBand).toBeNull()
    expect(s.excluded).toEqual([])
  })

  it('an only-max band excludes only the slow laps', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48), lap(1, 60), lap(2, 40)])
    s.setLapTimeBand({ minSec: null, maxSec: 53 })
    expect(s.excluded).toEqual([1])
  })

  it('clearExcluded clears manual exclusions but leaves band exclusions', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48), lap(1, 60)])
    s.toggleExcluded(0)
    s.setLapTimeBand({ minSec: 46, maxSec: 53 })
    s.clearExcluded()
    expect(s.manualExcluded).toEqual([])
    // The band's out-of-band lap (index 1) survives clearExcluded.
    expect(s.excluded).toEqual([1])
  })

  it('starts with an empty sector-invalid set (no track, no gates)', () => {
    const s = useLapStore()
    expect(s.sectorInvalid).toEqual([])
    expect(s.excluded).toEqual([])
  })

  it('setTrack alone (no gates confirmed) contributes nothing to excluded — zero regression', () => {
    const s = useLapStore()
    // A lap that runs 0..10 along lon, but with no gates confirmed in sectorStore.
    s.setLaps([{ index: 0, startIdx: 0, endIdx: 10, lapTimeMs: 50000 }])
    s.setTrack(
      makeTrack(
        Array.from({ length: 11 }, () => 0),
        Array.from({ length: 11 }, (_, i) => i),
      ),
    )
    expect(s.sectorInvalid).toEqual([])
    expect(s.excluded).toEqual([])
  })

  it('confirming sector gates folds gate-missing laps into excluded (cross-store read from sectorStore)', () => {
    const s = useLapStore()
    const sectors = useSectorStore()
    const track = makeTrack(
      Array.from({ length: 11 }, () => 0),
      Array.from({ length: 11 }, (_, i) => i),
    )
    s.setTrack(track)
    s.setLaps([
      { index: 0, startIdx: 0, endIdx: 10, lapTimeMs: 50000 }, // crosses both gates: valid
      { index: 1, startIdx: 0, endIdx: 5, lapTimeMs: 25000 }, // stops short of gate@7.5: invalid
    ])
    // No gates yet -> nothing sector-invalid.
    expect(s.sectorInvalid).toEqual([])
    sectors.addGate(gateAt(3.5))
    sectors.addGate(gateAt(7.5))
    expect(s.sectorInvalid).toEqual([1])
    expect(s.excluded).toEqual([1])
    expect(s.isExcluded(1)).toBe(true)
    expect(s.isExcluded(0)).toBe(false)
    // Not a manual exclusion.
    expect(s.isManuallyExcluded(1)).toBe(false)
  })

  it('sector-invalid composes with manual and band exclusions (union, de-duplicated)', () => {
    const s = useLapStore()
    const sectors = useSectorStore()
    const track = makeTrack(
      Array.from({ length: 11 }, () => 0),
      Array.from({ length: 11 }, (_, i) => i),
    )
    s.setTrack(track)
    s.setLaps([
      { index: 0, startIdx: 0, endIdx: 10, lapTimeMs: 48000 },
      { index: 1, startIdx: 0, endIdx: 5, lapTimeMs: 60000 }, // out-of-band AND sector-invalid
      { index: 2, startIdx: 0, endIdx: 10, lapTimeMs: 51000 },
    ])
    s.toggleExcluded(2) // manual
    s.setLapTimeBand({ minSec: 46, maxSec: 53 }) // out-of-band: lap 1 (60s)
    sectors.addGate(gateAt(3.5))
    sectors.addGate(gateAt(7.5)) // lap 1 (ends at lon 5) never reaches this gate
    expect([...s.excluded].sort()).toEqual([1, 2])
    expect(s.excluded.filter((x) => x === 1)).toHaveLength(1)
  })

  it('clearing gates (sectorStore.clearGates) restores excluded to manual+band only', () => {
    const s = useLapStore()
    const sectors = useSectorStore()
    const track = makeTrack(
      Array.from({ length: 11 }, () => 0),
      Array.from({ length: 11 }, (_, i) => i),
    )
    s.setTrack(track)
    s.setLaps([{ index: 0, startIdx: 0, endIdx: 5, lapTimeMs: 25000 }])
    sectors.addGate(gateAt(3.5))
    sectors.addGate(gateAt(7.5))
    expect(s.excluded).toEqual([0])
    sectors.clearGates()
    expect(s.sectorInvalid).toEqual([])
    expect(s.excluded).toEqual([])
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

  it('mapOffsetOf/nudgeMapOffset accumulate a per-lap 2-D metre shift', () => {
    const s = useLapStore()
    expect(s.mapOffsetOf(3)).toEqual({ x: 0, y: 0 })
    s.nudgeMapOffset(3, 0.5, 0)
    s.nudgeMapOffset(3, 0.5, -1)
    expect(s.mapOffsetOf(3)).toEqual({ x: 1, y: -1 })
    expect(s.mapOffsetOf(9)).toEqual({ x: 0, y: 0 })
  })

  it('chart and map offsets are independent facets of the same lap', () => {
    const s = useLapStore()
    s.nudgeOffset(2, 'time', 0.1)
    s.nudgeMapOffset(2, 2, 3)
    // Resetting the chart facet keeps the map facet, and vice versa.
    s.resetOffset(2)
    expect(s.offsetOf(2, 'time')).toBe(0)
    expect(s.mapOffsetOf(2)).toEqual({ x: 2, y: 3 })
    s.nudgeOffset(2, 'time', 0.2)
    s.resetMapOffset(2)
    expect(s.mapOffsetOf(2)).toEqual({ x: 0, y: 0 })
    expect(s.offsetOf(2, 'time')).toBeCloseTo(0.2)
  })

  it('clearOffsets clears both facets for all laps', () => {
    const s = useLapStore()
    s.nudgeOffset(1, 'time', 0.1)
    s.nudgeMapOffset(1, 5, 5)
    s.clearOffsets()
    expect(s.offsetOf(1, 'time')).toBe(0)
    expect(s.mapOffsetOf(1)).toEqual({ x: 0, y: 0 })
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
