import { describe, expect, it } from 'vitest'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import { openBeltLengthMm } from '@/domain/analysis/cvtDynamics'
import {
  buildCvtDerivedTraces,
  cachedCvtDerivedTraces,
  cvtGeometryConfigError,
  type CvtTraceConfig,
} from '@/domain/analysis/cvtTrace'

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function session(): LogSession {
  return new LogSession([
    channel('RPM', [6000, 7000, 8000]),
    channel('GPS_Speed', [60, 70, 80]),
  ], { formatId: 'test', createdDate: null, headerInfo: {} })
}

function config(): CvtTraceConfig {
  const front = 42
  const rear = 84
  return {
    profileId: 'test-profile',
    wheelCircumferenceMm: 1000,
    gearReduction: 1,
    finalReduction: 1.5,
    pitchLengthMm: openBeltLengthMm(front, rear, 190),
    centerDistanceMm: 190,
    frontSheaveHalfAngleDeg: 14,
    rearSheaveHalfAngleDeg: 14,
    frontRadiusBoundsMm: { min: 30, max: 90 },
    rearRadiusBoundsMm: { min: 30, max: 100 },
    frontReferenceRadiusMm: front,
    rearReferenceRadiusMm: rear,
  }
}

describe('CVT derived traces', () => {
  it('computes pure ratio and every geometry series once in sample alignment', () => {
    const result = buildCvtDerivedTraces(session(), config())
    expect(result.totalRatioError).toBeNull()
    expect(result.geometryError).toBeNull()
    expect(Array.from(result.pureRatio ?? [])).toEqual([4, 4, 4])
    expect(result.frontRadiusMm).toHaveLength(3)
    expect(result.rearRadiusMm).toHaveLength(3)
    expect(result.frontDisplacementMm).toHaveLength(3)
    expect(result.rearDisplacementMm).toHaveLength(3)
    expect(result.geometryStatus).toHaveLength(3)
  })

  it('retains pure ratio when geometry parameters are missing', () => {
    const incomplete = { ...config(), pitchLengthMm: Number.NaN }
    const result = buildCvtDerivedTraces(session(), incomplete)
    expect(result.pureRatio).toHaveLength(3)
    expect(result.frontRadiusMm).toBeNull()
    expect(result.geometryError).toBe('belt-length')
  })

  it('reports each missing prerequisite without substituting a value', () => {
    expect(cvtGeometryConfigError({ ...config(), gearReduction: Number.NaN })).toBe('fixed-reduction')
    expect(cvtGeometryConfigError({ ...config(), centerDistanceMm: Number.NaN })).toBe('center-distance')
    expect(cvtGeometryConfigError({ ...config(), frontSheaveHalfAngleDeg: Number.NaN })).toBe('sheave-angle')
    expect(cvtGeometryConfigError({ ...config(), frontRadiusBoundsMm: null })).toBe('radius-bounds')
  })

  it('keys the shared arrays by immutable session, file id and parameter hash', () => {
    const log = session()
    const baseline = cachedCvtDerivedTraces(log, 7, config())
    const repeated = cachedCvtDerivedTraces(log, 7, config())
    const anotherFile = cachedCvtDerivedTraces(log, 8, config())
    const changedParams = cachedCvtDerivedTraces(log, 7, { ...config(), finalReduction: 1.6 })
    expect(repeated).toBe(baseline)
    expect(repeated.frontRadiusMm).toBe(baseline.frontRadiusMm)
    expect(anotherFile).not.toBe(baseline)
    expect(changedParams).not.toBe(baseline)
  })
})
