import { describe, it, expect } from 'vitest'
import {
  parseEngineCurveText,
  diagnoseCurveProfile,
  curveValueToTorqueNm,
  powerValueToKw,
  buildTwoPointProfile,
  buildCurveProfile,
  buildEngineProfile,
  defaultEngineProfileFormState,
  type EngineTwoPointFormState,
} from '@/domain/analysis/engineProfileForm'
import { createEngineCurveProfile, torqueNmFromPowerKw, hpToKw } from '@/domain/analysis/gearRecommendation'

describe('powerValueToKw', () => {
  it('passes kW through unchanged', () => {
    expect(powerValueToKw(50, 'kW')).toBe(50)
  })
  it('converts metric PS via hpToKw', () => {
    expect(powerValueToKw(50, 'PS')).toBeCloseTo(hpToKw(50, 'metric'), 6)
  })
  it('converts mechanical hp via hpToKw', () => {
    expect(powerValueToKw(50, 'hp')).toBeCloseTo(hpToKw(50, 'mechanical'), 6)
  })
  it('rejects non-finite/non-positive input', () => {
    expect(Number.isNaN(powerValueToKw(0, 'kW'))).toBe(true)
    expect(Number.isNaN(powerValueToKw(-5, 'kW'))).toBe(true)
    expect(Number.isNaN(powerValueToKw(NaN, 'kW'))).toBe(true)
  })
})

describe('curveValueToTorqueNm', () => {
  it('passes Nm through unchanged', () => {
    expect(curveValueToTorqueNm(8000, 42, 'Nm')).toBe(42)
  })
  it('converts kW at a given rpm the same way torqueNmFromPowerKw does', () => {
    expect(curveValueToTorqueNm(8000, 40, 'kW')).toBeCloseTo(torqueNmFromPowerKw(40, 8000), 6)
  })
  it('converts PS/hp through the power-then-torque chain', () => {
    const viaPs = curveValueToTorqueNm(8000, 54, 'PS')
    expect(viaPs).toBeCloseTo(torqueNmFromPowerKw(hpToKw(54, 'metric'), 8000), 6)
  })
  it('rejects non-finite/non-positive rpm or value', () => {
    expect(Number.isNaN(curveValueToTorqueNm(0, 40, 'Nm'))).toBe(true)
    expect(Number.isNaN(curveValueToTorqueNm(8000, -1, 'Nm'))).toBe(true)
    expect(Number.isNaN(curveValueToTorqueNm(NaN, 40, 'Nm'))).toBe(true)
  })
})

