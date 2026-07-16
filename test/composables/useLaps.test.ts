import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { computed, nextTick } from 'vue'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { useLaps } from '@/composables/useLaps'
import { useSectors } from '@/composables/useSectors'
import { useActiveSession } from '@/composables/useActiveSession'
import { suggestLapTimeBand, suggestLapDistanceBand } from '@/domain/analysis/lapValidity'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import type { Lap } from '@/domain/model/Lap'
import type { LapLine } from '@/domain/analysis/laps'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** A tiny session with a real GPS track (two valid fixes) so useActiveSession's
 *  `track` computed produces a non-null value with a fresh identity each time
 *  the active file changes — same fixture shape as useSectors.test.ts's. */
function gpsSession(latBase: number): LogSession {
  return new LogSession(
    [
      channel('Time', [0, 1000]),
      channel('GPS_Lat', [latBase, latBase + 0.001]),
      channel('GPS_Lon', [120, 120.001]),
    ],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

/** ECU-lap session with three equal-distance laps, sufficient for band suggestions. */
function ecuLapSession(latBase: number): LogSession {
  const n = 41
  return new LogSession(
    [
      channel('Time', Array.from({ length: n }, (_, i) => i * 5_000)),
      channel('GPS_Lat', Array.from({ length: n }, () => latBase)),
      channel('GPS_Lon', Array.from({ length: n }, (_, i) => 120 + i * 0.001)),
      channel('IR_LapNumber', Array.from({ length: n }, (_, i) => Math.floor(i / 10))),
    ],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

/**
 * A start/finish-LINE session shaped after B58's actual bug: the track first
 * loops in a TINY circle around lon=0 (mimicking the seeded default line's
 * garbage micro-laps — a line drawn there sees short, short-distance
 * crossings), then, after a plain transit sample far from both loops, loops
 * in a much BIGGER circle around lon=100 (the "real" laps a user drags the
 * line onto). Both loops coexist in one track; `detectLapsByLine` only
 * "sees" crossings of whichever line is currently active, so switching
 * `lapStore.line` between {@link garbageLine} and {@link realLine} switches
 * which loop's laps come out — without changing `track` identity at all
 * (exactly what dragging the start/finish line does in the real app).
 * `garbageStepMs`/`realStepMs` are exposed so two sessions can carry
 * distinguishable lap TIMES for a primary-swap test.
 */
function lineLapSession(garbageStepMs = 5500, realStepMs = 30000): LogSession {
  const GARBAGE_AMPLITUDE = 0.001 // degrees -- a few hundred metres of swing
  const REAL_AMPLITUDE = 1 // degrees -- hundreds of km of swing

  const lat: number[] = []
  const lon: number[] = []
  const timeMs: number[] = []
  let t = 0

  // 7 samples zig-zagging across lon=0 (garbage loop): same shape as
  // laps.test.ts's proven "7-sample zig-zag -> 2 laps" fixture, just scaled
  // down in amplitude and step so the resulting laps are short and small.
  for (let i = 0; i < 7; i++) {
    lat.push(0)
    lon.push(i % 2 === 0 ? -GARBAGE_AMPLITUDE : GARBAGE_AMPLITUDE)
    timeMs.push(t)
    t += garbageStepMs
  }
  // Plain transit sample, far from both loops -- crosses neither line.
  lat.push(0)
  lon.push(50)
  timeMs.push(t)
  t += realStepMs

  // 7 more samples zig-zagging across lon=100 (real loop): same shape, much
  // bigger amplitude and step, so the resulting laps are long and large.
  for (let i = 0; i < 7; i++) {
    lat.push(0)
    lon.push(100 + (i % 2 === 0 ? -REAL_AMPLITUDE : REAL_AMPLITUDE))
    timeMs.push(t)
    t += realStepMs
  }

  return new LogSession(
    [channel('Time', timeMs), channel('GPS_Lat', lat), channel('GPS_Lon', lon)],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

const garbageLine: LapLine = { a: { lat: -1, lon: 0 }, b: { lat: 1, lon: 0 } }
const realLine: LapLine = { a: { lat: -1, lon: 100 }, b: { lat: 1, lon: 100 } }

function loadSession(latBase: number): number {
  const fileStore = useFileStore()
  return fileStore.addMergedSession(`s${latBase}.nmea`, gpsSession(latBase))
}

beforeEach(() => setActivePinia(createPinia()))

describe('useLaps file-change watcher', () => {
  it('clears the line/selection/exclusion/offset state on a genuine active-file change', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    const id1 = loadSession(23)
    analyzer.activeFileId = id1
    useLaps()
    await Promise.resolve()

    lapStore.toggleLap(0)
    lapStore.toggleExcluded(0)
    lapStore.nudgeOffset(0, 'time', 0.2)
    const lineBefore = lapStore.line
    expect(lineBefore).not.toBeNull()

    const id2 = loadSession(24)
    analyzer.activeFileId = id2
    await Promise.resolve()

    expect(lapStore.selected).toEqual([])
    expect(lapStore.manualExcluded).toEqual([])
    expect(lapStore.offsetOf(0, 'time')).toBe(0)
    // A fresh default line is seeded for the new track, not the same object.
    expect(lapStore.line).not.toBeNull()
  })

  it('does NOT wipe state when lapStore.primarySwapPending is set (B55 primary swap)', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    const id1 = loadSession(23)
    const id2 = loadSession(24)
    analyzer.activeFileId = id1
    useLaps()
    await Promise.resolve()

    lapStore.toggleLap(0)
    lapStore.toggleExcluded(0)
    lapStore.nudgeOffset(0, 'time', 0.2)
    const lineBefore = lapStore.line

    // Simulate FileBar's makePrimary: migrate state, THEN flip the active file.
    lapStore.swapPrimarySession(id1, id2)
    analyzer.activeFileId = id2
    await Promise.resolve()

    // The swap already migrated id1's selection/exclusion/offset into the
    // per-session facet under id1 — none of it should have been wiped.
    expect(lapStore.isSessionLapSelected(id1, 0)).toBe(true)
    expect(lapStore.isSessionManuallyExcluded(id1, 0)).toBe(true)
    expect(lapStore.sessionLapOffsetOf(id1, 0, 'time')).toBeCloseTo(0.2)
    // The line is global/shared — untouched by a primary swap.
    expect(lapStore.line).toBe(lineBefore)
  })

  it('replaces valid-lap band suggestions on a genuine track change', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    lapStore.setSource('ecu')
    const { laps } = useLaps()
    const fileStore = useFileStore()
    const first = fileStore.addMergedSession('first.nmea', ecuLapSession(23))
    const second = fileStore.addMergedSession('second.nmea', ecuLapSession(24))
    analyzer.activeFileId = first
    await nextTick()
    await nextTick()

    expect(laps.value).toHaveLength(3)
    expect(lapStore.lapTimeBand).not.toBeNull()
    expect(lapStore.lapDistanceBand).not.toBeNull()
    lapStore.setLapTimeBand({ minSec: 1, maxSec: 2 })
    lapStore.setLapDistanceBand({ minM: 1, maxM: 2 })

    analyzer.activeFileId = second
    await nextTick()
    await nextTick()

    expect(lapStore.lapTimeBand).not.toEqual({ minSec: 1, maxSec: 2 })
    expect(lapStore.lapDistanceBand).not.toEqual({ minM: 1, maxM: 2 })
    expect(lapStore.lapTimeBand?.minSec).toBeCloseTo(40)
    expect(lapStore.lapDistanceBand?.minM).toBeGreaterThan(800)
  })

  // B55 — useLaps.ts's and useSectors.ts's file-change watchers BOTH peek
  // `lapStore.primarySwapPending` in the SAME reactive flush; only lapStore's
  // own internal 'post'-flush watcher resets it (see lapStore.ts's doc on
  // `primarySwapPending`). This test wires up both composables together, the
  // way AnalyzerView.vue does, so a regression in that ordering (e.g. one
  // composable seeing the flag already reset) would show up here as gates
  // being wiped even though the primary swap should have preserved them.
  it('sector gates ALSO survive a primary swap when useSectors is active alongside useLaps', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    const sectorStore = useSectorStore()
    const id1 = loadSession(23)
    const id2 = loadSession(24)
    analyzer.activeFileId = id1
    useLaps()
    const laps = computed<Lap[]>(() => [])
    useSectors(laps)
    await Promise.resolve()

    sectorStore.addGate({ a: { lat: 0, lon: 0 }, b: { lat: 1, lon: 1 } })
    expect(sectorStore.gates).toHaveLength(1)

    lapStore.swapPrimarySession(id1, id2)
    analyzer.activeFileId = id2
    await Promise.resolve()

    expect(sectorStore.gates).toHaveLength(1)
  })
})

// B58 part 2 — the initial line-seed produces garbage micro-laps, so the
// FIRST auto-suggested band is worthless; these cover what has to happen
// once the user drags the start/finish line onto the real laps afterwards.
describe('useLaps auto band re-suggestion on start/finish line changes (B58 part 2)', () => {
  it('re-suggests a fresh auto band when the line moves from the garbage loop onto the real laps', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    const { laps } = useLaps()
    const { track } = useActiveSession()
    const fileStore = useFileStore()
    const id = fileStore.addMergedSession('line.nmea', lineLapSession())
    analyzer.activeFileId = id
    await nextTick()
    await nextTick()

    // Point the line at the garbage loop first (standing in for the seeded
    // default line's tiny micro-laps).
    lapStore.setLine(garbageLine)
    await nextTick()
    await nextTick()
    expect(laps.value.length).toBeGreaterThan(0)
    const garbageLaps = laps.value
    expect(lapStore.lapTimeBandOrigin).toBe('auto')
    expect(lapStore.lapDistanceBandOrigin).toBe('auto')
    const garbageTimeBand = lapStore.lapTimeBand
    const garbageDistBand = lapStore.lapDistanceBand
    expect(garbageTimeBand).not.toBeNull()
    expect(garbageDistBand).not.toBeNull()

    // Drag the line onto the real laps.
    lapStore.setLine(realLine)
    await nextTick()
    await nextTick()
    expect(laps.value).not.toBe(garbageLaps)

    // The bands must have been refreshed off the NEW laps, not left stuck at
    // the garbage-loop suggestion (this is the exact bug reported live: bands
    // only ever reflected the first drag).
    expect(lapStore.lapTimeBandOrigin).toBe('auto')
    expect(lapStore.lapDistanceBandOrigin).toBe('auto')
    expect(lapStore.lapTimeBand).not.toEqual(garbageTimeBand)
    expect(lapStore.lapDistanceBand).not.toEqual(garbageDistBand)

    // And they must match what the pure suggestion functions derive from the
    // real laps directly -- not some stale or partially-updated value.
    expect(lapStore.lapTimeBand).toEqual(suggestLapTimeBand(track.value!, laps.value))
    expect(lapStore.lapDistanceBand).toEqual(suggestLapDistanceBand(track.value!, laps.value))
  })

  it('a user-edited time band survives a line change; an untouched distance band keeps auto-refreshing', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    useLaps()
    const fileStore = useFileStore()
    const id = fileStore.addMergedSession('line.nmea', lineLapSession())
    analyzer.activeFileId = id
    await nextTick()
    await nextTick()

    lapStore.setLine(garbageLine)
    await nextTick()
    await nextTick()
    expect(lapStore.lapDistanceBand).not.toBeNull()

    // The user explicitly edits the TIME band (e.g. typing in the panel).
    const userBand = { minSec: 999, maxSec: 1000 }
    lapStore.setLapTimeBand(userBand)
    expect(lapStore.lapTimeBandOrigin).toBe('user')
    const distBandBeforeMove = lapStore.lapDistanceBand

    lapStore.setLine(realLine)
    await nextTick()
    await nextTick()

    // The user's time band is untouched, origin still 'user'.
    expect(lapStore.lapTimeBand).toEqual(userBand)
    expect(lapStore.lapTimeBandOrigin).toBe('user')
    // The distance band was never edited -- it keeps auto-refreshing off the
    // new (real) laps, independently of the time band's provenance.
    expect(lapStore.lapDistanceBandOrigin).toBe('auto')
    expect(lapStore.lapDistanceBand).not.toEqual(distBandBeforeMove)
  })

  it('clearing a band re-arms it: the next line change suggests a fresh one instead of leaving it off', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    useLaps()
    const fileStore = useFileStore()
    const id = fileStore.addMergedSession('line.nmea', lineLapSession())
    analyzer.activeFileId = id
    await nextTick()
    await nextTick()

    lapStore.setLine(garbageLine)
    await nextTick()
    await nextTick()
    expect(lapStore.lapTimeBand).not.toBeNull()

    // The user clears the band (the panel's 清除 button).
    lapStore.clearLapTimeBand()
    expect(lapStore.lapTimeBand).toBeNull()
    expect(lapStore.lapTimeBandOrigin).toBeNull()

    // Nothing re-suggests until the laps actually change again.
    await nextTick()
    await nextTick()
    expect(lapStore.lapTimeBand).toBeNull()

    // Dragging the line again (even back to a DIFFERENT crossing set) is a
    // laps change -> re-arms and re-suggests.
    lapStore.setLine(realLine)
    await nextTick()
    await nextTick()
    expect(lapStore.lapTimeBand).not.toBeNull()
    expect(lapStore.lapTimeBandOrigin).toBe('auto')
  })

  it('a primary swap leaves an auto-origin band value AND origin untouched, even though laps change underneath it', async () => {
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()
    useLaps()
    const fileStore = useFileStore()
    // Two sessions with DIFFERENT garbage-loop timing, so a wrongly-re-run
    // suggestion after the swap would produce a visibly different band.
    const id1 = fileStore.addMergedSession('a.nmea', lineLapSession(5500, 30000))
    const id2 = fileStore.addMergedSession('b.nmea', lineLapSession(9000, 30000))
    analyzer.activeFileId = id1
    await nextTick()
    await nextTick()

    lapStore.setLine(garbageLine)
    await nextTick()
    await nextTick()
    const bandBeforeSwap = lapStore.lapTimeBand
    const originBeforeSwap = lapStore.lapTimeBandOrigin
    expect(bandBeforeSwap).not.toBeNull()
    expect(originBeforeSwap).toBe('auto')

    lapStore.swapPrimarySession(id1, id2)
    analyzer.activeFileId = id2
    await nextTick()
    await nextTick()

    expect(lapStore.lapTimeBand).toEqual(bandBeforeSwap)
    expect(lapStore.lapTimeBandOrigin).toBe(originBeforeSwap)
  })
})
