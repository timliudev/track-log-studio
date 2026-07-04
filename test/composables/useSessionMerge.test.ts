import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useFileStore } from '@/stores/fileStore'
import { useSessionMerge, NUDGE_STEP_MS } from '@/composables/useSessionMerge'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** A "loga" session with broken/no GPS: Time + GPS_Speed (ramp) so it has a
 *  resolvable speed channel to align on, matching a real .loga with wheel
 *  speed but no usable GPS fix. */
function makeBase(): LogSession {
  const timeMs = Array.from({ length: 50 }, (_, i) => i * 100) // 0..4900ms
  const speed = timeMs.map((t) => 20 + 0.01 * t) // gentle ramp, plenty of variance
  return new LogSession([channel('Time', timeMs), channel('GPS_Speed', speed)], {
    formatId: 'superX',
    createdDate: null,
    headerInfo: {},
  })
}

/** A "gps" session (e.g. .nmea) recording the SAME physical speed ramp, but
 *  on a clock shifted by `shiftMs` relative to base, plus GPS_Lat/Lon. */
function makeGps(shiftMs: number): LogSession {
  const timeMs = Array.from({ length: 50 }, (_, i) => i * 100 + shiftMs)
  // Same physical instant -> same speed value as base: base's speed at time T
  // is 20 + 0.01*T: gps's clock reads T+shiftMs at that same instant, so
  // gps's speed-as-a-function-of-its-own-clock is 20 + 0.01*(gpsTime - shiftMs).
  const speed = timeMs.map((t) => 20 + 0.01 * (t - shiftMs))
  const lat = timeMs.map((_, i) => 23 + i * 0.0001)
  const lon = timeMs.map((_, i) => 120 + i * 0.0001)
  return new LogSession(
    [
      channel('Time', timeMs),
      channel('GPS_Speed', speed),
      channel('GPS_Lat', lat),
      channel('GPS_Lon', lon),
    ],
    { formatId: 'nmea', createdDate: null, headerInfo: {} },
  )
}

beforeEach(() => setActivePinia(createPinia()))

