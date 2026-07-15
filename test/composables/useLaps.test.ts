import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { computed } from 'vue'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { useLaps } from '@/composables/useLaps'
import { useSectors } from '@/composables/useSectors'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import type { Lap } from '@/domain/model/Lap'

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
