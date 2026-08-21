import { describe, it, expect } from 'vitest'
import {
  hpToKw,
  kwToHp,
  powerKwFromTorqueNm,
  torqueNmFromPowerKw,
  createEngineCurveProfile,
  createEngineTwoPointProfile,
  torqueAt,
  powerKwAt,
  peakTorqueRpm,
  peakPowerRpm,
  type EngineCurveProfile,
} from '@/domain/analysis/gearRecommendation'

// ── Unit conversions ────────────────────────────────────────────────────────

describe('hpToKw / kwToHp', () => {
  it('round-trips metric PS', () => {
    const kw = hpToKw(100, 'metric')
    expect(kw).toBeCloseTo(73.549875, 6)
    expect(kwToHp(kw, 'metric')).toBeCloseTo(100, 6)
  })
  it('round-trips mechanical hp', () => {
    const kw = hpToKw(100, 'mechanical')
    expect(kw).toBeCloseTo(74.56998716, 6)
    expect(kwToHp(kw, 'mechanical')).toBeCloseTo(100, 6)
  })
  it('metric and mechanical disagree by ~1.4%', () => {
    const metricKw = hpToKw(100, 'metric')
    const mechKw = hpToKw(100, 'mechanical')
    expect(mechKw).toBeGreaterThan(metricKw)
    expect((mechKw - metricKw) / metricKw).toBeCloseTo(0.01389, 3)
  })
  it('defaults to metric when standard omitted', () => {
    expect(hpToKw(100)).toBeCloseTo(hpToKw(100, 'metric'), 9)
  })
  it('rejects negative/non-finite hp', () => {
    expect(hpToKw(-1)).toBeNaN()
    expect(hpToKw(NaN)).toBeNaN()
    expect(kwToHp(-1)).toBeNaN()
  })
})

describe('powerKwFromTorqueNm / torqueNmFromPowerKw', () => {
  it('known check: 100Nm @ 9549.3rpm = 100kW', () => {
    expect(powerKwFromTorqueNm(100, 9549.3)).toBeCloseTo(100, 6)
  })
  it('round-trips torque -> power -> torque', () => {
    const p = powerKwFromTorqueNm(65, 8500)
    expect(torqueNmFromPowerKw(p, 8500)).toBeCloseTo(65, 6)
  })
  it('rejects non-positive/non-finite inputs', () => {
    expect(powerKwFromTorqueNm(0, 5000)).toBeNaN()
    expect(powerKwFromTorqueNm(50, 0)).toBeNaN()
    expect(powerKwFromTorqueNm(NaN, 5000)).toBeNaN()
    expect(torqueNmFromPowerKw(0, 5000)).toBeNaN()
    expect(torqueNmFromPowerKw(50, -1)).toBeNaN()
  })
})

// ── Curve validation ─────────────────────────────────────────────────────

describe('createEngineCurveProfile', () => {
  const goodPoints = [
    { rpm: 3000, torqueNm: 40 },
    { rpm: 5000, torqueNm: 55 },
    { rpm: 7000, torqueNm: 62 },
    { rpm: 9000, torqueNm: 58 },
    { rpm: 11000, torqueNm: 45 },
  ]

  it('accepts a valid strictly-increasing curve', () => {
    const p = createEngineCurveProfile(goodPoints, 12000)
    expect(p).not.toBeNull()
    expect(p?.kind).toBe('curve')
    expect(p?.points.length).toBe(5)
    expect(p?.redlineRpm).toBe(12000)
  })

  it('rejects fewer than 3 points', () => {
    expect(createEngineCurveProfile(goodPoints.slice(0, 2), 12000)).toBeNull()
  })

  it('rejects non-increasing rpm (duplicate)', () => {
    const bad = [...goodPoints.slice(0, 2), { rpm: 5000, torqueNm: 60 }, ...goodPoints.slice(2)]
    expect(createEngineCurveProfile(bad, 12000)).toBeNull()
  })

  it('rejects decreasing rpm order', () => {
    const bad = [...goodPoints].reverse()
    expect(createEngineCurveProfile(bad, 12000)).toBeNull()
  })

  it('rejects non-positive torque', () => {
    const bad = [goodPoints[0], { rpm: 5000, torqueNm: 0 }, ...goodPoints.slice(2)]
    expect(createEngineCurveProfile(bad, 12000)).toBeNull()
  })

  it('rejects non-finite rpm', () => {
    const bad = [goodPoints[0], { rpm: NaN, torqueNm: 55 }, ...goodPoints.slice(2)]
    expect(createEngineCurveProfile(bad, 12000)).toBeNull()
  })

  it('rejects non-positive/non-finite redline', () => {
    expect(createEngineCurveProfile(goodPoints, 0)).toBeNull()
    expect(createEngineCurveProfile(goodPoints, -1)).toBeNull()
    expect(createEngineCurveProfile(goodPoints, NaN)).toBeNull()
  })

  it('accepts redline beyond the last sample (sparse digitisation)', () => {
    const p = createEngineCurveProfile(goodPoints, 15000)
    expect(p).not.toBeNull()
  })
})

