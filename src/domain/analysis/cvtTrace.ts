import type { LogSession } from '@/domain/model/LogSession'
import { cachedGearRatioTrace, type GearRatioTraceError } from '@/domain/analysis/gearRatioTrace'
import { pureCvtRatio, solveCvtGeometry, type RadiusBoundsMm } from '@/domain/analysis/cvtDynamics'

export const PURE_CVT_RATIO_CHANNEL = '@derived/cvt/pure-ratio'
export const CVT_FRONT_RADIUS_CHANNEL = '@derived/cvt/front-pitch-radius-mm'
export const CVT_REAR_RADIUS_CHANNEL = '@derived/cvt/rear-pitch-radius-mm'
export const CVT_FRONT_DISPLACEMENT_CHANNEL = '@derived/cvt/front-sheave-displacement-mm'
export const CVT_REAR_DISPLACEMENT_CHANNEL = '@derived/cvt/rear-sheave-displacement-mm'

export const CVT_DERIVED_CHANNELS = [
  PURE_CVT_RATIO_CHANNEL,
  CVT_FRONT_RADIUS_CHANNEL,
  CVT_REAR_RADIUS_CHANNEL,
  CVT_FRONT_DISPLACEMENT_CHANNEL,
  CVT_REAR_DISPLACEMENT_CHANNEL,
] as const

export type CvtDerivedChannelId = (typeof CVT_DERIVED_CHANNELS)[number]
export type CvtTraceError =
  | GearRatioTraceError
  | 'fixed-reduction'
  | 'belt-length'
  | 'center-distance'
  | 'sheave-angle'
  | 'radius-bounds'

export interface CvtTraceConfig {
  profileId: string
  wheelCircumferenceMm: number
  gearReduction: number
  finalReduction: number
  pitchLengthMm: number
  centerDistanceMm: number
  frontSheaveHalfAngleDeg: number
  rearSheaveHalfAngleDeg: number
  frontRadiusBoundsMm: RadiusBoundsMm | null
  rearRadiusBoundsMm: RadiusBoundsMm | null
  frontReferenceRadiusMm: number
  rearReferenceRadiusMm: number
}