describe('parseEngineCurveText', () => {
  it('parses comma-separated rows', () => {
    const { points, skippedLines } = parseEngineCurveText('3000,40\n6000,55\n9000,48', 'Nm')
    expect(points).toEqual([
      { rpm: 3000, torqueNm: 40 },
      { rpm: 6000, torqueNm: 55 },
      { rpm: 9000, torqueNm: 48 },
    ])
    expect(skippedLines).toBe(0)
  })

  it('parses tab-separated rows', () => {
    const { points } = parseEngineCurveText('3000\t40\n6000\t55', 'Nm')
    expect(points).toEqual([
      { rpm: 3000, torqueNm: 40 },
      { rpm: 6000, torqueNm: 55 },
    ])
  })

  it('parses whitespace-separated rows', () => {
    const { points } = parseEngineCurveText('3000 40\n6000   55', 'Nm')
    expect(points).toEqual([
      { rpm: 3000, torqueNm: 40 },
      { rpm: 6000, torqueNm: 55 },
    ])
  })

  it('tolerates a header row without special-casing it', () => {
    const { points, skippedLines } = parseEngineCurveText('rpm,torque(Nm)\n3000,40\n6000,55', 'Nm')
    expect(points).toEqual([
      { rpm: 3000, torqueNm: 40 },
      { rpm: 6000, torqueNm: 55 },
    ])
    expect(skippedLines).toBe(1)
  })

  it('ignores blank lines without counting them as skipped', () => {
    const { points, skippedLines } = parseEngineCurveText('3000,40\n\n\n6000,55\n', 'Nm')
    expect(points).toHaveLength(2)
    expect(skippedLines).toBe(0)
  })

  it('skips lines with fewer than two fields', () => {
    const { points, skippedLines } = parseEngineCurveText('3000\n6000,55', 'Nm')
    expect(points).toEqual([{ rpm: 6000, torqueNm: 55 }])
    expect(skippedLines).toBe(1)
  })

  it('skips non-finite/non-positive rpm or value', () => {
    const { points, skippedLines } = parseEngineCurveText('-100,40\n6000,-5\n6000,55', 'Nm')
    expect(points).toEqual([{ rpm: 6000, torqueNm: 55 }])
    expect(skippedLines).toBe(2)
  })

  it('converts a power-unit value column to torque per row', () => {
    const { points } = parseEngineCurveText('8000,40', 'kW')
    expect(points[0].torqueNm).toBeCloseTo(torqueNmFromPowerKw(40, 8000), 6)
  })

  it('does not sort out-of-order input (caller order is trusted, validated downstream)', () => {
    const { points } = parseEngineCurveText('6000,55\n3000,40', 'Nm')
    expect(points.map((p) => p.rpm)).toEqual([6000, 3000])
  })

  it('rejects hostile input (script tags, huge numbers, garbage) without throwing', () => {
    expect(() =>
      parseEngineCurveText('<script>alert(1)</script>\nNaN,Infinity\n1e400,1e400\n6000,55', 'Nm'),
    ).not.toThrow()
    const { points } = parseEngineCurveText('<script>alert(1)</script>\nNaN,Infinity\n1e400,1e400\n6000,55', 'Nm')
    expect(points).toEqual([{ rpm: 6000, torqueNm: 55 }])
  })
})

describe('diagnoseCurveProfile', () => {
  const good = [
    { rpm: 3000, torqueNm: 40 },
    { rpm: 6000, torqueNm: 55 },
    { rpm: 9000, torqueNm: 48 },
  ]

  it('returns null (valid) for a well-formed curve + redline', () => {
    expect(diagnoseCurveProfile(good, 10000)).toBeNull()
    expect(createEngineCurveProfile(good, 10000)).not.toBeNull()
  })

  it('flags a missing/invalid redline', () => {
    expect(diagnoseCurveProfile(good, null)).toBe('noRedline')
    expect(diagnoseCurveProfile(good, 0)).toBe('noRedline')
    expect(diagnoseCurveProfile(good, NaN)).toBe('noRedline')
  })

  it('flags fewer than 3 points', () => {
    expect(diagnoseCurveProfile(good.slice(0, 2), 10000)).toBe('tooFewPoints')
  })

  it('flags non-increasing rpm', () => {
    const outOfOrder = [good[1], good[0], good[2]]
    expect(diagnoseCurveProfile(outOfOrder, 10000)).toBe('notIncreasing')
    expect(createEngineCurveProfile(outOfOrder, 10000)).toBeNull()
  })

  it('agrees with createEngineCurveProfile on validity for every reason', () => {
    expect(diagnoseCurveProfile([], 10000)).toBe('tooFewPoints')
    expect(createEngineCurveProfile([], 10000)).toBeNull()
  })
})

const emptyTwoPoint: EngineTwoPointFormState = {
  peakTorqueRpm: null,
  peakPowerRpm: null,
  peakTorqueNm: null,
  peakPowerValue: null,
  peakPowerUnit: 'kW',
}