describe('createEngineTwoPointProfile', () => {
  it('accepts a valid two-point profile', () => {
    const p = createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: 9000, redlineRpm: 10500 })
    expect(p).not.toBeNull()
    expect(p?.kind).toBe('twoPoint')
  })

  it('accepts optional peak values when positive/finite', () => {
    const p = createEngineTwoPointProfile({
      peakTorqueRpm: 6500,
      peakPowerRpm: 9000,
      redlineRpm: 10500,
      peakTorqueNm: 65,
      peakPowerKw: 70,
    })
    expect(p?.peakTorqueNm).toBe(65)
    expect(p?.peakPowerKw).toBe(70)
  })

  it('rejects peakPowerRpm <= peakTorqueRpm', () => {
    expect(createEngineTwoPointProfile({ peakTorqueRpm: 9000, peakPowerRpm: 6500, redlineRpm: 10500 })).toBeNull()
    expect(createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: 6500, redlineRpm: 10500 })).toBeNull()
  })

  it('rejects peakPowerRpm > redlineRpm', () => {
    expect(createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: 11000, redlineRpm: 10500 })).toBeNull()
  })

  it('allows peakPowerRpm === redlineRpm', () => {
    expect(createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: 10500, redlineRpm: 10500 })).not.toBeNull()
  })

  it('rejects non-positive optional peak values', () => {
    expect(
      createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: 9000, redlineRpm: 10500, peakTorqueNm: -5 }),
    ).toBeNull()
    expect(
      createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: 9000, redlineRpm: 10500, peakPowerKw: 0 }),
    ).toBeNull()
  })

  it('rejects non-finite/non-positive base fields', () => {
    expect(createEngineTwoPointProfile({ peakTorqueRpm: 0, peakPowerRpm: 9000, redlineRpm: 10500 })).toBeNull()
    expect(createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: NaN, redlineRpm: 10500 })).toBeNull()
    expect(createEngineTwoPointProfile({ peakTorqueRpm: 6500, peakPowerRpm: 9000, redlineRpm: 0 })).toBeNull()
  })
})

// ── Curve derivations ────────────────────────────────────────────────────

describe('torqueAt', () => {
  const profile = createEngineCurveProfile(
    [
      { rpm: 3000, torqueNm: 40 },
      { rpm: 5000, torqueNm: 60 },
      { rpm: 7000, torqueNm: 70 },
    ],
    8000,
  ) as EngineCurveProfile

  it('returns exact sample values at sample rpm', () => {
    expect(torqueAt(profile, 3000)).toBeCloseTo(40, 9)
    expect(torqueAt(profile, 5000)).toBeCloseTo(60, 9)
    expect(torqueAt(profile, 7000)).toBeCloseTo(70, 9)
  })

  it('interpolates linearly between samples', () => {
    // Midpoint of 3000..5000 (40..60) -> 50.
    expect(torqueAt(profile, 4000)).toBeCloseTo(50, 9)
    // Quarter-point of 5000..7000 (60..70): 5500 -> 62.5.
    expect(torqueAt(profile, 5500)).toBeCloseTo(62.5, 9)
  })

  it('clamps below the first sample rather than extrapolating', () => {
    expect(torqueAt(profile, 1000)).toBeCloseTo(40, 9)
  })

  it('clamps above the last sample rather than extrapolating', () => {
    expect(torqueAt(profile, 8000)).toBeCloseTo(70, 9)
    expect(torqueAt(profile, 20000)).toBeCloseTo(70, 9)
  })
})

