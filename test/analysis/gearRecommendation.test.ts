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
  usableBand,
  recommendRatioSpacing,
  diagnoseExistingRatios,
  finalDriveForTopSpeed,
  rankSprocketCombos,
  diagnoseTopSpeedGearing,
  optimalShiftRpm,
  recommendForMeasuredSpeeds,
  type EngineCurveProfile,
  type EngineTwoPointProfile,
  type UsableBand,
} from '@/domain/analysis/gearRecommendation'
import { computeMtGearTable, type MtDrivetrainSpec } from '@/domain/analysis/drivetrain'

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

// ── usableBand ────────────────────────────────────────────────────────────

describe('usableBand', () => {
  it('derives from a curve profile: bottom = peak torque rpm, top = redline', () => {
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 40 },
        { rpm: 6500, torqueNm: 68 },
        { rpm: 9000, torqueNm: 55 },
      ],
      10000,
    ) as EngineCurveProfile
    expect(usableBand(profile)).toEqual({ bottomRpm: 6500, topRpm: 10000 })
  })

  it('derives from a two-point profile directly', () => {
    const profile = createEngineTwoPointProfile({ peakTorqueRpm: 6000, peakPowerRpm: 8500, redlineRpm: 9500 })!
    expect(usableBand(profile)).toEqual({ bottomRpm: 6000, topRpm: 9500 })
  })
})

// ── recommendRatioSpacing ───────────────────────────────────────────────

describe('recommendRatioSpacing', () => {
  const band: UsableBand = { bottomRpm: 6000, topRpm: 12000 } // k = 2

  it('produces a pure geometric progression from a top-gear anchor (k=2)', () => {
    const ratios = recommendRatioSpacing({ band, gearCount: 4, topGearRatio: 1.0 })
    expect(ratios).not.toBeNull()
    // g[3]=1.0, g[2]=2.0, g[1]=4.0, g[0]=8.0 (k=2 each step)
    expect(ratios).toEqual([8, 4, 2, 1])
  })

  it('produces the same progression from a first-gear anchor', () => {
    const ratios = recommendRatioSpacing({ band, gearCount: 4, firstGearRatio: 8 })
    expect(ratios).toEqual([8, 4, 2, 1])
  })

  it('hand-computed: every adjacent pair has ratio exactly k', () => {
    const ratios = recommendRatioSpacing({ band, gearCount: 5, topGearRatio: 1.2 })!
    for (let i = 0; i < ratios.length - 1; i++) {
      expect(ratios[i] / ratios[i + 1]).toBeCloseTo(2, 9)
    }
  })

  it('gearCount=1 returns just the anchor', () => {
    expect(recommendRatioSpacing({ band, gearCount: 1, topGearRatio: 3.5 })).toEqual([3.5])
    expect(recommendRatioSpacing({ band, gearCount: 1, firstGearRatio: 3.5 })).toEqual([3.5])
  })

  it('progressionFactor > 1 widens steps towards the top gears', () => {
    const ratios = recommendRatioSpacing({ band, gearCount: 4, topGearRatio: 1.0, progressionFactor: 1.5 })!
    // step(i) = k * 1.5^i for the i-th step counting up from 1st gear.
    // g[3]=1.0 (anchor); g[2]=g[3]*step(2)=1*2*1.5^2=4.5; g[1]=g[2]*step(1)=4.5*2*1.5=13.5; g[0]=g[1]*step(0)=13.5*2=27
    expect(ratios[3]).toBeCloseTo(1, 9)
    expect(ratios[2]).toBeCloseTo(4.5, 9)
    expect(ratios[1]).toBeCloseTo(13.5, 9)
    expect(ratios[0]).toBeCloseTo(27, 9)
    // Spacing between the top two gears (index 2,3) is the narrowest (step(0)),
    // spacing between the bottom two gears (index 0,1) uses step(2) — the widest.
    const topStep = ratios[2] / ratios[3]
    const bottomStep = ratios[0] / ratios[1]
    expect(topStep).toBeGreaterThan(bottomStep)
  })

  it('progressionFactor = 1 (default) matches pure geometric', () => {
    const withDefault = recommendRatioSpacing({ band, gearCount: 4, topGearRatio: 1.0 })
    const explicit1 = recommendRatioSpacing({ band, gearCount: 4, topGearRatio: 1.0, progressionFactor: 1 })
    expect(withDefault).toEqual(explicit1)
  })

  it('rejects gearCount < 1', () => {
    expect(recommendRatioSpacing({ band, gearCount: 0, topGearRatio: 1 })).toBeNull()
    expect(recommendRatioSpacing({ band, gearCount: -1, topGearRatio: 1 })).toBeNull()
  })

  it('rejects a degenerate band (top <= bottom)', () => {
    expect(recommendRatioSpacing({ band: { bottomRpm: 6000, topRpm: 6000 }, gearCount: 3, topGearRatio: 1 })).toBeNull()
    expect(recommendRatioSpacing({ band: { bottomRpm: 6000, topRpm: 5000 }, gearCount: 3, topGearRatio: 1 })).toBeNull()
  })

  it('rejects when neither or both anchors are supplied', () => {
    expect(recommendRatioSpacing({ band, gearCount: 3 })).toBeNull()
    expect(recommendRatioSpacing({ band, gearCount: 3, topGearRatio: 1, firstGearRatio: 8 })).toBeNull()
  })

  it('rejects a non-positive anchor', () => {
    expect(recommendRatioSpacing({ band, gearCount: 3, topGearRatio: 0 })).toBeNull()
    expect(recommendRatioSpacing({ band, gearCount: 3, topGearRatio: -1 })).toBeNull()
  })

  it('rejects progressionFactor < 1', () => {
    expect(recommendRatioSpacing({ band, gearCount: 3, topGearRatio: 1, progressionFactor: 0.5 })).toBeNull()
  })
})

