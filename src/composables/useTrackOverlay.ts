import { computed, type ComputedRef } from 'vue'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { extractGpsTrack, hasGps } from '@/domain/analysis/gpsTrack'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import { decimateGpsTrack, OVERLAY_MAX_POINTS, type TrackOverlayEntry } from '@/domain/analysis/trackOverlay'

/**
 * Track-map multi-file overlay (賽道地圖多檔疊圖) wiring: derives the actual
 * drawable entries (decimated track + stable identity color) for whichever
 * sessions are currently toggled on for comparison. The on/off SET itself
 * lives in analyzerStore (`selectedSessions`), driven by FileBar's 「加入分析」
 * checkbox, alongside the page's other transient view toggles; this
 * composable just derives the drawable overlays from it + fileStore.
 *
 * Color is keyed by fileStore id (not by selection/toggle order), so a
 * session's color never reshuffles as OTHER sessions are toggled on/off —
 * only removing and re-adding files changes it, same as lap colors are keyed
 * by lap selection order but stable per session here since id is stable.
 */
export function useTrackOverlay(): {
  overlayTracks: ComputedRef<TrackOverlayEntry[]>
} {
  const fileStore = useFileStore()
  const analyzer = useAnalyzerStore()

  // The actual drawable overlays: only currently-toggled-on sessions,
  // decimated for cheap rendering (see decimateGpsTrack's doc — the active
  // session's own track, drawn separately by TrackMap, is never decimated).
  // Built straight from analyzerStore.selectedSessions so a toggled-on
  // session that later BECOMES the active one is transparently dropped (it's
  // already drawn, at full opacity, as the active track) without needing to
  // also mutate selectedSessions.
  const overlayTracks = computed<TrackOverlayEntry[]>(() => {
    const activeId = analyzer.activeFileId
    const out: TrackOverlayEntry[] = []
    for (const id of analyzer.selectedSessions) {
      if (id === activeId) continue
      const file = fileStore.files.find((f) => f.id === id)
      const session = fileStore.getSession(id)
      if (!file || !session) continue
      const track = extractGpsTrack(session)
      if (!hasGps(track)) continue
      out.push({
        id,
        label: file.name,
        color: categoricalColor(id),
        track: decimateGpsTrack(track, OVERLAY_MAX_POINTS),
        offset: {
          x: analyzer.sessionOffsetOf(id).mapX,
          y: analyzer.sessionOffsetOf(id).mapY,
        },
      })
    }
    return out
  })

  return { overlayTracks }
}