describe('buildTwoPointProfile', () => {
  it('returns null when required fields are missing', () => {
    expect(buildTwoPointProfile(emptyTwoPoint, 10000)).toBeNull()
    expect(buildTwoPointProfile({ ...emptyTwoPoint, peakTorqueRpm: 6500 }, 10000)).toBeNull()
    expect(buildTwoPointProfile({ ...emptyTwoPoint, peakTorqueRpm: 6500, peakPowerRpm: 9000 }, null)).toBeNull()
  })

  it('builds a valid profile from the required fields alone', () => {
    const profile = buildTwoPointProfile({ ...emptyTwoPoint, peakTorqueRpm: 6500, peakPowerRpm: 9000 }, 10000)
    expect(profile).toEqual({ kind: 'twoPoint', peakTorqueRpm: 6500, peakPowerRpm: 9000, redlineRpm: 10000 })
  })

  it('includes optional peakTorqueNm verbatim', () => {
    const profile = buildTwoPointProfile(
      { ...emptyTwoPoint, peakTorqueRpm: 6500, peakPowerRpm: 9000, peakTorqueNm: 42 },
      10000,
    )
    expect(profile?.peakTorqueNm).toBe(42)
  })

  it('converts optional peakPowerValue through the selected unit', () => {
    const profileKw = buildTwoPointProfile(
      { ...emptyTwoPoint, peakTorqueRpm: 6500, peakPowerRpm: 9000, peakPowerValue: 55, peakPowerUnit: 'kW' },
      10000,
    )
    expect(profileKw?.peakPowerKw).toBe(55)

    const profilePs = buildTwoPointProfile(
      { ...emptyTwoPoint, peakTorqueRpm: 6500, peakPowerRpm: 9000, peakPowerValue: 55, peakPowerUnit: 'PS' },
      10000,
    )
    expect(profilePs?.peakPowerKw).toBeCloseTo(hpToKw(55, 'metric'), 6)
  })

  it('defers to createEngineTwoPointProfile validation (e.g. peakPowerRpm <= peakTorqueRpm rejected)', () => {
    const profile = buildTwoPointProfile({ ...emptyTwoPoint, peakTorqueRpm: 9000, peakPowerRpm: 6500 }, 10000)
    expect(profile).toBeNull()
  })
})

describe('buildCurveProfile', () => {
  it('reports the parse result and a validation reason for too-few-points', () => {
    const result = buildCurveProfile({ rawText: '3000,40\n6000,55', valueUnit: 'Nm' }, 10000)
    expect(result.profile).toBeNull()
    expect(result.reason).toBe('tooFewPoints')
    expect(result.parse.points).toHaveLength(2)
  })

  it('builds a valid profile with enough well-formed points', () => {
    const result = buildCurveProfile({ rawText: '3000,40\n6000,55\n9000,48', valueUnit: 'Nm' }, 10000)
    expect(result.profile).not.toBeNull()
    expect(result.reason).toBeNull()
    expect(result.profile?.points).toHaveLength(3)
  })

  it('reports noRedline when redlineRpm is null', () => {
    const result = buildCurveProfile({ rawText: '3000,40\n6000,55\n9000,48', valueUnit: 'Nm' }, null)
    expect(result.profile).toBeNull()
    expect(result.reason).toBe('noRedline')
  })
})

describe('buildEngineProfile', () => {
  it('builds from the two-point form when activeKind is twoPoint', () => {
    const form = defaultEngineProfileFormState()
    form.activeKind = 'twoPoint'
    form.twoPoint = { ...emptyTwoPoint, peakTorqueRpm: 6500, peakPowerRpm: 9000 }
    const profile = buildEngineProfile(form, 10000)
    expect(profile?.kind).toBe('twoPoint')
  })

  it('builds from the curve form when activeKind is curve', () => {
    const form = defaultEngineProfileFormState()
    form.activeKind = 'curve'
    form.curve = { rawText: '3000,40\n6000,55\n9000,48', valueUnit: 'Nm' }
    const profile = buildEngineProfile(form, 10000)
    expect(profile?.kind).toBe('curve')
  })

  it('returns null for an invalid curve even if a valid two-point form is also present', () => {
    const form = defaultEngineProfileFormState()
    form.activeKind = 'curve'
    form.twoPoint = { ...emptyTwoPoint, peakTorqueRpm: 6500, peakPowerRpm: 9000 }
    form.curve = { rawText: '3000,40', valueUnit: 'Nm' } // only 1 point
    const profile = buildEngineProfile(form, 10000)
    expect(profile).toBeNull()
  })
})

describe('defaultEngineProfileFormState', () => {
  it('never returns a shared reference across calls', () => {
    const a = defaultEngineProfileFormState()
    const b = defaultEngineProfileFormState()
    a.twoPoint.peakTorqueRpm = 9999
    expect(b.twoPoint.peakTorqueRpm).toBeNull()
  })
})