describe('powerKwAt', () => {
  const profile = createEngineCurveProfile(
    [
      { rpm: 3000, torqueNm: 40 },
      { rpm: 5000, torqueNm: 60 },
      { rpm: 7000, torqueNm: 70 },
    ],
    8000,
  ) as EngineCurveProfile

  it('matches powerKwFromTorqueNm(torqueAt(...), rpm)', () => {
    expect(powerKwAt(profile, 5000)).toBeCloseTo(powerKwFromTorqueNm(60, 5000), 9)
  })
})

describe('peakTorqueRpm', () => {
  it('returns the rpm of the maximum-torque sample', () => {
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 40 },
        { rpm: 5000, torqueNm: 60 },
        { rpm: 7000, torqueNm: 72 },
        { rpm: 9000, torqueNm: 65 },
        { rpm: 11000, torqueNm: 50 },
      ],
      12000,
    ) as EngineCurveProfile
    expect(peakTorqueRpm(profile)).toBe(7000)
  })
})

describe('peakPowerRpm', () => {
  it('finds an interior peak past peak torque on a falling segment', () => {
    // Flat torque up to 7000 (peak torque), falling linearly after.
    // Power = T*rpm/9549.3 keeps climbing while torque is flat, and on the
    // falling segment the vertex formula gives an exact interior optimum.
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 50 },
        { rpm: 7000, torqueNm: 70 }, // peak torque
        { rpm: 13000, torqueNm: 34 }, // falls after (vertex lands well inside the segment)
      ],
      13000,
    ) as EngineCurveProfile
    const rpm = peakPowerRpm(profile)
    // On segment [7000,13000]: T(r) = 70 + slope*(r-7000), slope = (10-70)/6000 = -0.01
    // intercept = 70 - slope*7000 = 70 + 70 = 140; r* = -intercept/(2*slope) = -140/-0.02 = 7000...
    // recompute precisely below instead of hand-asserting a magic number.
    const slope = (34 - 70) / (13000 - 7000)
    const intercept = 70 - slope * 7000
    const expectedRpm = -intercept / (2 * slope)
    expect(rpm).toBeCloseTo(expectedRpm, 3)
    expect(rpm).toBeGreaterThan(7000)
    expect(rpm).toBeLessThan(13000)
  })

  it('falls back to a sample endpoint when every segment is convex/flat', () => {
    // Strictly increasing torque throughout (each segment slope >= 0) ->
    // power is maximised at the very last sample (endpoint case).
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 40 },
        { rpm: 6000, torqueNm: 55 },
        { rpm: 9000, torqueNm: 70 },
      ],
      9000,
    ) as EngineCurveProfile
    expect(peakPowerRpm(profile)).toBe(9000)
  })

  it('lands past the torque peak, before redline, on a realistic curve', () => {
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 45 },
        { rpm: 5000, torqueNm: 62 },
        { rpm: 7000, torqueNm: 68 },
        { rpm: 8500, torqueNm: 64 },
        { rpm: 10000, torqueNm: 52 },
      ],
      10500,
    ) as EngineCurveProfile
    const torquePeak = peakTorqueRpm(profile)
    const powerPeak = peakPowerRpm(profile)
    expect(powerPeak).toBeGreaterThan(torquePeak)
    expect(powerPeak).toBeLessThanOrEqual(10000)
  })
})
