import type { GpsTrack } from './gpsTrack'

/**
 * One OTHER (comparison) recording's laps, as needed to resolve a cross-file
 * lap selection to a drawable track-map segment. Deliberately a narrow shape
 * (not the full `ComparisonSession`) so this module stays decoupled from
 * `useSessionComparison`'s composable-level concerns — the caller (AnalyzerView)
 * adapts `ComparisonSession[]` into this.
 */
export interface ComparisonLapHighlightSource {
  /** fileStore file id — matches `SessionLapRef.fileId`. */
  id: number
  /** Per-session identity color (categoricalColor(id)) — same one the faint
   *  overlay track and the comparison lap table already use for this session,
   *  so the map and the rest of the UI agree on "which color is this file". */
  color: string
  track: GpsTrack
  laps: { index: number; startIdx: number; endIdx: number }[]
  /** Manual map alignment in metres (east+/north+) — the SAME per-session
   *  offset the faint overlay track is drawn with (see useTrackOverlay.ts),
   *  not a per-lap nudge (cross-session laps have no separate map offset). */
  offset?: { x: number; y: number }
}

/** A stable reference to one lap in one (possibly non-primary) recording —
 *  structurally identical to lapStore's `SessionLapRef`, redeclared here so
 *  this domain module has no dependency on the store. */
export interface SessionLapRef {
  fileId: number
  index: number
}

/** One comparison-file lap resolved to a drawable track-map segment: its OWN
 *  track (not the primary session's), the lap's sample span within that
 *  track, and the color/offset to draw it with. */
export interface ComparisonLapHighlight {
  track: GpsTrack
  startIdx: number
  endIdx: number
  color: string
  offset?: { x: number; y: number }
}

/**
 * Resolve every cross-file lap selection (`lapStore.selectedAcrossSessions`)
 * to a `ComparisonLapHighlight`, so a lap selected from a DIFFERENT track-log
 * file can be drawn on the map exactly like a same-file selected lap — on its
 * own session's track, honoring that session's map offset. A ref whose
 * session isn't currently a comparison source, or whose lap index no longer
 * exists (session removed / laps re-detected), is silently dropped — the map
 * simply omits it, matching how a stale primary lap selection index is
 * filtered out by AnalyzerView's `selectedLaps`.
 */
export function buildComparisonLapHighlights(
  selected: SessionLapRef[],
  sessions: ComparisonLapHighlightSource[],
): ComparisonLapHighlight[] {
  const out: ComparisonLapHighlight[] = []
  for (const ref of selected) {
    const session = sessions.find((s) => s.id === ref.fileId)
    if (!session) continue
    const lap = session.laps.find((l) => l.index === ref.index)
    if (!lap) continue
    out.push({
      track: session.track,
      startIdx: lap.startIdx,
      endIdx: lap.endIdx,
      color: session.color,
      offset: session.offset,
    })
  }
  return out
}
