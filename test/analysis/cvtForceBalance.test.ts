import { describe, expect, it } from 'vitest'
import {
  interpolateForceCurve,
  rearCamForceN,
  rearSpringForceN,
  rollerAxialForceN,
  rollerTrackState,
  solveCvtForceBalance,
  type CvtForceBalanceInput,
} from '@/domain/analysis/cvtForceBalance'

const geometry = {
  pitchLengthMm: 800,
  centerDistanceMm: 250,
  frontRadiusBoundsMm: { min: 32, max: 70 },
  rearRadiusBoundsMm: { min: 32, max: 70 },
  frontReferenceRadiusMm: 32,
  rearReferenceRadiusMm: 70,
  frontSheaveHalfAngleDeg: 14,
  rearSheaveHalfAngleDeg: 14,
}

const completeInput = (): CvtForceBalanceInput => ({
  actuationKind: 'mechanical',
  geometry,
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

describe('CVT force-balance building blocks', () => {
  it('interpolates measured force curves only inside measured travel', () => {
    const points = [{ travelMm: 0, value: 100 }, { travelMm: 10, value: 180 }]
    expect(interpolateForceCurve(points, 2.5)).toBe(120)
    expect(interpolateForceCurve(points, 11)).toBeNaN()
  })

  it('a straight roller track has the same local and finite-displacement dr/dx', () => {
    const points = [{ travelMm: 0, radiusMm: 20 }, { travelMm: 12, radiusMm: 26 }]
    const state = rollerTrackState(points, 7)
    expect(state?.slope).toBeCloseTo((26 - 20) / 12, 12)
    expect(state?.radiusMm).toBeCloseTo(23.5, 12)
  })

  it('rejects a non-physical roller path whose radius turns inward', () => {
    expect(rollerTrackState([{ travelMm: 0, radiusMm: 25 }, { travelMm: 4, radiusMm: 24 }], 2)).toBeNull()
  })

  it('converts g, mm and rpm consistently in the roller axial-force formula', () => {
    const rpm = 6000
    const expected = 0.054 * (rpm * 2 * Math.PI / 60) ** 2 * 0.03 * 0.5
    expect(rollerAxialForceN({
      massesG: [9, 9, 9, 9, 9, 9],
      track: [{ travelMm: 0, radiusMm: 25 }, { travelMm: 10, radiusMm: 30 }],
      efficiency: 1,
    }, 10, rpm)).toBeCloseTo(expected, 10)
  })

  it('keeps spring preload separate from additional travel', () => {
    expect(rearSpringForceN({ mode: 'linear', rateNPerMm: 12, installedPreloadMm: 8 }, 3)).toBe(132)
  })

  it('uses a circumferential torque-cam angle and an explicit torque share', () => {
    const force = rearCamForceN({
      points: [
        { travelMm: 0, angleDeg: 45, effectiveRadiusMm: 50 },
        { travelMm: 10, angleDeg: 45, effectiveRadiusMm: 50 },
      ],
      torqueShare: 0.5,
      torsionTorqueNm: 0,
    }, 5, 20)
    expect(force).toBeCloseTo(200, 10)
  })
})

describe('CVT quasi-static equilibrium', () => {
  it('finds at least one equilibrium when the force residual crosses zero', () => {
    const result = solveCvtForceBalance(completeInput())
    expect(result.status).toBe('equilibrium')
    expect(result.roots.length).toBeGreaterThan(0)
    expect(Math.abs(result.selected?.residualN ?? 1)).toBeLessThan(1e-4)
    expect(result.selected?.geometry.status).toBe('ok')
  })

  it('reports concrete missing layers instead of calculating with invented values', () => {
    const result = solveCvtForceBalance({
      ...completeInput(),
      roller: { massesG: [9, 9, 9, 9, 9, 9], track: [], efficiency: null },
      spring: null,
      coupling: { mode: 'disabled', calibratedScale: null },
    })
    expect(result.status).toBe('disabled')
    expect(result.disabledReasons).toEqual(expect.arrayContaining([
      'roller-track', 'roller-efficiency', 'rear-spring', 'coupling',
    ]))
    expect(result.curve).toHaveLength(0)
  })

  it('does not apply the mechanical roller model to an electronically actuated CVT', () => {
    const result = solveCvtForceBalance({ ...completeInput(), actuationKind: 'electronic' })
    expect(result.status).toBe('disabled')
    expect(result.disabledReasons).toContain('electronic-actuation')
  })

  it('requires cam geometry and torque share only for a loaded condition', () => {
    const result = solveCvtForceBalance({ ...completeInput(), rearTorqueNm: 25 })
    expect(result.disabledReasons).toEqual(expect.arrayContaining(['torque-cam', 'torque-share']))
  })
})
