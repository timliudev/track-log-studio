import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect } from 'vitest'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useTrackOverlay } from '@/composables/useTrackOverlay'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** A session with a usable decimal-degree GPS track (GPS_Lat/GPS_Lon), n samples. */
function gpsSession(n = 20, latBase = 25, lonBase = 121): LogSession {
  const lat = Array.from({ length: n }, (_, i) => latBase + i * 0.0001)
  const lon = Array.from({ length: n }, (_, i) => lonBase + i * 0.0001)
  return new LogSession([channel('GPS_Lat', lat), channel('GPS_Lon', lon)], {
    formatId: 'nmea',
    createdDate: null,
    headerInfo: {},
  })
}

/** A session with no GPS channels at all. */
function noGpsSession(n = 20): LogSession {
  return new LogSession([channel('RPM', new Array(n).fill(5000))], {
    formatId: 'loga',
    createdDate: null,
    headerInfo: {},
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('useTrackOverlay', () => {
  it('lists ready GPS sessions other than the active one as candidates', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    analyzer.activeFileId = aId

    const { candidates } = useTrackOverlay()
    expect(candidates.value.map((c) => c.id)).toEqual([bId])
    expect(candidates.value[0].active).toBe(false)
  })

  it('excludes sessions with no usable GPS track from candidates', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    fileStore.addMergedSession('no-gps.loga', noGpsSession())
    analyzer.activeFileId = aId

    const { candidates } = useTrackOverlay()
    expect(candidates.value).toHaveLength(0)
  })

  it('toggle() flips a candidate on/off and overlayTracks reflects only the ON ones', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    analyzer.activeFileId = aId

    const { candidates, overlayTracks, toggle } = useTrackOverlay()
    expect(overlayTracks.value).toHaveLength(0)

    toggle(bId)
    expect(candidates.value.find((c) => c.id === bId)?.active).toBe(true)
    expect(overlayTracks.value.map((o) => o.id)).toEqual([bId])
    expect(overlayTracks.value[0].label).toBe('b.nmea')
    expect(overlayTracks.value[0].color).toBe(categoricalColor(bId))

    toggle(bId)
    expect(overlayTracks.value).toHaveLength(0)
  })

  it('decimates an overlay track that exceeds the point budget', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(5000, 26, 122))
    analyzer.activeFileId = aId

    const { overlayTracks, toggle } = useTrackOverlay()
    toggle(bId)
    expect(overlayTracks.value[0].track.lat.length).toBeLessThan(5000)
  })

  it('drops a toggled-on session from overlayTracks once it becomes the active session', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    analyzer.activeFileId = aId

    const { overlayTracks, toggle } = useTrackOverlay()
    toggle(bId)
    expect(overlayTracks.value.map((o) => o.id)).toEqual([bId])

    analyzer.activeFileId = bId
    expect(overlayTracks.value).toHaveLength(0)
  })

  it('clear() turns every overlay off', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    const cId = fileStore.addMergedSession('c.nmea', gpsSession(20, 27, 123))
    analyzer.activeFileId = aId

    const { overlayTracks, toggle, clear } = useTrackOverlay()
    toggle(bId)
    toggle(cId)
    expect(overlayTracks.value).toHaveLength(2)
    clear()
    expect(overlayTracks.value).toHaveLength(0)
  })

  it('a stale id (file removed while toggled on) is silently dropped, not thrown', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    analyzer.activeFileId = aId

    const { overlayTracks, toggle } = useTrackOverlay()
    toggle(bId)
    expect(overlayTracks.value).toHaveLength(1)

    fileStore.removeFile(bId)
    expect(overlayTracks.value).toHaveLength(0)
  })
})