// ── diagnoseExistingRatios ───────────────────────────────────────────────

describe('diagnoseExistingRatios', () => {
  const band: UsableBand = { bottomRpm: 7000, topRpm: 10000 }

  it('hand-computed landing rpm and delta for a realistic 6-speed box', () => {
    // gears: 2.615, 1.812, 1.409, 1.16, 1.0, 0.885 (matches drivetrain.test.ts's REF_SPEC)
    const gears = [2.615, 1.812, 1.409, 1.16, 1.0, 0.885].map((ratio) => ({ ratio }))
    const diagnoses = diagnoseExistingRatios(gears, band)
    expect(diagnoses).toHaveLength(5)

    // 1st->2nd: shiftRpm=10000 (band.topRpm), landing = 10000 * 1.812/2.615
    const d0 = diagnoses[0]
    expect(d0.gear).toBe(1)
    expect(d0.shiftRpm).toBe(10000)
    const expectedLanding0 = (10000 * 1.812) / 2.615
    expect(d0.landingRpm).toBeCloseTo(expectedLanding0, 6)
    expect(d0.deltaFromBottomRpm).toBeCloseTo(expectedLanding0 - 7000, 6)

    // 3rd->4th (gear=3): landing = 10000 * 1.16/1.409
    const d2 = diagnoses[2]
    expect(d2.gear).toBe(3)
    const expectedLanding2 = (10000 * 1.16) / 1.409
    expect(d2.landingRpm).toBeCloseTo(expectedLanding2, 6)
    expect(d2.deltaFromBottomRpm).toBeCloseTo(expectedLanding2 - 7000, 6)
  })

  it('reproduces the worked example: 三檔升四檔掉到 band 以下', () => {
    // A wide 3rd->4th gap: after shifting at 10000, lands well below bottomRpm=7000.
    const gears = [3.0, 2.0, 1.6, 0.9].map((ratio) => ({ ratio }))
    const diagnoses = diagnoseExistingRatios(gears, band)
    const shift3to4 = diagnoses.find((d) => d.gear === 3)!
    const expectedLanding = (10000 * 0.9) / 1.6 // 5625
    expect(shift3to4.landingRpm).toBeCloseTo(expectedLanding, 6)
    expect(shift3to4.deltaFromBottomRpm).toBeLessThan(0) // fell below the torque peak
    expect(shift3to4.deltaFromBottomRpm).toBeCloseTo(expectedLanding - 7000, 6)
  })

  it('accepts an explicit shiftRpm override (rider shifts earlier than redline)', () => {
    const gears = [2.615, 1.812].map((ratio) => ({ ratio }))
    const diagnoses = diagnoseExistingRatios(gears, band, 8500)
    expect(diagnoses[0].shiftRpm).toBe(8500)
    expect(diagnoses[0].landingRpm).toBeCloseTo((8500 * 1.812) / 2.615, 6)
  })

  it('supports tooth-count gear inputs via resolveGearRatio', () => {
    const gears = [
      { drivenTeeth: 34, driveTeeth: 13 },
      { drivenTeeth: 30, driveTeeth: 16 },
    ]
    const diagnoses = diagnoseExistingRatios(gears, band)
    expect(diagnoses).toHaveLength(1)
    const gFrom = 34 / 13
    const gTo = 30 / 16
    expect(diagnoses[0].landingRpm).toBeCloseTo(10000 * (gTo / gFrom), 6)
  })

  it('skips pairs referencing an unresolvable gear', () => {
    const gears = [{ ratio: 2.5 }, {}, { ratio: 1.2 }]
    const diagnoses = diagnoseExistingRatios(gears, band)
    // Pair (0,1) and (1,2) both reference the unresolvable middle entry -> skipped.
    expect(diagnoses).toHaveLength(0)
  })

  it('returns [] for fewer than 2 gears', () => {
    expect(diagnoseExistingRatios([{ ratio: 2.5 }], band)).toEqual([])
    expect(diagnoseExistingRatios([], band)).toEqual([])
  })

  it('returns [] for an invalid shiftRpm', () => {
    const gears = [{ ratio: 2.5 }, { ratio: 1.2 }]
    expect(diagnoseExistingRatios(gears, band, 0)).toEqual([])
    expect(diagnoseExistingRatios(gears, band, NaN)).toEqual([])
  })
})

