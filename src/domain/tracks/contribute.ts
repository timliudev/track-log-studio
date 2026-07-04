import type { LapLine } from '@/domain/analysis/laps'
import { circuitCentroid } from '@/domain/persist/circuitKey'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { TrackDefinitionV1 } from '@/domain/tracks/schema'

/**
 * User-supplied metadata a `CircuitSetup`/`PersonalTrackOverlayV1` doesn't
 * carry (§1.2's SHARED-only fields) needed to turn a personal setup into a
 * PR-ready `TrackDefinitionV1` draft — docs/CLOUD-TRACK-DESIGN.md §2.4 step 1:
 * "在 Track Log Studio 匯出目前 CircuitSetup → 用轉換腳本（待寫）轉成
 * TrackDefinitionV1 形狀". This is that conversion, done client-side (no
 * external script needed) — the id/name/countryCode/license fields simply
 * aren't derivable from the personal setup or the GPS track alone, so the UI
 * collects them from the contributor.
 */
export interface TrackContributionInput {
  id: string
  /** Display name for at least one locale — kept as a flat pair here (the UI
   *  only collects one language at a time); callers wanting multiple locales
   *  populated can merge additional entries into `name` after the fact. */
  locale: string
  name: string
  countryCode: string
  license: string
}

/**
 * Build a `TrackDefinitionV1` draft from a `GpsTrack` (for `geo`, reusing the
 * same centroid calculation `circuitKey` uses — §4.1's "same math on both
 * sides" principle) plus the currently-drawn `line`/`gates` and the
 * contributor-supplied metadata. Returns `null` if the track has no valid GPS
 * fix (nothing to derive `geo` from) or if `line` is unset (nothing to put in
 * `startFinishLine` — a SHARED track without a start/finish line isn't
 * meaningful).
 *
 * `updatedAt` is deliberately today's date (ISO, date-only per §1.2) rather
 * than left for the contributor to fill in by hand — matches the "PR merged
 * by CI/maintainer" note in the schema (a draft exported today will usually
 * be PR'd close to today; the maintainer can correct it on merge if the PR
 * takes a while).
 */
export function buildTrackContributionDraft(
  track: GpsTrack,
  geometry: { line: LapLine | null; gates: LapLine[] },
  input: TrackContributionInput,
): TrackDefinitionV1 | null {
  const centroid = circuitCentroid(track)
  if (!centroid || !geometry.line) return null

  return {
    schemaVersion: 1,
    id: input.id,
    name: { [input.locale]: input.name },
    geo: centroid,
    countryCode: input.countryCode.toUpperCase(),
    startFinishLine: geometry.line,
    gates: geometry.gates,
    license: input.license,
    updatedAt: new Date().toISOString().slice(0, 10),
  }
}
