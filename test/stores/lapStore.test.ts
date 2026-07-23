import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
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

  // B5: 'line' vs 'ecu' can produce a different lap set/count entirely, so an
  // existing selection (primary or cross-session) would silently point at the
  // wrong lap — or an out-of-range index — once the source changes. Manual
  // exclusions are independent of detection source and must survive.
  it('setSource clears the primary and cross-session lap selections but leaves manual exclusions', () => {
    const s = useLapStore()
    s.toggleLap(0)
    s.toggleLap(1)
    s.toggleSessionLap(10, 2)
    s.toggleExcluded(0)

    s.setSource('ecu')

    expect(s.selected).toEqual([])
    expect(s.selectedAcrossSessions).toEqual([])
    // Manual exclusion is a separate, source-independent facet.
    expect(s.manualExcluded).toEqual([0])
  })

  it('setSource is a no-op (does not clear selection) when the source is unchanged', () => {
    const s = useLapStore()
    s.toggleLap(1)
    s.toggleSessionLap(10, 2)

    s.setSource('line') // already 'line'

    expect(s.selected).toEqual([1])
    expect(s.selectedAcrossSessions).toEqual([{ fileId: 10, index: 2 }])
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

  it('tracks cross-recording lap identities without colliding on lap index', () => {
    const s = useLapStore()
    s.toggleSessionLap(10, 1)
    s.toggleSessionLap(20, 1)
    expect(s.selectedAcrossSessions).toEqual([{ fileId: 10, index: 1 }, { fileId: 20, index: 1 }])
    expect(s.isSessionLapSelected(10, 1)).toBe(true)
    s.toggleSessionLap(10, 1)
    expect(s.selectedAcrossSessions).toEqual([{ fileId: 20, index: 1 }])
    s.clearSessionSelection(20)
    expect(s.selectedAcrossSessions).toEqual([])
    s.nudgeSessionLapOffset(10, 1, 'time', 0.2)
    s.nudgeSessionLapOffset(20, 1, 'time', -0.1)
    expect(s.sessionLapOffsetOf(10, 1, 'time')).toBeCloseTo(0.2)
    expect(s.sessionLapOffsetOf(20, 1, 'time')).toBeCloseTo(-0.1)
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

  describe('lap-distance band', () => {
    // A straight track along longitude: 1 degree of lon ~= 111194.9 m at lat 0,
    // so distances are easy to reason about ("1 index unit" per lat/lon sample).
    const M_PER_DEG_LON = 111194.92664455874

    /** A lap spanning `steps` degrees of longitude from a shared straight track. */
    function distLap(index: number, steps: number): Lap {
      return { index, startIdx: 0, endIdx: steps, lapTimeMs: 50000 }
    }

    function straightTrack(lengthIdx: number): GpsTrack {
      return makeTrack(
        Array.from({ length: lengthIdx }, () => 0),
        Array.from({ length: lengthIdx }, (_, i) => i),
      )
    }

    it('starts with no lap-distance band and no distance-band exclusions', () => {
      const s = useLapStore()
      expect(s.lapDistanceBand).toBeNull()
      expect(s.distanceBandExcluded).toEqual([])
    })

    it('setting a distance band folds out-of-band-distance laps into the excluded set', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      // Laps of 5 / 10 / 15 index-degrees -> ~555974 / 1111949 / 1667924 m.
      s.setLaps([
        { index: 0, startIdx: 0, endIdx: 5, lapTimeMs: 50000 },
        { index: 1, startIdx: 0, endIdx: 10, lapTimeMs: 50000 },
        { index: 2, startIdx: 0, endIdx: 15, lapTimeMs: 50000 },
      ])
      s.setLapDistanceBand({ minM: 8 * M_PER_DEG_LON, maxM: 12 * M_PER_DEG_LON })
      // Lap 0 (5 deg, too short) and lap 2 (15 deg, too long) are out of band.
      expect([...s.distanceBandExcluded].sort()).toEqual([0, 2])
      expect([...s.excluded].sort()).toEqual([0, 2])
      expect(s.isExcluded(0)).toBe(true)
      expect(s.isExcluded(1)).toBe(false)
      // Distance-band exclusion is NOT a manual exclusion.
      expect(s.isManuallyExcluded(0)).toBe(false)
    })

    it('clearing the distance band restores the previous (manual-only) excluded set', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      s.setLaps([distLap(0, 5), distLap(1, 10)])
      s.toggleExcluded(0)
      s.setLapDistanceBand({ minM: 8 * M_PER_DEG_LON, maxM: 12 * M_PER_DEG_LON })
      expect([...s.excluded].sort()).toEqual([0])
      s.clearLapDistanceBand()
      expect(s.lapDistanceBand).toBeNull()
      expect(s.excluded).toEqual([0])
    })

    it('an all-null distance band is normalised to no constraint', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      s.setLaps([distLap(0, 5)])
      s.setLapDistanceBand({ minM: null, maxM: null })
      expect(s.lapDistanceBand).toBeNull()
      expect(s.excluded).toEqual([])
    })

    it('an only-max distance band excludes only the long laps', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      s.setLaps([distLap(0, 5), distLap(1, 10), distLap(2, 15)])
      s.setLapDistanceBand({ minM: null, maxM: 12 * M_PER_DEG_LON })
      expect(s.excluded).toEqual([2])
    })

    it('exclusionReason identifies distance-band exclusion distinctly from time-band', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      s.setLaps([distLap(0, 5), distLap(1, 10)])
      s.setLapDistanceBand({ minM: 8 * M_PER_DEG_LON, maxM: 12 * M_PER_DEG_LON })
      expect(s.exclusionReason(0)).toBe('distBand')
      expect(s.exclusionReason(1)).toBeNull()
    })

    it('time band and distance band combine: a lap must pass BOTH to be included', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      // Lap 0: in time band (48s) but too short in distance (5 deg).
      // Lap 1: in both bands (50s, 10 deg).
      // Lap 2: out of time band (60s) but in distance band (10 deg).
      s.setLaps([
        { index: 0, startIdx: 0, endIdx: 5, lapTimeMs: 48000 },
        { index: 1, startIdx: 0, endIdx: 10, lapTimeMs: 50000 },
        { index: 2, startIdx: 0, endIdx: 10, lapTimeMs: 60000 },
      ])
      s.setLapTimeBand({ minSec: 46, maxSec: 53 })
      s.setLapDistanceBand({ minM: 8 * M_PER_DEG_LON, maxM: 12 * M_PER_DEG_LON })
      // Lap 0 fails distance; lap 2 fails time; only lap 1 passes both.
      expect([...s.excluded].sort()).toEqual([0, 2])
      expect(s.isExcluded(1)).toBe(false)
      expect(s.exclusionReason(0)).toBe('distBand')
      expect(s.exclusionReason(2)).toBe('timeBand')
    })

    it('distance band composes with a manual exclusion and the time band (union, de-duplicated)', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      s.setLaps([
        { index: 0, startIdx: 0, endIdx: 5, lapTimeMs: 48000 }, // manual
        { index: 1, startIdx: 0, endIdx: 5, lapTimeMs: 60000 }, // out-of-time-band AND out-of-distance-band
        { index: 2, startIdx: 0, endIdx: 10, lapTimeMs: 50000 }, // passes both
      ])
      s.toggleExcluded(0) // manual
      s.setLapTimeBand({ minSec: 46, maxSec: 53 }) // out-of-band: lap 1 (60s)
      s.setLapDistanceBand({ minM: 8 * M_PER_DEG_LON, maxM: 12 * M_PER_DEG_LON }) // out-of-band: laps 0, 1 (5 deg)
      expect([...s.excluded].sort()).toEqual([0, 1])
      // Lap 1 is excluded for two reasons but appears once.
      expect(s.excluded.filter((x) => x === 1)).toHaveLength(1)
    })

    it('clearExcluded clears manual exclusions but leaves distance-band exclusions', () => {
      const s = useLapStore()
      s.setTrack(straightTrack(20))
      s.setLaps([distLap(0, 5), distLap(1, 10)])
      s.toggleExcluded(1)
      s.setLapDistanceBand({ minM: 8 * M_PER_DEG_LON, maxM: 12 * M_PER_DEG_LON })
      s.clearExcluded()
      expect(s.manualExcluded).toEqual([])
      // The distance band's out-of-band lap (index 0) survives clearExcluded.
      expect(s.excluded).toEqual([0])
    })

    it('setting a distance band with no track yet excludes nothing (never crashes)', () => {
      const s = useLapStore()
      s.setLaps([distLap(0, 5)])
      s.setLapDistanceBand({ minM: 1, maxM: 2 })
      expect(s.distanceBandExcluded).toEqual([])
      expect(s.excluded).toEqual([])
    })
  })

  // B58 part 2 — the band value alone can't tell useLaps.ts whether it's
  // still safe to overwrite with a fresh suggestion once the laps change
  // (e.g. the start/finish line moves): setLapTimeBand/setLapDistanceBand
  // (the panel's own inputs) mark 'user', applyAutoLapTimeBand/
  // applyAutoLapDistanceBand (useLaps.ts's suggestion path) mark 'auto', and
  // clearing either band re-arms it back to null so the next suggestion isn't
  // permanently blocked.
  describe('band origin — auto vs. user (B58 part 2)', () => {
    it('starts with no origin for either band', () => {
      const s = useLapStore()
      expect(s.lapTimeBandOrigin).toBeNull()
      expect(s.lapDistanceBandOrigin).toBeNull()
    })

    it('setLapTimeBand marks the origin user', () => {
      const s = useLapStore()
      s.setLapTimeBand({ minSec: 40, maxSec: 50 })
      expect(s.lapTimeBandOrigin).toBe('user')
    })

    it('an all-null setLapTimeBand edit clears the band and re-arms the origin to null', () => {
      const s = useLapStore()
      s.setLapTimeBand({ minSec: 40, maxSec: 50 })
      s.setLapTimeBand({ minSec: null, maxSec: null })
      expect(s.lapTimeBand).toBeNull()
      expect(s.lapTimeBandOrigin).toBeNull()
    })

    it('clearLapTimeBand clears the band and re-arms the origin to null', () => {
      const s = useLapStore()
      s.setLapTimeBand({ minSec: 40, maxSec: 50 })
      s.clearLapTimeBand()
      expect(s.lapTimeBand).toBeNull()
      expect(s.lapTimeBandOrigin).toBeNull()
    })

    it('applyAutoLapTimeBand marks the origin auto and can be overwritten by a later auto suggestion', () => {
      const s = useLapStore()
      s.applyAutoLapTimeBand({ minSec: 40, maxSec: 50 })
      expect(s.lapTimeBand).toEqual({ minSec: 40, maxSec: 50 })
      expect(s.lapTimeBandOrigin).toBe('auto')
      s.applyAutoLapTimeBand({ minSec: 20, maxSec: 30 })
      expect(s.lapTimeBand).toEqual({ minSec: 20, maxSec: 30 })
      expect(s.lapTimeBandOrigin).toBe('auto')
    })

    it('applyAutoLapTimeBand(null) clears the band and leaves the origin re-armed', () => {
      const s = useLapStore()
      s.applyAutoLapTimeBand({ minSec: 40, maxSec: 50 })
      s.applyAutoLapTimeBand(null)
      expect(s.lapTimeBand).toBeNull()
      expect(s.lapTimeBandOrigin).toBeNull()
    })

    it('a user edit blocks a later auto suggestion from being applied by useLaps.ts\'s own guard', () => {
      // The store itself doesn't enforce this (useLaps.ts checks the origin
      // before calling applyAutoLapTimeBand at all) — this just pins that
      // applyAutoLapTimeBand ALWAYS overwrites when called, so the guard has
      // to live in the caller, not silently no-op here.
      const s = useLapStore()
      s.setLapTimeBand({ minSec: 1, maxSec: 2 })
      s.applyAutoLapTimeBand({ minSec: 40, maxSec: 50 })
      expect(s.lapTimeBand).toEqual({ minSec: 40, maxSec: 50 })
      expect(s.lapTimeBandOrigin).toBe('auto')
    })

    it('setLapDistanceBand marks the origin user', () => {
      const s = useLapStore()
      s.setLapDistanceBand({ minM: 400, maxM: 500 })
      expect(s.lapDistanceBandOrigin).toBe('user')
    })

    it('an all-null setLapDistanceBand edit clears the band and re-arms the origin to null', () => {
      const s = useLapStore()
      s.setLapDistanceBand({ minM: 400, maxM: 500 })
      s.setLapDistanceBand({ minM: null, maxM: null })
      expect(s.lapDistanceBand).toBeNull()
      expect(s.lapDistanceBandOrigin).toBeNull()
    })

    it('clearLapDistanceBand clears the band and re-arms the origin to null', () => {
      const s = useLapStore()
      s.setLapDistanceBand({ minM: 400, maxM: 500 })
      s.clearLapDistanceBand()
      expect(s.lapDistanceBand).toBeNull()
      expect(s.lapDistanceBandOrigin).toBeNull()
    })

    it('applyAutoLapDistanceBand marks the origin auto and can be overwritten by a later auto suggestion', () => {
      const s = useLapStore()
      s.applyAutoLapDistanceBand({ minM: 400, maxM: 500 })
      expect(s.lapDistanceBand).toEqual({ minM: 400, maxM: 500 })
      expect(s.lapDistanceBandOrigin).toBe('auto')
      s.applyAutoLapDistanceBand({ minM: 100, maxM: 200 })
      expect(s.lapDistanceBand).toEqual({ minM: 100, maxM: 200 })
      expect(s.lapDistanceBandOrigin).toBe('auto')
    })

    it('applyAutoLapDistanceBand(null) clears the band and leaves the origin re-armed', () => {
      const s = useLapStore()
      s.applyAutoLapDistanceBand({ minM: 400, maxM: 500 })
      s.applyAutoLapDistanceBand(null)
      expect(s.lapDistanceBand).toBeNull()
      expect(s.lapDistanceBandOrigin).toBeNull()
    })

    it('time-band and distance-band origins are independent facets', () => {
      const s = useLapStore()
      s.setLapTimeBand({ minSec: 40, maxSec: 50 })
      s.applyAutoLapDistanceBand({ minM: 400, maxM: 500 })
      expect(s.lapTimeBandOrigin).toBe('user')
      expect(s.lapDistanceBandOrigin).toBe('auto')
      s.clearLapTimeBand()
      expect(s.lapTimeBandOrigin).toBeNull()
      // Clearing the time band doesn't touch the distance band's origin.
      expect(s.lapDistanceBandOrigin).toBe('auto')
    })
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
    s.setLaps([
      { index: 0, startIdx: 0, endIdx: 5, lapTimeMs: 25000 },
      { index: 1, startIdx: 0, endIdx: 10, lapTimeMs: 50000 },
    ])
    sectors.addGate(gateAt(3.5))
    sectors.addGate(gateAt(7.5))
    expect(s.excluded).toEqual([0])
    sectors.clearGates()
    expect(s.sectorInvalid).toEqual([])
    expect(s.excluded).toEqual([])
  })

  it('exclusionReason returns null for an included lap', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48)])
    expect(s.exclusionReason(0)).toBeNull()
  })

  it('exclusionReason identifies manual exclusion', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48)])
    s.toggleExcluded(0)
    expect(s.exclusionReason(0)).toBe('manual')
  })

  it('exclusionReason identifies band exclusion', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 48), lap(1, 60)])
    s.setLapTimeBand({ minSec: 46, maxSec: 53 })
    expect(s.exclusionReason(1)).toBe('timeBand')
    expect(s.exclusionReason(0)).toBeNull()
  })

  it('exclusionReason identifies sector-invalid exclusion', () => {
    const s = useLapStore()
    const sectors = useSectorStore()
    const track = makeTrack(
      Array.from({ length: 11 }, () => 0),
      Array.from({ length: 11 }, (_, i) => i),
    )
    s.setTrack(track)
    s.setLaps([
      { index: 0, startIdx: 0, endIdx: 5, lapTimeMs: 25000 },
      { index: 1, startIdx: 0, endIdx: 10, lapTimeMs: 50000 },
    ])
    sectors.addGate(gateAt(3.5))
    sectors.addGate(gateAt(7.5))
    expect(s.exclusionReason(0)).toBe('sector')
    expect(s.sectorFailureNumber(0)).toBe(2)
  })

  it('warns but does not exclude when every lap fails the sector configuration', () => {
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
    expect(s.sectorAllFailed).toBe(true)
    expect(s.sectorFailureCount).toBe(1)
    expect(s.sectorInvalid).toEqual([])
    expect(s.excluded).toEqual([])
  })

  it('keeps the raw failure count reactive when a gate edit makes every lap fail', () => {
    const s = useLapStore()
    const sectors = useSectorStore()
    const track = makeTrack(
      Array.from({ length: 11 }, () => 0),
      Array.from({ length: 11 }, (_, i) => i),
    )
    s.setTrack(track)
    s.setLaps([
      { index: 0, startIdx: 0, endIdx: 10, lapTimeMs: 50000 },
      { index: 1, startIdx: 0, endIdx: 5, lapTimeMs: 25000 },
    ])
    sectors.addGate(gateAt(3.5))
    sectors.addGate(gateAt(7.5))

    expect(s.sectorFailureCount).toBe(1)
    expect(s.sectorInvalid).toEqual([1])
    expect(s.excluded).toEqual([1])

    sectors.setGate(1, gateAt(20))
    expect(s.sectorFailureCount).toBe(2)
    expect(s.sectorAllFailed).toBe(true)
    expect(s.sectorInvalid).toEqual([])
    expect(s.excluded).toEqual([])
  })

  it('exclusionReason prefers manual when a lap is both manual and auto-excluded', () => {
    const s = useLapStore()
    s.setLaps([lap(0, 60)])
    s.toggleExcluded(0)
    s.setLapTimeBand({ minSec: 46, maxSec: 53 })
    expect(s.isExcluded(0)).toBe(true)
    expect(s.exclusionReason(0)).toBe('manual')
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

  // #9 comparison half — sessionLapMapOffsetOf/nudgeSessionLapMapOffset/
  // resetSessionLapMapOffset mirror mapOffsetOf/nudgeMapOffset/resetMapOffset
  // above, but keyed by (fileId, index) on `sessionLapOffsets` instead of by
  // index alone on `offsets`.
  it('sessionLapMapOffsetOf/nudgeSessionLapMapOffset accumulate a per-comparison-lap 2-D metre shift', () => {
    const s = useLapStore()
    expect(s.sessionLapMapOffsetOf(10, 3)).toEqual({ x: 0, y: 0 })
    s.nudgeSessionLapMapOffset(10, 3, 0.5, 0)
    s.nudgeSessionLapMapOffset(10, 3, 0.5, -1)
    expect(s.sessionLapMapOffsetOf(10, 3)).toEqual({ x: 1, y: -1 })
    // A different fileId or a different lap index is unaffected.
    expect(s.sessionLapMapOffsetOf(20, 3)).toEqual({ x: 0, y: 0 })
    expect(s.sessionLapMapOffsetOf(10, 9)).toEqual({ x: 0, y: 0 })
  })

  it('sessionLapMapOffsetOf/nudgeSessionLapMapOffset create the entry when absent (same rule as the primary facet)', () => {
    const s = useLapStore()
    s.nudgeSessionLapMapOffset(5, 1, 2, 3)
    expect(s.sessionLapMapOffsetOf(5, 1)).toEqual({ x: 2, y: 3 })
  })

  it('resetSessionLapMapOffset zeroes only the map facet, keeping the time/dist chart facet', () => {
    const s = useLapStore()
    s.nudgeSessionLapOffset(7, 2, 'time', 0.4)
    s.nudgeSessionLapMapOffset(7, 2, 3, 4)
    s.resetSessionLapMapOffset(7, 2)
    expect(s.sessionLapMapOffsetOf(7, 2)).toEqual({ x: 0, y: 0 })
    expect(s.sessionLapOffsetOf(7, 2, 'time')).toBeCloseTo(0.4)
  })

  it('resetSessionLapMapOffset is a no-op when no offset entry exists yet', () => {
    const s = useLapStore()
    expect(() => s.resetSessionLapMapOffset(1, 1)).not.toThrow()
    expect(s.sessionLapMapOffsetOf(1, 1)).toEqual({ x: 0, y: 0 })
  })

  it('session-lap chart and map offsets accumulate independently on the same comparison lap', () => {
    const s = useLapStore()
    s.nudgeSessionLapOffset(2, 4, 'time', 0.1)
    s.nudgeSessionLapMapOffset(2, 4, 2, 3)
    expect(s.sessionLapOffsetOf(2, 4, 'time')).toBeCloseTo(0.1)
    expect(s.sessionLapMapOffsetOf(2, 4)).toEqual({ x: 2, y: 3 })
  })

  it('clearOffsets clears session-lap map offsets too', () => {
    const s = useLapStore()
    s.nudgeSessionLapMapOffset(1, 1, 5, 5)
    s.clearOffsets()
    expect(s.sessionLapMapOffsetOf(1, 1)).toEqual({ x: 0, y: 0 })
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

  // B1c: comparison recordings get their own manual "garbage lap" facet,
  // keyed by fileId — the comparison-table analogue of `manualExcluded`.
  describe('per-comparison-session manual exclusion (B1c)', () => {
    it('starts with no comparison recording manually excluded', () => {
      const s = useLapStore()
      expect(s.manualExcludedBySession).toEqual({})
      expect(s.isSessionManuallyExcluded(10, 0)).toBe(false)
    })

    it('toggleSessionExcluded marks and un-marks a lap for one recording', () => {
      const s = useLapStore()
      s.toggleSessionExcluded(10, 2)
      expect(s.isSessionManuallyExcluded(10, 2)).toBe(true)
      expect(s.manualExcludedBySession[10]).toEqual([2])
      s.toggleSessionExcluded(10, 2)
      expect(s.isSessionManuallyExcluded(10, 2)).toBe(false)
      expect(s.manualExcludedBySession[10]).toEqual([])
    })

    it('keeps each comparison recording\'s exclusions independent (no cross-fileId collision)', () => {
      const s = useLapStore()
      s.toggleSessionExcluded(10, 1)
      s.toggleSessionExcluded(20, 1)
      expect(s.isSessionManuallyExcluded(10, 1)).toBe(true)
      expect(s.isSessionManuallyExcluded(20, 1)).toBe(true)
      s.toggleSessionExcluded(10, 1)
      expect(s.isSessionManuallyExcluded(10, 1)).toBe(false)
      // The other recording's exclusion of the SAME lap index is untouched.
      expect(s.isSessionManuallyExcluded(20, 1)).toBe(true)
    })

    it('clearSessionSelection(fileId) drops that recording\'s manual exclusions too', () => {
      const s = useLapStore()
      s.toggleSessionLap(10, 0)
      s.toggleSessionExcluded(10, 1)
      s.toggleSessionExcluded(20, 1)

      s.clearSessionSelection(10)

      expect(s.isSessionLapSelected(10, 0)).toBe(false)
      expect(s.isSessionManuallyExcluded(10, 1)).toBe(false)
      // A different recording's state is untouched.
      expect(s.isSessionManuallyExcluded(20, 1)).toBe(true)
    })

    it('clearSessionSelection() (no fileId) drops every recording\'s manual exclusions', () => {
      const s = useLapStore()
      s.toggleSessionExcluded(10, 1)
      s.toggleSessionExcluded(20, 2)

      s.clearSessionSelection()

      expect(s.manualExcludedBySession).toEqual({})
    })

    // B5: source switch invalidates lap selections (different lap set/count)
    // but manual exclusions are source-independent — same rule as the
    // primary's `manualExcluded`, applied here to the per-session facet.
    it('setSource leaves per-comparison-session manual exclusions untouched', () => {
      const s = useLapStore()
      s.toggleSessionExcluded(10, 1)
      s.toggleSessionLap(10, 2)

      s.setSource('ecu')

      expect(s.isSessionManuallyExcluded(10, 1)).toBe(true)
      expect(s.isSessionLapSelected(10, 2)).toBe(false)
    })
  })

  // B55: promoting a different loaded recording to primary must not silently
  // leave the primary-only facets (selected/manualExcluded/offsets) pointing
  // at the OUTGOING primary's lap indices — swapPrimarySession migrates both
  // facets in lockstep. See domain/analysis/primaryLapSwap.ts for the pure
  // logic this action wraps; these tests cover it wired up on the real refs.
  describe('swapPrimarySession (B55)', () => {
    it('promotes the new primary\'s per-session state into the primary facet, and vice versa', () => {
      const s = useLapStore()
      // Recording 1 is primary with its own selection/exclusion/offset.
      s.toggleLap(0)
      s.toggleExcluded(0)
      s.nudgeOffset(0, 'time', 0.3)
      // Recording 2 is a comparison with its own per-session state.
      s.toggleSessionLap(2, 5)
      s.toggleSessionExcluded(2, 7)
      s.nudgeSessionLapOffset(2, 5, 'time', 0.4)

      s.swapPrimarySession(1, 2)

      // Recording 2's former per-session state is now the primary facet.
      expect(s.selected).toEqual([5])
      expect(s.manualExcluded).toEqual([7])
      expect(s.offsetOf(5, 'time')).toBeCloseTo(0.4)
      // Recording 1's former primary state now lives under its own id.
      expect(s.isSessionLapSelected(1, 0)).toBe(true)
      expect(s.isSessionManuallyExcluded(1, 0)).toBe(true)
      expect(s.sessionLapOffsetOf(1, 0, 'time')).toBeCloseTo(0.3)
      // Recording 2 no longer appears in the per-session facets.
      expect(s.selectedAcrossSessions).not.toContainEqual({ fileId: 2, index: 5 })
      expect(s.manualExcludedBySession[2]).toBeUndefined()
    })

    it('is a no-op when the old and new primary are the same id', () => {
      const s = useLapStore()
      s.toggleLap(1)
      s.swapPrimarySession(3, 3)
      expect(s.selected).toEqual([1])
    })

    it('discards the outgoing primary\'s state (does not fold it in) when oldPrimaryId is null', () => {
      const s = useLapStore()
      s.toggleLap(0) // outgoing primary's own selection
      s.toggleSessionLap(2, 1) // incoming primary's per-session selection

      s.swapPrimarySession(null, 2)

      expect(s.selected).toEqual([1]) // the promoted recording's own laps
      // The outgoing primary's [0] selection is gone, not folded under any id.
      expect(s.selectedAcrossSessions).toEqual([])
    })

    it('sets primarySwapPending for exactly one flush', async () => {
      const s = useLapStore()
      expect(s.primarySwapPending).toBe(false)
      s.swapPrimarySession(1, 2)
      expect(s.primarySwapPending).toBe(true)
      await nextTick()
      expect(s.primarySwapPending).toBe(false)
    })

    it('leaves an unrelated third recording\'s per-session state untouched', () => {
      const s = useLapStore()
      s.toggleSessionLap(9, 2)
      s.toggleSessionExcluded(9, 3)

      s.swapPrimarySession(1, 2)

      expect(s.isSessionLapSelected(9, 2)).toBe(true)
      expect(s.isSessionManuallyExcluded(9, 3)).toBe(true)
    })
  })
})