// ── finalDriveForTopSpeed ────────────────────────────────────────────────

describe('finalDriveForTopSpeed', () => {
  it('hand-computed: clean round numbers', () => {
    // circumference 2000mm -> speed(kmh) = wheelRpm * 0.12; target 120km/h -> wheelRpm=1000.
    // final = redline / (primary * topGearRatio * wheelRpmTarget) = 10000/(1*1*1000) = 10.
    const final = finalDriveForTopSpeed({
      targetTopSpeedKmh: 120,
      redlineRpm: 10000,
      topGearRatio: 1,
      primaryReduction: 1,
      wheelCircumferenceMm: 2000,
    })
    expect(final).toBeCloseTo(10, 9)
  })

  it('defaults primaryReduction to 1 when omitted', () => {
    const withDefault = finalDriveForTopSpeed({
      targetTopSpeedKmh: 120,
      redlineRpm: 10000,
      topGearRatio: 1,
      wheelCircumferenceMm: 2000,
    })
    const explicit1 = finalDriveForTopSpeed({
      targetTopSpeedKmh: 120,
      redlineRpm: 10000,
      topGearRatio: 1,
      primaryReduction: 1,
      wheelCircumferenceMm: 2000,
    })
    expect(withDefault).toBeCloseTo(explicit1!, 9)
  })

  it('round-trips against computeMtGearTable on a realistic spec', () => {
    const spec: MtDrivetrainSpec = {
      primaryReduction: 2.833,
      gearRatios: [2.615, 1.812, 1.409, 1.16, 1.0, 0.885].map((ratio) => ({ ratio })),
      finalDrive: { frontTeeth: 15, rearTeeth: 45 },
      wheelCircumferenceMm: 1870,
      redlineRpm: 10000,
    }
    const table = computeMtGearTable(spec)
    const topGear = table[table.length - 1]
    const final = finalDriveForTopSpeed({
      targetTopSpeedKmh: topGear.speedAtRedlineKmh,
      redlineRpm: 10000,
      topGearRatio: 0.885,
      primaryReduction: 2.833,
      wheelCircumferenceMm: 1870,
    })
    expect(final).toBeCloseTo(3, 6) // finalDriveRatio(15,45) = 45/15 = 3
  })

  it('rejects non-positive/non-finite inputs', () => {
    expect(finalDriveForTopSpeed({ targetTopSpeedKmh: 0, redlineRpm: 10000, topGearRatio: 1, wheelCircumferenceMm: 2000 })).toBeNull()
    expect(finalDriveForTopSpeed({ targetTopSpeedKmh: 120, redlineRpm: -1, topGearRatio: 1, wheelCircumferenceMm: 2000 })).toBeNull()
    expect(finalDriveForTopSpeed({ targetTopSpeedKmh: 120, redlineRpm: 10000, topGearRatio: 0, wheelCircumferenceMm: 2000 })).toBeNull()
    expect(finalDriveForTopSpeed({ targetTopSpeedKmh: 120, redlineRpm: 10000, topGearRatio: 1, wheelCircumferenceMm: 0 })).toBeNull()
    expect(finalDriveForTopSpeed({ targetTopSpeedKmh: NaN, redlineRpm: 10000, topGearRatio: 1, wheelCircumferenceMm: 2000 })).toBeNull()
  })
})

