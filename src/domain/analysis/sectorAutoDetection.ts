import type { GpsTrack } from './gpsTrack'
import type { LapLine } from './laps'
import { cornerGateLine, detectCorners, pickReferenceLap } from './cornerDetection'
import type { Lap } from '@/domain/model/Lap'
import type { LogSession } from '@/domain/model/LogSession'

/** Where the current circuit's geometry resolution settled. */
export type CircuitGeometryOrigin = 'pending' | 'none' | 'saved' | 'shared' | 'ambiguous'

export type CircuitGeometryMatchKind = 'localOverride' | 'sharedTrack' | 'ambiguous' | 'none'

/** Convert persistence/library matching into the precedence used by B75. */
export function circuitGeometryOriginForRestore(
  matchKind: CircuitGeometryMatchKind,
  hadSavedRecord: boolean,
): CircuitGeometryOrigin {
  if (matchKind === 'localOverride') return 'saved'
  if (matchKind === 'sharedTrack') return 'shared'
  if (matchKind === 'ambiguous') return 'ambiguous'
  // A saved record without currently applicable geometry can still represent
  // an intentional empty setup, so only a truly absent record is `none`.
  return hadSavedRecord ? 'saved' : 'none'
}

export interface SectorAutoDetectionState {
  hasStartFinishLine: boolean
  gateCount: number
  geometryOrigin: CircuitGeometryOrigin
  userEdited: boolean
}

/**
 * Decide whether a circuit is eligible for the one-time sector-detection
 * fallback. An empty saved gate list is still saved geometry: it can represent
 * an intentional clear and therefore has the same precedence as non-empty
 * saved or track-library geometry.
 */
export function shouldAutoDetectSectorGates(state: SectorAutoDetectionState): boolean {
  return (
    state.geometryOrigin === 'none' &&
    state.hasStartFinishLine &&
    state.gateCount === 0 &&
    !state.userEdited
  )
}

/**
 * Detect a complete working gate set from the best plausible lap. `null`
 * means the required session/track/reference lap is not available yet; an
 * empty array is a completed detection that simply found no corners.
 */
export function detectSectorGates(
  session: LogSession | null,
  track: GpsTrack | null,
  laps: Lap[],
  excludedLapIndices: readonly number[],
): LapLine[] | null {
  if (!session || !track) return null
  const lap = pickReferenceLap(track, laps, excludedLapIndices)
  if (!lap) return null
  const { corners } = detectCorners(session, track, lap.startIdx, lap.endIdx)
  return corners.map((corner) => cornerGateLine(track, corner))
}
