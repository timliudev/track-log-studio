import type { LapLine } from '@/domain/analysis/laps'
import { circuitKeysMatch } from '@/domain/persist/circuitKey'
import type { PersonalTrackOverlayV1, TrackDefinitionV1 } from '@/domain/tracks/schema'

/**
 * §4.2 full auto-apply matching flow (①→②→③), Phase 2: consumes a SHARED
 * track library in addition to the local `PersonalTrackOverlayV1` lookup that
 * Phase 1 already implemented in full (`resolveGeometryToApply`). Kept in its
 * own module (not schema.ts) because it depends on `circuitKeysMatch` — a
 * `domain/persist` concept — and is one layer "above" the schema/validation
 * concerns schema.ts owns; both stay pure/store-agnostic so they're testable
 * without Vue reactivity or idb, same principle as `resolveGeometryToApply`.
 */

/** A SHARED track's geometry, reduced to what auto-apply needs to hand the
 *  store actions (`lapStore.setLine` / `sectorStore.loadDetected`) — same
 *  shape `resolveGeometryToApply` already returns for flow ①, so callers
 *  don't need to branch on which flow produced it. */
export interface AppliedGeometry {
  line: LapLine | null
  gates: LapLine[]
}

function toLine(gate: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }): LapLine {
  return { a: gate.a, b: gate.b }
}

/** Reduce a `TrackDefinitionV1` to the `{ line, gates }` shape store actions
 *  consume. Pure field mapping — SHARED tracks' gates are already sorted by
 *  the PR reviewer (§1.2), so no re-sort is needed here (unlike a user's
 *  manually-dropped gates, which need `sortGatesByPosition`). */
export function trackDefinitionGeometry(track: TrackDefinitionV1): AppliedGeometry {
  return {
    line: toLine(track.startFinishLine),
    gates: track.gates.map(toLine),
  }
}

/**
 * §4.2 flow ②: find every SHARED track whose `geo` matches `candidateKey`
 * within the existing `circuitKeysMatch` tolerance (~100 m). Returns an empty
 * array for "no match" (flow ③ territory), a single-element array for the
 * unambiguous case, or 2+ elements for the §4.3 "same venue, multiple layouts"
 * case the caller must resolve with a user choice (never auto-picks one).
 */
export function findMatchingTracks(
  candidateKey: string,
  library: readonly TrackDefinitionV1[],
): TrackDefinitionV1[] {
  return library.filter((t) => circuitKeysMatch(candidateKey, geoToKey(t.geo)))
}

/** A `TrackDefinitionV1.geo` point, reduced to the same `"lat,lon"` string
 *  shape `circuitKey()` produces so it can go through `circuitKeysMatch` —
 *  SHARED tracks don't have a raw GpsTrack to run the median-centroid
 *  computation on, so this mirrors just the string format, not the rounding
 *  (the tolerance check in `circuitKeysMatch` covers sub-grid differences). */
function geoToKey(geo: { lat: number; lon: number }): string {
  return `${geo.lat},${geo.lon}`
}

/**
 * The full §4.2 decision for one loaded log, given everything Phase 2 has
 * available: the local overlay (flow ①, if any) and the SHARED library (flow
 * ②). Does NOT decide UI — "ambiguous" is a distinct outcome the caller must
 * render as a picker (§4.3), not something this function guesses at.
 */
export type MatchResult =
  | { kind: 'localOverride'; geometry: AppliedGeometry }
  | { kind: 'sharedTrack'; track: TrackDefinitionV1; geometry: AppliedGeometry }
  | { kind: 'ambiguous'; candidates: TrackDefinitionV1[] }
  | { kind: 'none' }

/**
 * Resolve the full flow for `candidateKey`:
 *
 *  1. Flow ①: `overlay` present.
 *     - `localOverride` set → that wins outright (`localOverride` kind),
 *       regardless of `trackId` — a personal edit is never second-guessed.
 *     - no `localOverride` but `trackId` set → the user already picked (or
 *       auto-applied) this SHARED track before; look it up by id (NOT by
 *       geo — an explicit id match is exact, unlike the tolerance-based geo
 *       scan) and re-apply its current geometry (`sharedTrack` kind) so PR
 *       updates to that track are picked up on next load, per §4.4's "not
 *       detached" semantics.
 *     - overlay present but neither field set (shouldn't normally happen,
 *       but tolerated) → fall through to flow ②.
 *  2. Flow ②: no usable overlay → scan the SHARED library by geo.
 *     - exactly one match → auto-apply (`sharedTrack` kind).
 *     - 2+ matches → `ambiguous`, caller renders the §4.3 picker.
 *     - 0 matches → flow ③, `none`.
 */
export function resolveMatch(
  candidateKey: string,
  overlay: PersonalTrackOverlayV1 | null,
  library: readonly TrackDefinitionV1[],
): MatchResult {
  if (overlay?.localOverride) {
    return { kind: 'localOverride', geometry: overlay.localOverride }
  }
  if (overlay?.trackId) {
    const track = library.find((t) => t.id === overlay.trackId)
    if (track) {
      return { kind: 'sharedTrack', track, geometry: trackDefinitionGeometry(track) }
    }
    // trackId set but not found in the (possibly still-loading, or since
    // pruned) library — fall through to a fresh geo scan rather than
    // silently applying nothing, so a stale/renamed id still resolves.
  }

  const matches = findMatchingTracks(candidateKey, library)
  if (matches.length === 0) return { kind: 'none' }
  if (matches.length === 1) {
    return { kind: 'sharedTrack', track: matches[0], geometry: trackDefinitionGeometry(matches[0]) }
  }
  return { kind: 'ambiguous', candidates: matches }
}