// ── rankSprocketCombos ───────────────────────────────────────────────────

describe('rankSprocketCombos', () => {
  it('finds an exact match (ratio=3) within the default ranges', () => {
    const combos = rankSprocketCombos(3)
    expect(combos.length).toBe(5)
    expect(combos[0].errorFrac).toBeCloseTo(0, 9)
    expect(combos[0].ratio).toBeCloseTo(3, 9)
    expect(combos[0].rearTeeth / combos[0].frontTeeth).toBeCloseTo(3, 9)
  })

  it('sorts results by ascending errorFrac', () => {
    const combos = rankSprocketCombos(3.07)
    for (let i = 0; i < combos.length - 1; i++) {
      expect(combos[i].errorFrac).toBeLessThanOrEqual(combos[i + 1].errorFrac)
    }
  })

  it('respects maxResults', () => {
    expect(rankSprocketCombos(3, { maxResults: 2 })).toHaveLength(2)
    expect(rankSprocketCombos(3, { maxResults: 1 })).toHaveLength(1)
  })

  it('respects custom teeth ranges', () => {
    const combos = rankSprocketCombos(3, { frontTeethRange: [13, 13], rearTeethRange: [39, 39], maxResults: 5 })
    expect(combos).toHaveLength(1)
    expect(combos[0]).toMatchObject({ frontTeeth: 13, rearTeeth: 39, ratio: 3, errorFrac: 0 })
  })

  it('returns [] for a non-positive/non-finite target ratio', () => {
    expect(rankSprocketCombos(0)).toEqual([])
    expect(rankSprocketCombos(-1)).toEqual([])
    expect(rankSprocketCombos(NaN)).toEqual([])
  })

  it('returns [] for a degenerate teeth range', () => {
    expect(rankSprocketCombos(3, { frontTeethRange: [18, 11] })).toEqual([])
    expect(rankSprocketCombos(3, { frontTeethRange: [0, 18] })).toEqual([])
  })
})

// ── diagnoseTopSpeedGearing ──────────────────────────────────────────────

describe('diagnoseTopSpeedGearing', () => {
  const REF_SPEC: MtDrivetrainSpec = {
    primaryReduction: 2.833,
    gearRatios: [2.615, 1.812, 1.409, 1.16, 1.0, 0.885].map((ratio) => ({ ratio })),
    finalDrive: { frontTeeth: 15, rearTeeth: 45 },
    wheelCircumferenceMm: 1870,
    redlineRpm: 10000,
  }
  const theoreticalTopSpeedKmh = computeMtGearTable(REF_SPEC)[5].speedAtRedlineKmh // ~149.17

  it('reports matched when achieved is close to theoretical', () => {
    const result = diagnoseTopSpeedGearing(REF_SPEC, theoreticalTopSpeedKmh)
    expect(result).not.toBeNull()
    expect(result!.theoreticalTopSpeedKmh).toBeCloseTo(theoreticalTopSpeedKmh, 6)
    expect(result!.gearingVerdict).toBe('matched')
    expect(result!.deltaKmh).toBeCloseTo(0, 6)
  })

  it('reports over-geared when achieved falls well short of theoretical', () => {
    const result = diagnoseTopSpeedGearing(REF_SPEC, theoreticalTopSpeedKmh * 0.7)
    expect(result!.gearingVerdict).toBe('over-geared')
    expect(result!.deltaKmh).toBeLessThan(0)
  })

  it('reports under-geared when achieved exceeds theoretical', () => {
    const result = diagnoseTopSpeedGearing(REF_SPEC, theoreticalTopSpeedKmh * 1.3)
    expect(result!.gearingVerdict).toBe('under-geared')
    expect(result!.deltaKmh).toBeGreaterThan(0)
  })

  it('respects a custom toleranceFrac', () => {
    const slightlyOff = theoreticalTopSpeedKmh * 1.02
    expect(diagnoseTopSpeedGearing(REF_SPEC, slightlyOff, 0.03)!.gearingVerdict).toBe('matched')
    expect(diagnoseTopSpeedGearing(REF_SPEC, slightlyOff, 0.01)!.gearingVerdict).toBe('under-geared')
  })

  it('returns null for an invalid spec (no valid gears)', () => {
    const badSpec: MtDrivetrainSpec = { ...REF_SPEC, gearRatios: [] }
    expect(diagnoseTopSpeedGearing(badSpec, 150)).toBeNull()
  })

  it('returns null for a non-positive achieved top speed', () => {
    expect(diagnoseTopSpeedGearing(REF_SPEC, 0)).toBeNull()
    expect(diagnoseTopSpeedGearing(REF_SPEC, -5)).toBeNull()
  })
})

