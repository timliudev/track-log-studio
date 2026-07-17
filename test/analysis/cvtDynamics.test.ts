import { describe, expect, it } from 'vitest'
import {
  approximateOpenBeltLengthMm,
  openBeltLengthMm,
  pitchLengthFromOutsideMm,
  pureCvtRatio,
  resolveFixedReduction,
  sheaveAngleMismatch,
  solveCvtGeometry,
} from '@/domain/analysis/cvtDynamics'

describe('CVT kinematics', () => {
  it('resolves either a direct reduction or multiple shaft tooth pairs', () => {
    expect(resolveFixedReduction({ mode: 'ratio', ratio: 9.4, stages: [] })).toBe(9.4)
    expect(
      resolveFixedReduction({
        mode: 'stages',
        ratio: 0,
        stages: [
          { driveTeeth: 13, drivenTeeth: 41 },
          { driveTeeth: 12, drivenTeeth: 36 },
        ],
      }),
    ).toBeCloseTo((41 / 13) * 3, 12)
  })

  it('converts an outside belt circumference only when cord depth is known', () => {
    expect(pitchLengthFromOutsideMm(875.1, 2.85)).toBeCloseTo(857.193, 3)
    expect(Number.isNaN(pitchLengthFromOutsideMm(875.1, 0))).toBe(true)
  })

  it('returns the exact 1:1 special case and equal wrap angles', () => {
    const radius = 68.3
    const center = 214
    const length = 2 * center + 2 * Math.PI * radius
    expect(openBeltLengthMm(radius, radius, center)).toBeCloseTo(length, 12)
    expect(approximateOpenBeltLengthMm(radius, radius, center)).toBeCloseTo(length, 12)

    const solved = solveCvtGeometry({
      pureRatio: 1,
      pitchLengthMm: length,
      centerDistanceMm: center,
      frontRadiusBoundsMm: { min: 40, max: 100 },
      rearRadiusBoundsMm: { min: 40, max: 100 },
      frontSheaveHalfAngleDeg: 14,
      rearSheaveHalfAngleDeg: 14,
    })
    expect(solved.status).toBe('ok')
    expect(solved.frontRadiusMm).toBeCloseTo(radius, 9)
    expect(solved.rearRadiusMm).toBeCloseTo(radius, 9)
    expect(solved.frontWrapAngleRad).toBeCloseTo(Math.PI, 12)
    expect(solved.rearWrapAngleRad).toBeCloseTo(Math.PI, 12)
  })

  it('recovers radii from exact length and ratio constraints', () => {
    const front = 42
    const rear = 84
    const center = 190
    const solved = solveCvtGeometry({
      pureRatio: rear / front,
      pitchLengthMm: openBeltLengthMm(front, rear, center),
      centerDistanceMm: center,
      frontRadiusBoundsMm: { min: 35, max: 80 },
      rearRadiusBoundsMm: { min: 55, max: 95 },
      frontReferenceRadiusMm: 42,
      rearReferenceRadiusMm: 84,
      frontSheaveHalfAngleDeg: 14,
      rearSheaveHalfAngleDeg: 14,
    })
    expect(solved.status).toBe('ok')
    expect(solved.frontRadiusMm).toBeCloseTo(front, 8)
    expect(solved.rearRadiusMm).toBeCloseTo(rear, 8)
    expect(Math.abs(solved.lengthResidualMm)).toBeLessThan(1e-7)
    expect(solved.frontDisplacementMm).toBeCloseTo(0, 8)
    expect(solved.rearDisplacementMm).toBeCloseTo(0, 8)
  })

  it('keeps a valid geometric root but reports measured-radius boundary excess', () => {
    const solved = solveCvtGeometry({
      pureRatio: 2,
      pitchLengthMm: openBeltLengthMm(42, 84, 190),
      centerDistanceMm: 190,
      frontRadiusBoundsMm: { min: 45, max: 80 },
      rearRadiusBoundsMm: { min: 55, max: 80 },
      frontSheaveHalfAngleDeg: 14,
      rearSheaveHalfAngleDeg: 14,
    })
    expect(solved.status).toBe('out-of-bounds')
    expect(solved.frontBoundsExcessRatio).toBeCloseTo(3 / 45, 8)
    expect(solved.rearBoundsExcessRatio).toBeCloseTo(4 / 80, 8)
  })

  it('rejects geometry whose belt length cannot produce a positive pitch radius', () => {
    const solved = solveCvtGeometry({
      pureRatio: 1,
      pitchLengthMm: 300,
      centerDistanceMm: 200,
      frontRadiusBoundsMm: { min: 20, max: 80 },
      rearRadiusBoundsMm: { min: 20, max: 80 },
      frontSheaveHalfAngleDeg: 14,
      rearSheaveHalfAngleDeg: 14,
    })
    expect(solved.status).toBe('no-root')
  })

  it('quantifies the documented 13.8°/14° mismatch without shifting pitch radii', () => {
    const mismatch = sheaveAngleMismatch(13.8, 14, 10)
    expect(mismatch).not.toBeNull()
    expect(mismatch!.displacementScaleDifferenceRatio).toBeCloseTo(0.0151, 3)
    expect(mismatch!.edgeWidthDifferenceMm).toBeCloseTo(0.074, 3)
    expect(mismatch!.wedgeGainDifferenceRatio).toBeCloseTo(0.0142, 3)
  })

  it('uses the agreed total / gear / final reduction direction', () => {
    expect(pureCvtRatio(30, 2, 5)).toBe(3)
  })
})