export interface CvtDerivedTraceSet {
  pureRatio: Float64Array | null
  frontRadiusMm: Float64Array | null
  rearRadiusMm: Float64Array | null
  frontDisplacementMm: Float64Array | null
  rearDisplacementMm: Float64Array | null
  /** 0=inside bounds, 1=outside measured bounds, 2=no geometric root. */
  geometryStatus: Uint8Array | null
  totalRatioError: GearRatioTraceError | null
  geometryError: CvtTraceError | null
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function validBounds(value: RadiusBoundsMm | null): value is RadiusBoundsMm {
  return value != null && positive(value.min) && positive(value.max) && value.max >= value.min
}

export function cvtGeometryConfigError(config: CvtTraceConfig): CvtTraceError | null {
  if (!positive(config.gearReduction) || !positive(config.finalReduction)) return 'fixed-reduction'
  if (!positive(config.pitchLengthMm)) return 'belt-length'
  if (!positive(config.centerDistanceMm)) return 'center-distance'
  if (!positive(config.frontSheaveHalfAngleDeg) || !positive(config.rearSheaveHalfAngleDeg)) return 'sheave-angle'
  if (!validBounds(config.frontRadiusBoundsMm) || !validBounds(config.rearRadiusBoundsMm)) return 'radius-bounds'
  return null
}

export function cvtTraceConfigHash(config: CvtTraceConfig): string {
  return JSON.stringify([
    config.profileId,
    config.wheelCircumferenceMm,
    config.gearReduction,
    config.finalReduction,
    config.pitchLengthMm,
    config.centerDistanceMm,
    config.frontSheaveHalfAngleDeg,
    config.rearSheaveHalfAngleDeg,
    config.frontRadiusBoundsMm?.min ?? null,
    config.frontRadiusBoundsMm?.max ?? null,
    config.rearRadiusBoundsMm?.min ?? null,
    config.rearRadiusBoundsMm?.max ?? null,
    config.frontReferenceRadiusMm,
    config.rearReferenceRadiusMm,
  ])
}

export function buildCvtDerivedTraces(session: LogSession, config: CvtTraceConfig): CvtDerivedTraceSet {
  const total = cachedGearRatioTrace(session, config.wheelCircumferenceMm)
  if (!total.data) {
    return {
      pureRatio: null,
      frontRadiusMm: null,
      rearRadiusMm: null,
      frontDisplacementMm: null,
      rearDisplacementMm: null,
      geometryStatus: null,
      totalRatioError: total.error,
      geometryError: total.error,
    }
  }
  if (!positive(config.gearReduction) || !positive(config.finalReduction)) {
    return {
      pureRatio: null,
      frontRadiusMm: null,
      rearRadiusMm: null,
      frontDisplacementMm: null,
      rearDisplacementMm: null,
      geometryStatus: null,
      totalRatioError: null,
      geometryError: 'fixed-reduction',
    }
  }

  const count = session.rowCount
  const pureRatio = new Float64Array(count).fill(Number.NaN)
  for (let index = 0; index < count; index += 1) {
    pureRatio[index] = pureCvtRatio(total.data[index], config.gearReduction, config.finalReduction)
  }

  const geometryError = cvtGeometryConfigError(config)
  if (geometryError) {
    return {
      pureRatio,
      frontRadiusMm: null,
      rearRadiusMm: null,
      frontDisplacementMm: null,
      rearDisplacementMm: null,
      geometryStatus: null,
      totalRatioError: null,
      geometryError,
    }
  }

  const frontRadiusMm = new Float64Array(count).fill(Number.NaN)
  const rearRadiusMm = new Float64Array(count).fill(Number.NaN)
  const frontDisplacementMm = new Float64Array(count).fill(Number.NaN)
  const rearDisplacementMm = new Float64Array(count).fill(Number.NaN)
  const geometryStatus = new Uint8Array(count).fill(2)
  for (let index = 0; index < count; index += 1) {
    const ratio = pureRatio[index]
    if (!positive(ratio)) continue
    const solution = solveCvtGeometry({
      pureRatio: ratio,
      pitchLengthMm: config.pitchLengthMm,
      centerDistanceMm: config.centerDistanceMm,
      frontRadiusBoundsMm: config.frontRadiusBoundsMm!,
      rearRadiusBoundsMm: config.rearRadiusBoundsMm!,
      frontReferenceRadiusMm: config.frontReferenceRadiusMm,
      rearReferenceRadiusMm: config.rearReferenceRadiusMm,
      frontSheaveHalfAngleDeg: config.frontSheaveHalfAngleDeg,
      rearSheaveHalfAngleDeg: config.rearSheaveHalfAngleDeg,
    })
    if (solution.status !== 'ok' && solution.status !== 'out-of-bounds') continue
    frontRadiusMm[index] = solution.frontRadiusMm
    rearRadiusMm[index] = solution.rearRadiusMm
    frontDisplacementMm[index] = solution.frontDisplacementMm
    rearDisplacementMm[index] = solution.rearDisplacementMm
    geometryStatus[index] = solution.status === 'ok' ? 0 : 1
  }
  return {
    pureRatio,
    frontRadiusMm,
    rearRadiusMm,
    frontDisplacementMm,
    rearDisplacementMm,
    geometryStatus,
    totalRatioError: null,
    geometryError: null,
  }
}

const traceCache = new WeakMap<LogSession, Map<string, CvtDerivedTraceSet>>()

/** Cache all CVT series together so cursor consumers never invoke a solver. */
export function cachedCvtDerivedTraces(
  session: LogSession,
  fileId: number | string,
  config: CvtTraceConfig,
): CvtDerivedTraceSet {
  let entries = traceCache.get(session)
  if (!entries) {
    entries = new Map()
    traceCache.set(session, entries)
  }
  const key = `${fileId}|${cvtTraceConfigHash(config)}`
  const cached = entries.get(key)
  if (cached) return cached
  const result = buildCvtDerivedTraces(session, config)
  entries.set(key, result)
  return result
}

export function cvtChannelData(result: CvtDerivedTraceSet, channelId: CvtDerivedChannelId): Float64Array | null {
  switch (channelId) {
    case PURE_CVT_RATIO_CHANNEL: return result.pureRatio
    case CVT_FRONT_RADIUS_CHANNEL: return result.frontRadiusMm
    case CVT_REAR_RADIUS_CHANNEL: return result.rearRadiusMm
    case CVT_FRONT_DISPLACEMENT_CHANNEL: return result.frontDisplacementMm
    case CVT_REAR_DISPLACEMENT_CHANNEL: return result.rearDisplacementMm
  }
}

export function cvtChannelError(result: CvtDerivedTraceSet, channelId: CvtDerivedChannelId): CvtTraceError | null {
  if (result.totalRatioError) return result.totalRatioError
  if (channelId === PURE_CVT_RATIO_CHANNEL) return result.pureRatio ? null : result.geometryError
  return cvtChannelData(result, channelId) ? null : result.geometryError
}
