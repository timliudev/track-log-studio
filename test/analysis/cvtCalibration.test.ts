import { describe, expect, it } from 'vitest'
import {
  calibrationScaleAtRatio,
  inferFixedReductionFromSegment,
  solveEquilibriumRpmAtRatio,
  sweepTotalRollerMass,
} from '@/domain/analysis/cvtCalibration'
import type { CvtForceBalanceInput } from '@/domain/analysis/cvtForceBalance'

const forceInput = (): CvtForceBalanceInput => ({
  actuationKind: 'mechanical',
  geometry: {
    pitchLengthMm: 800,
    centerDistanceMm: 250,
    frontRadiusBoundsMm: { min: 32, max: 70 },
    rearRadiusBoundsMm: { min: 32, max: 70 },
    frontReferenceRadiusMm: 32,
    rearReferenceRadiusMm: 70,
    frontSheaveHalfAngleDeg: 14,
    rearSheaveHalfAngleDeg: 14,
  },
  frontRpm: 3000,
  rearTorqueNm: 0,
  roller: {
    massesG: [9, 9, 9, 9, 9, 9],
    track: [{ travelMm: 0, radiusMm: 25 }, { travelMm: 20, radiusMm: 45 }],
    efficiency: 1,
  },
  spring: { mode: 'linear', rateNPerMm: 8, installedPreloadMm: 10 },
  torqueCam: null,
  coupling: { mode: 'ideal', calibratedScale: null },
})

describe('CVT vehicle calibration', () => {
  it('infers combined fixed reduction from an explicitly bounded steady segment', () => {
    const total = new Float64Array([10, 10.01, 9.99, 10, 4])
    const result = inferFixedReductionFromSegment(total, 0, 3, 0.8)
    expect(result.status).toBe('ok')
    expect(result.combinedFixedReduction).toBeCloseTo(12.5, 3)
    expect(result.sampleCount).toBe(4)
  })

  it('flags a visibly wandering segment instead of promoting its fallback', () => {
    const result = inferFixedReductionFromSegment([10, 11, 9, 10.5], 0, 3, 0.8)
    expect(result.status).toBe('unstable')
  })

  it('interpolates inside a directional calibration map without extrapolating', () => {
    const map = [{ ratio: 1, scale: 0.9 }, { ratio: 2, scale: 1.1 }]
    expect(calibrationScaleAtRatio(map, 1.5)).toBeCloseTo(1)
    expect(calibrationScaleAtRatio(map, 2.2)).toBeNaN()
  })

  it('solves fixed-ratio equilibrium rpm and reproduces the inverse-square-root mass direction', () => {
    const input = forceInput()
    const nominal = solveEquilibriumRpmAtRatio(input, 1)
    expect(nominal).toBeGreaterThan(500)
    const result = sweepTotalRollerMass(input, [1], 1)
    expect(result.status).toBe('ok')
    expect(result.points[0].lighterDeltaRpm).toBeGreaterThan(0)
    expect(result.points[0].heavierDeltaRpm).toBeLessThan(0)
    const analyticHeavier = nominal * Math.sqrt(54 / 55)
    expect(result.points[0].heavierRpm).toBeCloseTo(analyticHeavier, 5)
  })

  it('does not emit sensitivity values when the physical layer is incomplete', () => {
    const result = sweepTotalRollerMass({ ...forceInput(), spring: null }, [1], 1)
    expect(result.status).toBe('disabled')
    expect(result.points).toEqual([])
  })
})