// ── optimalShiftRpm ──────────────────────────────────────────────────────

describe('optimalShiftRpm', () => {
  it('crossover branch: finds the rpm where wheel torque is equal either side of the shift', () => {
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 40 },
        { rpm: 6000, torqueNm: 70 }, // peak torque
        { rpm: 12000, torqueNm: 20 }, // falls after
      ],
      12000,
    ) as EngineCurveProfile
    const gearRatioN = 2
    const gearRatioNext = 1.5
    const result = optimalShiftRpm(profile, gearRatioN, gearRatioNext)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('crossover')
    const lo = peakPowerRpm(profile)
    expect(result!.rpm).toBeGreaterThan(lo)
    expect(result!.rpm).toBeLessThan(12000)
    // Verify the crossover condition itself: wheel torque equal either side,
    // to within the bisection's convergence tolerance.
    const wheelTorqueCurrent = torqueAt(profile, result!.rpm) * gearRatioN
    const wheelTorqueNext = torqueAt(profile, result!.rpm * (gearRatioNext / gearRatioN)) * gearRatioNext
    expect(wheelTorqueCurrent).toBeCloseTo(wheelTorqueNext, 4)
  })

  it('redlineClamped branch: flat torque curve, staying in gear always wins', () => {
    // Constant torque -> power strictly increases with rpm (peakPowerRpm =
    // redline-adjacent sample) and wheel torque is ALWAYS higher in the
    // current (numerically larger) gear ratio, at every rpm -> no crossover.
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 50 },
        { rpm: 6000, torqueNm: 50 },
        { rpm: 9000, torqueNm: 50 },
      ],
      12000,
    ) as EngineCurveProfile
    const result = optimalShiftRpm(profile, 2, 1.5)
    expect(result).not.toBeNull()
    expect(result!.reason).toBe('redlineClamped')
    expect(result!.rpm).toBe(12000) // profile.redlineRpm
  })

  it('rejects a downshift or no-op ratio pair (gearRatioNext must be < gearRatioN)', () => {
    const profile = createEngineCurveProfile(
      [
        { rpm: 3000, torqueNm: 40 },
        { rpm: 6000, torqueNm: 70 },
        { rpm: 12000, torqueNm: 20 },
      ],
      12000,
    ) as EngineCurveProfile
    expect(optimalShiftRpm(profile, 1.5, 2)).toBeNull() // gearRatioNext > gearRatioN
    expect(optimalShiftRpm(profile, 2, 2)).toBeNull() // equal ratios (no-op)
    expect(optimalShiftRpm(profile, 0, 1.5)).toBeNull()
    expect(optimalShiftRpm(profile, 2, 0)).toBeNull()
  })

  it('the two-point profile is REJECTED by the type system, not accepted at a lower fidelity', () => {
    const twoPoint: EngineTwoPointProfile = createEngineTwoPointProfile({
      peakTorqueRpm: 6000,
      peakPowerRpm: 8500,
      redlineRpm: 12000,
    })!
    // @ts-expect-error optimalShiftRpm requires EngineCurveProfile, not EngineTwoPointProfile —
    // this is the honesty constraint from the module header, enforced at compile time.
    optimalShiftRpm(twoPoint, 2, 1.5)
  })
})

// ── recommendForMeasuredSpeeds ───────────────────────────────────────────

