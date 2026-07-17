import { computed, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useFileStore } from '@/stores/fileStore'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { useTrackLibraryStore } from '@/stores/trackLibraryStore'
import { useCircuitPersistence } from '@/composables/useCircuitPersistence'
import { useSectorAutoPopulate } from '@/composables/useSectorAutoPopulate'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import type { CircuitSetup } from '@/domain/persist/circuitStore'
import type { Lap } from '@/domain/model/Lap'

const persistenceMocks = vi.hoisted(() => ({
  getCircuitSetup: vi.fn<() => Promise<CircuitSetup | null>>(),
  putCircuitSetup: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/domain/persist/circuitStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/persist/circuitStore')>()
  return {
    ...actual,
    getCircuitSetup: persistenceMocks.getCircuitSetup,
    putCircuitSetup: persistenceMocks.putCircuitSetup,
  }
})

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function cornerSession(): LogSession {
  const straight = 30
  const rampSteps = 10
  const n = straight * 2 + rampSteps + 1
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  lat[0] = 23
  lon[0] = 120
  let heading = 90
  for (let k = 0; k < n - 1; k++) {
    const headingRad = (heading * Math.PI) / 180
    lat[k + 1] = lat[k] + ((5 * Math.cos(headingRad)) / 6_371_000) * (180 / Math.PI)
    lon[k + 1] = lon[k] + ((5 * Math.sin(headingRad)) / (6_371_000 * Math.cos((lat[k] * Math.PI) / 180))) * (180 / Math.PI)
    if (k >= straight && k < straight + rampSteps) {
      const i = k - straight
      const half = rampSteps / 2
      const t = i < half ? i / half : (rampSteps - i) / half
      heading += 20 * t
    }
  }
  return new LogSession(
    [channel('GPS_Lat', Array.from(lat)), channel('GPS_Lon', Array.from(lon))],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

function activate(session: LogSession): void {
  const id = useFileStore().addMergedSession('circuit.nmea', session)
  useAnalyzerStore().activeFileId = id
}

async function settleRestore(): Promise<void> {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  setActivePinia(createPinia())
  persistenceMocks.getCircuitSetup.mockReset()
  persistenceMocks.putCircuitSetup.mockReset()
  useTrackLibraryStore().tracks = []
})

describe('circuit restore → sector auto-populate precedence', () => {
  it('runs after a fresh circuit settles with no saved or library geometry', async () => {
    const session = cornerSession()
    activate(session)
    persistenceMocks.getCircuitSetup.mockResolvedValue(null)
    const lapStore = useLapStore()
    lapStore.setLine({ a: { lat: 22.99, lon: 120 }, b: { lat: 23.01, lon: 120 } })
    const laps = computed<Lap[]>(() => [{ index: 0, startIdx: 0, endIdx: session.rowCount, lapTimeMs: 50_000 }])

    const persistence = useCircuitPersistence()
    useSectorAutoPopulate(laps, persistence.circuitGeometryOrigin, persistence.circuitRestoreEpoch)
    expect(persistence.circuitGeometryOrigin.value).toBe('pending')

    await settleRestore()
    expect(persistence.circuitGeometryOrigin.value).toBe('none')
    expect(useSectorStore().gates.length).toBeGreaterThan(0)
  })

  it('preserves a saved empty gate list instead of auto-populating it', async () => {
    const session = cornerSession()
    activate(session)
    const savedLine = { a: { lat: 22.9, lon: 120 }, b: { lat: 23.1, lon: 120 } }
    persistenceMocks.getCircuitSetup.mockResolvedValue({
      schemaVersion: 1,
      key: 'saved-circuit',
      trackId: null,
      localOverride: { line: savedLine, gates: [] },
      columns: [],
      updatedAt: 1,
    })
    const laps = computed<Lap[]>(() => [{ index: 0, startIdx: 0, endIdx: session.rowCount, lapTimeMs: 50_000 }])

    const persistence = useCircuitPersistence()
    useSectorAutoPopulate(laps, persistence.circuitGeometryOrigin, persistence.circuitRestoreEpoch)
    await settleRestore()

    expect(persistence.circuitGeometryOrigin.value).toBe('saved')
    expect(useLapStore().line).toEqual(savedLine)
    expect(useSectorStore().gates).toEqual([])
  })
})
