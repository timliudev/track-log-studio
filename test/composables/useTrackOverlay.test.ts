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
  it('overlayTracks reflects only sessions toggled on via analyzerStore.selectedSessions', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    analyzer.activeFileId = aId

    const { overlayTracks } = useTrackOverlay()
    expect(overlayTracks.value).toHaveLength(0)

    analyzer.toggleSessionComparison(bId)
    expect(overlayTracks.value.map((o) => o.id)).toEqual([bId])
    expect(overlayTracks.value[0].label).toBe('b.nmea')
    expect(overlayTracks.value[0].color).toBe(categoricalColor(bId))
    analyzer.nudgeSessionOffset(bId, 'mapX', 2.5)
    analyzer.nudgeSessionOffset(bId, 'mapY', -1)
    expect(overlayTracks.value[0].offset).toEqual({ x: 2.5, y: -1 })

    analyzer.toggleSessionComparison(bId)
    expect(overlayTracks.value).toHaveLength(0)
  })

  it('excludes a toggled-on session with no usable GPS track from overlayTracks', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('no-gps.loga', noGpsSession())
    analyzer.activeFileId = aId

    const { overlayTracks } = useTrackOverlay()
    analyzer.toggleSessionComparison(bId)
    expect(overlayTracks.value).toHaveLength(0)
  })

  it('decimates an overlay track that exceeds the point budget', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(5000, 26, 122))
    analyzer.activeFileId = aId

    const { overlayTracks } = useTrackOverlay()
    analyzer.toggleSessionComparison(bId)
    expect(overlayTracks.value[0].track.lat.length).toBeLessThan(5000)
  })

  it('drops a toggled-on session from overlayTracks once it becomes the active session', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    analyzer.activeFileId = aId

    const { overlayTracks } = useTrackOverlay()
    analyzer.toggleSessionComparison(bId)
    expect(overlayTracks.value.map((o) => o.id)).toEqual([bId])

    analyzer.activeFileId = bId
    expect(overlayTracks.value).toHaveLength(0)
  })

  it('clearSessionComparisons() turns every overlay off', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    const cId = fileStore.addMergedSession('c.nmea', gpsSession(20, 27, 123))
    analyzer.activeFileId = aId

    const { overlayTracks } = useTrackOverlay()
    analyzer.toggleSessionComparison(bId)
    analyzer.toggleSessionComparison(cId)
    expect(overlayTracks.value).toHaveLength(2)
    analyzer.clearSessionComparisons()
    expect(overlayTracks.value).toHaveLength(0)
  })

  it('a stale id (file removed while toggled on) is silently dropped, not thrown', () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const aId = fileStore.addMergedSession('a.nmea', gpsSession())
    const bId = fileStore.addMergedSession('b.nmea', gpsSession(20, 26, 122))
    analyzer.activeFileId = aId

    const { overlayTracks } = useTrackOverlay()
    analyzer.toggleSessionComparison(bId)
    expect(overlayTracks.value).toHaveLength(1)

    fileStore.removeFile(bId)
    expect(overlayTracks.value).toHaveLength(0)
  })
})