describe('recommendForMeasuredSpeeds', () => {
  // Circumference chosen so wheelRpm == speedKmh exactly (C = 1e6/60mm),
  // making every rpm computation trivial to hand-verify: engineRpm =
  // speedKmh * totalReduction.
  const CIRCUMFERENCE_MM = 1_000_000 / 60

  // 3 gears with reductions 4/2/1 (well-separated, no overlap with a
  // [6000,10000] band) so each speed sample's gear membership is unambiguous.
  const spec: MtDrivetrainSpec = {
    primaryReduction: 1,
    gearRatios: [{ ratio: 4 }, { ratio: 2 }, { ratio: 1 }],
    finalDrive: { ratio: 1 },
    wheelCircumferenceMm: CIRCUMFERENCE_MM,
    redlineRpm: 10000,
  }
  const band: UsableBand = { bottomRpm: 6000, topRpm: 10000 }

  it('hand-computed band occupancy over a mixed in/out-of-band sample set', () => {
    // 2000 -> gear0 rpm=8000 (in); 4000 -> gear1 rpm=8000 (in);
    // 8000 -> gear2 rpm=8000 (in); 2800 -> best miss is gear1 rpm=5600 (out);
    // 5500 -> best miss is gear2 rpm=5500 (out). 3/5 in-band.
    const result = recommendForMeasuredSpeeds({
      speedSamplesKmh: [2000, 4000, 8000, 2800, 5500],
      spec,
      band,
    })
    expect(result).not.toBeNull()
    expect(result!.bandOccupancyFrac).toBeCloseTo(0.6, 9)
    expect(result!.cornerExitBandOccupancyFrac).toBeNull()
  })

  it('scores cornerExitSpeedsKmh separately from speedSamplesKmh', () => {
    // Corner exits: 8000 (in, gear2) and 2800 (out, best miss gear1) -> 1/2.
    const result = recommendForMeasuredSpeeds({
      speedSamplesKmh: [2000, 4000, 8000, 2800, 5500],
      cornerExitSpeedsKmh: [8000, 2800],
      spec,
      band,
    })
    expect(result!.cornerExitBandOccupancyFrac).toBeCloseTo(0.5, 9)
    // The overall (non-corner) score is unaffected by supplying corner exits.
    expect(result!.bandOccupancyFrac).toBeCloseTo(0.6, 9)
  })

  it('never suggests a scale that scores worse than the current gearing', () => {
    const result = recommendForMeasuredSpeeds({
      speedSamplesKmh: [2000, 4000, 8000, 2800, 5500],
      spec,
      band,
    })!
    expect(result.suggestedBandOccupancyFrac).toBeGreaterThanOrEqual(result.bandOccupancyFrac)
  })

  it('finds a final-drive rescale that fixes a badly under-geared spec', () => {
    // Single gear, ratio=1: at the current final drive (scale=1), engineRpm
    // = speedKmh = 5000 for every sample -> entirely below band.bottomRpm
    // (6000), so baseline occupancy is 0. Scaling the final drive up by
    // anywhere in roughly [1.2, 1.6] brings rpm into [6000,8000] -> in-band.
    const singleGearSpec: MtDrivetrainSpec = {
      primaryReduction: 1,
      gearRatios: [{ ratio: 1 }],
      finalDrive: { ratio: 1 },
      wheelCircumferenceMm: CIRCUMFERENCE_MM,
      redlineRpm: 10000,
    }
    const result = recommendForMeasuredSpeeds({
      speedSamplesKmh: [5000, 5000, 5000],
      spec: singleGearSpec,
      band,
    })!
    expect(result.bandOccupancyFrac).toBeCloseTo(0, 9)
    expect(result.suggestedBandOccupancyFrac).toBeCloseTo(1, 9)
    expect(result.suggestedFinalDriveScale).toBeGreaterThan(1.15)
    expect(result.suggestedFinalDriveScale).toBeLessThanOrEqual(1.6)
    expect(result.suggestedFinalDrive).toBeCloseTo(1 * result.suggestedFinalDriveScale, 9)
  })

  it('returns null for a degenerate band', () => {
    expect(
      recommendForMeasuredSpeeds({ speedSamplesKmh: [5000], spec, band: { bottomRpm: 6000, topRpm: 6000 } }),
    ).toBeNull()
  })

  it('returns null when the spec has no valid gears', () => {
    const badSpec: MtDrivetrainSpec = { ...spec, gearRatios: [] }
    expect(recommendForMeasuredSpeeds({ speedSamplesKmh: [5000], spec: badSpec, band })).toBeNull()
  })

  it('returns null when there are no valid speed samples', () => {
    expect(recommendForMeasuredSpeeds({ speedSamplesKmh: [], spec, band })).toBeNull()
    expect(recommendForMeasuredSpeeds({ speedSamplesKmh: [0, -5, NaN], spec, band })).toBeNull()
  })
})