describe('useSessionMerge', () => {
  it('lists every ready file as a candidate, flagging speed-channel availability', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))

    const { candidates } = useSessionMerge()
    expect(candidates.value).toHaveLength(2)
    expect(candidates.value.find((c) => c.id === baseId)?.hasSpeedChannel).toBe(true)
    expect(candidates.value.find((c) => c.id === gpsId)?.hasSpeedChannel).toBe(true)
  })

  it('canAlign is false until two distinct sessions with speed channels are picked', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))

    const merge = useSessionMerge()
    expect(merge.canAlign.value).toBe(false)

    merge.baseId.value = baseId
    expect(merge.canAlign.value).toBe(false) // only one side picked

    merge.gpsId.value = baseId
    expect(merge.canAlign.value).toBe(false) // same session on both sides

    merge.gpsId.value = gpsId
    expect(merge.canAlign.value).toBe(true)
  })

  it('autoAlign recovers a known clock shift between two sessions', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(2000))

    const merge = useSessionMerge()
    merge.baseId.value = baseId
    merge.gpsId.value = gpsId
    merge.autoAlign()

    expect(merge.alignment.value).not.toBeNull()
    // gps clock reads +2000ms relative to base at the same physical instant,
    // so offsetMs (added to gps's clock to match base) should recover -2000.
    expect(merge.alignment.value!.offsetMs).toBeCloseTo(-2000, -2)
    expect(merge.offsetMs.value).toBe(merge.alignment.value!.offsetMs)
    expect(merge.lastError.value).toBeNull()
  })

  it('nudge adjusts offsetMs by NUDGE_STEP_MS multiples without re-running correlation', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))

    const merge = useSessionMerge()
    merge.baseId.value = baseId
    merge.gpsId.value = gpsId
    merge.autoAlign()
    const before = merge.offsetMs.value!

    merge.nudge(NUDGE_STEP_MS)
    expect(merge.offsetMs.value).toBe(before + NUDGE_STEP_MS)

    merge.nudge(-NUDGE_STEP_MS * 2)
    expect(merge.offsetMs.value).toBe(before - NUDGE_STEP_MS)
  })

  it('nudge works even before autoAlign has run (starts from 0)', () => {
    const fileStore = useFileStore()
    fileStore.addMergedSession('base.loga', makeBase())
    const merge = useSessionMerge()
    expect(merge.offsetMs.value).toBeNull()
    merge.nudge(NUDGE_STEP_MS)
    expect(merge.offsetMs.value).toBe(NUDGE_STEP_MS)
  })

  it('merge registers a new ready session with GPS channels merged onto the base time axis', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))

    const merge = useSessionMerge()
    merge.baseId.value = baseId
    merge.gpsId.value = gpsId
    merge.autoAlign()
    expect(merge.canMerge.value).toBe(true)

    const newId = merge.merge()
    expect(newId).not.toBeNull()

    const newSession = fileStore.getSession(newId!)
    expect(newSession).toBeDefined()
    expect(newSession!.has('GPS_Lat')).toBe(true)
    expect(newSession!.has('GPS_Lon')).toBe(true)
    // Base's own channel data is preserved.
    expect(newSession!.get('GPS_Speed')).toBeDefined()

    const newFile = fileStore.files.find((f) => f.id === newId)
    expect(newFile?.fileType).toBe('merged')
    expect(newFile?.name).toBe('base_merged.loga')
  })

  it('merge returns null when offsetMs has not been established', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))

    const merge = useSessionMerge()
    merge.baseId.value = baseId
    merge.gpsId.value = gpsId
    expect(merge.merge()).toBeNull()
  })

  it('overlay is null until both sessions are picked and an offset exists', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))

    const merge = useSessionMerge()
    expect(merge.overlay.value).toBeNull()

    merge.baseId.value = baseId
    expect(merge.overlay.value).toBeNull() // gps side not picked yet

    merge.gpsId.value = gpsId
    expect(merge.overlay.value).toBeNull() // no offset established yet (autoAlign not run)

    merge.autoAlign()
    expect(merge.overlay.value).not.toBeNull()
  })

  it('overlay reflects the current offsetMs and updates live on nudge', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(2000))

    const merge = useSessionMerge()
    merge.baseId.value = baseId
    merge.gpsId.value = gpsId
    merge.autoAlign()

    const before = merge.overlay.value
    expect(before).not.toBeNull()
    expect(before!.timeS.length).toBeGreaterThan(0)
    expect(before!.base.length).toBe(before!.timeS.length)
    expect(before!.gps.length).toBe(before!.timeS.length)

    merge.nudge(NUDGE_STEP_MS)
    const after = merge.overlay.value
    expect(after).not.toBeNull()
    // Nudging the offset shifts the shared grid's union bounds, so the two
    // recomputed overlays should differ (not the identical object/array).
    expect(after).not.toBe(before)
  })

  it('overlay is null when offsetMs is reset to null by re-picking a session', () => {
    const fileStore = useFileStore()
    const baseId = fileStore.addMergedSession('base.loga', makeBase())
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))
    const gpsId2 = fileStore.addMergedSession('gps2.nmea', makeGps(500))

    const merge = useSessionMerge()
    merge.baseId.value = baseId
    merge.gpsId.value = gpsId
    merge.autoAlign()
    expect(merge.overlay.value).not.toBeNull()

    // Simulate the panel's own re-pick invalidation (SessionMergePanel.vue
    // watches [baseId, gpsId] and nulls alignment/offset on change) — the
    // composable itself doesn't auto-null offsetMs, so drive it explicitly.
    merge.gpsId.value = gpsId2
    merge.offsetMs.value = null
    expect(merge.overlay.value).toBeNull()
  })

  it('autoAlign sets lastError when a picked session has no resolvable speed channel', () => {
    const fileStore = useFileStore()
    const noSpeed = new LogSession(
      [channel('Time', [0, 100, 200]), channel('RPM', [1000, 2000, 3000])],
      { formatId: 'superX', createdDate: null, headerInfo: {} },
    )
    const baseId = fileStore.addMergedSession('nospeed.loga', noSpeed)
    const gpsId = fileStore.addMergedSession('gps.nmea', makeGps(0))

    const merge = useSessionMerge()
    merge.baseId.value = baseId
    merge.gpsId.value = gpsId
    // canAlign should already gate this off since resolveSpeedChannel(base) is null.
    expect(merge.canAlign.value).toBe(false)
    merge.autoAlign()
    expect(merge.alignment.value).toBeNull()
  })
})
