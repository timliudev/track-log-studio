import { detectChannelExtrema, normalizeChannelExtrema, type NormalizedChannelExtremum } from './cornerSpeed'
import type { GpsTrack } from './gpsTrack'

/** A stable reference to one lap in one (possibly non-primary) recording —
 *  structurally identical to lapStore's `SessionLapRef`, redeclared here so
 *  this domain module has no dependency on the store (same pattern as
 *  `crossSessionLapHighlight.ts`'s own `SessionLapRef`). */
export interface SessionLapRef {
  fileId: number
  index: number
}

/** One comparison recording's data as needed to compute ITS OWN track-channel
 *  extrema markers. Deliberately a narrow shape (not the full
 *  `ComparisonSession`) so this module stays decoupled from
 *  `useSessionComparison` — the caller (AnalyzerView) adapts. `channelData`
 *  is null when the chosen `trackChannel` doesn't exist on this session (a
 *  comparison file need not share every channel with the primary). */
export interface ComparisonExtremaSource {
  /** fileStore file id — matches `SessionLapRef.fileId`. */
  fileId: number
  track: GpsTrack
  channelData: ArrayLike<number> | null
  laps: { index: number; startIdx: number; endIdx: number }[]
}

/**
 * B33: track-channel min/max markers for COMPARISON files' own selected laps
 * — the map-side counterpart of `crossSessionLapHighlight.ts`'s
 * `buildComparisonLapHighlights` (which does the same "resolve a cross-file
 * lap selection to something drawable on that file's own track" job for the
 * bright lap-segment highlight, not the extrema markers).
 *
 * Root cause this fixes: `useTrackExtrema.ts`'s `focusedLap` (single-lap
 * rule) was derived ONLY from the primary session's own `lapStore.selected`,
 * so a lap selected on a comparison file never lit up markers at all — the
 * primary just silently fell back to its whole-track pair (or nothing,
 * depending on the primary's OWN selection), regardless of what was selected
 * on any comparison file.
 *
 * Per-file single-lap rule: a comparison session only contributes markers
 * when EXACTLY ONE of ITS OWN laps is selected — mirrors the existing
 * "extrema are only meaningful for one lap at a time" rule from
 * `useTrackExtrema.ts`, applied independently per file (the primary and each
 * comparison file have their own, unrelated lap selections; a comparison file
 * with 0 or 2+ of its own laps selected contributes nothing, same as the
 * primary would). No whole-track fallback here (unlike the primary's B6
 * fallback) — a comparison file only lights up when the user has actually
 * selected one of ITS laps, per the issue's "any selected lap ... should
 * light up markers on its own trace".
 *
 * Each source's extrema are normalised (`normalizeChannelExtrema`)
 * INDEPENDENTLY before merging into the returned array, so a marker's
 * green/red colour gradient always stays meaningful within its own lap's
 * value range even when multiple files' markers are shown on the map at once
 * (see that function's doc for why this can't be a single normalise-after-
 * concat pass).
 */
export function buildComparisonExtremaMarkers(
  selected: SessionLapRef[],
  sources: ComparisonExtremaSource[],
  markMinima: boolean,
  markMaxima: boolean,
): NormalizedChannelExtremum[] {
  if (!markMinima && !markMaxima) return []
  const out: NormalizedChannelExtremum[] = []
  for (const source of sources) {
    if (!source.channelData) continue
    const ownSelected = selected.filter((ref) => ref.fileId === source.fileId)
    if (ownSelected.length !== 1) continue
    const lap = source.laps.find((l) => l.index === ownSelected[0].index)
    if (!lap) continue

    const extrema = [
      ...(markMinima
        ? detectChannelExtrema(source.track, source.channelData, lap.startIdx, lap.endIdx, { mode: 'min' })
        : []),
      ...(markMaxima
        ? detectChannelExtrema(source.track, source.channelData, lap.startIdx, lap.endIdx, { mode: 'max' })
        : []),
    ]
    out.push(...normalizeChannelExtrema(extrema))
  }
  return out
}
