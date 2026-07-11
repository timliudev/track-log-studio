import { computed, type ComputedRef } from 'vue'
import { useFileStore } from '@/stores/fileStore'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { extractGpsTrack, hasGps } from '@/domain/analysis/gpsTrack'
import { categoricalColor } from '@/domain/analysis/colorPalette'
import { decimateGpsTrack, OVERLAY_MAX_POINTS, type TrackOverlayEntry } from '@/domain/analysis/trackOverlay'

/** One OTHER loaded session offered as a track-map overlay candidate. */
export interface OverlayCandidate {
  id: number
  name: string
  color: string
  /** Whether this candidate is currently toggled on (drawn on the map). */
  active: boolean
}

/**
 * Track-map multi-file overlay (賽道地圖多檔疊圖) wiring: lists every ready
 * session OTHER than the active one that has a usable GPS track as a
 * toggle-able overlay candidate, and derives the actual drawable entries
 * (decimated track + stable identity color) for whichever candidates are
 * currently on. The on/off SET itself lives in analyzerStore
 * (`selectedSessions`) alongside the page's other transient view toggles;
 * this composable just derives everything else from it + fileStore.
 *
 * Color is keyed by fileStore id (not by selection/toggle order), so a
 * session's color never reshuffles as OTHER sessions are toggled on/off —
 * only removing and re-adding files changes it, same as lap colors are keyed
 * by lap selection order but stable per session here since id is stable.
 */
export function useTrackOverlay(): {
  candidates: ComputedRef<OverlayCandidate[]>
  overlayTracks: ComputedRef<TrackOverlayEntry[]>
  toggle: (id: number) => void
  clear: () => void
} {
  const fileStore = useFileStore()
  const analyzer = useAnalyzerStore()

  // Every ready file except the active one, restricted to sessions that
  // actually have a GPS fix somewhere — a session with no track has nothing
  // to overlay, so it's left off the picker entirely rather than shown
  // disabled (there's no useful action to take on it here).
  const candidates = computed<OverlayCandidate[]>(() => {
    const activeId = analyzer.activeFileId
    const activeSet = new Set(analyzer.selectedSessions)
    return fileStore.readyFiles
      .filter((f) => f.id !== activeId)
      .filter((f) => {
        const session = fileStore.getSession(f.id)
        return session != null && hasGps(extractGpsTrack(session))
      })
      .map((f) => ({
        id: f.id,
        name: f.name,
        color: categoricalColor(f.id),
        active: activeSet.has(f.id),
      }))
  })

  // The actual drawable overlays: only currently-toggled-on candidates,
  // decimated for cheap rendering (see decimateGpsTrack's doc — the active
  // session's own track, drawn separately by TrackMap, is never decimated).
  // Built straight from analyzerStore.selectedSessions (not `candidates`) so a
  // toggled-on session that later BECOMES the active one is transparently
  // dropped (it's already drawn, at full opacity, as the active track) without
  // needing to also mutate selectedSessions.
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
      })
    }
    return out
  })

  function toggle(id: number): void {
    analyzer.toggleSessionComparison(id)
  }

  function clear(): void {
    analyzer.clearSessionComparisons()
  }

  return { candidates, overlayTracks, toggle, clear }
}
