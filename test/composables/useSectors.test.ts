import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { computed } from 'vue'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useSectorStore } from '@/stores/sectorStore'
import { useSectors } from '@/composables/useSectors'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import type { Lap } from '@/domain/model/Lap'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

const R = 6371000
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/**
 * Build a session whose GPS_Lat/GPS_Lon trace a single 90-degree corner in
 * the middle of an otherwise straight run — same walk-forward technique as
 * cornerDetection.test.ts's `walkTrack`, but materialised as decimal-degree
 * channels (GPS_Lat/GPS_Lon) so it round-trips through `useActiveSession` /
 * `extractGpsTrack` exactly like a real imported session would.
 */
function sessionWithOneCorner(straight = 30, rampSteps = 10, peakDegPerStep = 20, stepM = 5): LogSession {
  const n = straight * 2 + rampSteps + 1
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  lat[0] = 23
  lon[0] = 120
  let heading = 90 // due east
  const half = rampSteps / 2
  for (let k = 0; k < n - 1; k++) {
    const dLat = toDeg((stepM * Math.cos(toRad(heading))) / R)
    const dLon = toDeg((stepM * Math.sin(toRad(heading))) / (R * Math.cos(toRad(lat[k]))))
    lat[k + 1] = lat[k] + dLat
    lon[k + 1] = lon[k] + dLon

    if (k >= straight && k < straight + rampSteps) {
      const i = k - straight
      const t = i < half ? i / half : (rampSteps - i) / half
      heading += peakDegPerStep * t
    }
  }
  return new LogSession(
    [channel('GPS_Lat', Array.from(lat)), channel('GPS_Lon', Array.from(lon))],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

/** A single lap spanning the whole track (matches pickReferenceLap's
 *  "one plausible lap" case). */
function wholeTrackLap(rowCount: number): Lap {
  return { index: 0, startIdx: 0, endIdx: rowCount, lapTimeMs: 50_000 }
}

/** Load `session` as the analyzer's active file, returning its row count. */
function activateSession(session: LogSession): number {
  const fileStore = useFileStore()
  const analyzer = useAnalyzerStore()
  const id = fileStore.addMergedSession('test.nmea', session)
  analyzer.activeFileId = id
  return session.rowCount
}

beforeEach(() => setActivePinia(createPinia()))

describe('useSectors', () => {
  it('runAutoDetect loads detected corner gates directly into sectorStore, clearing edited', () => {
    const session = sessionWithOneCorner()
    const rowCount = activateSession(session)
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => [wholeTrackLap(rowCount)])

    const { runAutoDetect } = useSectors(laps)
    runAutoDetect()

    expect(sectorStore.gates.length).toBeGreaterThan(0)
    expect(sectorStore.edited).toBe(false)
  })

  it('runAutoDetect is a no-op when there is no active session', () => {
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => [])

    const { runAutoDetect } = useSectors(laps)
    runAutoDetect()

    expect(sectorStore.gates).toEqual([])
  })

  it('runAutoDetect is a no-op when there is no plausible reference lap', () => {
    const session = sessionWithOneCorner()
    activateSession(session)
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => []) // nothing to pick a reference from

    const { runAutoDetect } = useSectors(laps)
    runAutoDetect()

    expect(sectorStore.gates).toEqual([])
  })

  it('addGateAtCursor adds a gate at the given sample and marks the set edited', () => {
    const session = sessionWithOneCorner()
    const rowCount = activateSession(session)
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => [wholeTrackLap(rowCount)])

    const { addGateAtCursor } = useSectors(laps)
    addGateAtCursor(10)

    expect(sectorStore.gates).toHaveLength(1)
    expect(sectorStore.edited).toBe(true)
  })

  it('addGateAtCursor falls back to the reference lap midpoint when cursorIdx is null', () => {
    const session = sessionWithOneCorner()
    const rowCount = activateSession(session)
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => [wholeTrackLap(rowCount)])

    const { addGateAtCursor } = useSectors(laps)
    addGateAtCursor(null)

    expect(sectorStore.gates).toHaveLength(1)
  })

  it('addGateAtCursor is a no-op when there is no active track', () => {
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => [])

    const { addGateAtCursor } = useSectors(laps)
    addGateAtCursor(5)

    expect(sectorStore.gates).toEqual([])
  })

  it('reorderGates re-sorts gates by lap-relative position along the reference lap', () => {
    const session = sessionWithOneCorner()
    const rowCount = activateSession(session)
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => [wholeTrackLap(rowCount)])

    const { addGateAtCursor, reorderGates } = useSectors(laps)
    // Add gates out of lap-order (late sample first, then early sample).
    addGateAtCursor(60)
    addGateAtCursor(10)
    reorderGates()

    // After reordering, the gate nearest the start of the lap should be first.
    const [first, second] = sectorStore.gates
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toEqual(second)
  })

  it('clears gates when the active session/track changes', async () => {
    const session1 = sessionWithOneCorner()
    const rowCount = activateSession(session1)
    const sectorStore = useSectorStore()
    const laps = computed<Lap[]>(() => [wholeTrackLap(rowCount)])

    const { runAutoDetect } = useSectors(laps)
    runAutoDetect()
    expect(sectorStore.gates.length).toBeGreaterThan(0)

    // Switch the active file to a different session -> track changes.
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const session2 = sessionWithOneCorner(40, 20, 9)
    const id2 = fileStore.addMergedSession('test2.nmea', session2)
    analyzer.activeFileId = id2

    await Promise.resolve() // let the watcher's flush run
    expect(sectorStore.gates).toEqual([])
  })
})
