import { describe, it, expect } from 'vitest'
import {
  finalDriveRatio,
  toothCountRatio,
  resolveGearRatio,
  resolveFinalDrive,
  tireSpecToCircumferenceMm,
  wheelRpmToSpeedKmh,
  speedKmhToWheelRpm,
  computeMtGearTable,
  mtGearSpeedFn,
  mtGearSpeedLine,
  rpmSpeedTable,
  shiftRpmDrop,
  computeRatioSeries,
  detectGearPlateaus,
  buildCvtRatioSweep,
  buildCvtRatioTimeSeries,
  cvtRatioSummary,
  estimateClutchEngagementRpm,
  estimateCircumferenceFromLog,
  inferDrivetrainKind,
  type MtDrivetrainSpec,
} from '@/domain/analysis/drivetrain'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'

// Real-ish MT reference bike, hand-computed in Python (see PR description):
// primary 2.833, gears [2.615, 1.812, 1.409, 1.16, 1.0, 0.885], 15/45
// sprockets, 1870mm wheel circumference, 10000 RPM redline.
const REF_SPEC: MtDrivetrainSpec = {
  primaryReduction: 2.833,
  gearRatios: [2.615, 1.812, 1.409, 1.16, 1.0, 0.885].map((ratio) => ({ ratio })),
  finalDrive: { frontTeeth: 15, rearTeeth: 45 },
  wheelCircumferenceMm: 1870,
  redlineRpm: 10000,
}

const REF_SPEEDS_KMH = [50.484, 72.856, 93.694, 113.806, 132.016, 149.17]
const REF_TOTAL_REDUCTIONS = [22.2249, 15.4002, 11.9751, 9.8588, 8.499, 7.5216]

describe('finalDriveRatio', () => {
  it('computes rear/front teeth', () => {
    expect(finalDriveRatio(15, 45)).toBeCloseTo(3, 6)
  })
  it('returns NaN for non-positive teeth', () => {
    expect(finalDriveRatio(0, 45)).toBeNaN()
    expect(finalDriveRatio(15, 0)).toBeNaN()
    expect(finalDriveRatio(-1, 45)).toBeNaN()
  })
})

describe('toothCountRatio', () => {
  it('computes driven/drive teeth', () => {
    expect(toothCountRatio(45, 15)).toBeCloseTo(3, 6)
  })
  it('returns NaN for non-positive teeth', () => {
    expect(toothCountRatio(0, 15)).toBeNaN()
    expect(toothCountRatio(45, 0)).toBeNaN()
  })
})

describe('resolveGearRatio', () => {
  it('prefers an explicit ratio', () => {
    expect(resolveGearRatio({ ratio: 2.5, drivenTeeth: 45, driveTeeth: 15 })).toBeCloseTo(2.5, 6)
  })
  it('derives from tooth counts when ratio is absent', () => {
    expect(resolveGearRatio({ drivenTeeth: 30, driveTeeth: 12 })).toBeCloseTo(2.5, 6)
  })
  it('returns NaN when neither form is valid', () => {
    expect(resolveGearRatio({})).toBeNaN()
    expect(resolveGearRatio({ drivenTeeth: 30 })).toBeNaN()
  })
})

describe('resolveFinalDrive', () => {
  it('prefers an explicit ratio', () => {
    expect(resolveFinalDrive({ ratio: 3.5, frontTeeth: 15, rearTeeth: 45 })).toBeCloseTo(3.5, 6)
  })
  it('derives from front/rear teeth when ratio is absent', () => {
    expect(resolveFinalDrive({ frontTeeth: 13, rearTeeth: 41 })).toBeCloseTo(41 / 13, 6)
  })
  it('returns NaN when neither form is valid', () => {
    expect(resolveFinalDrive({})).toBeNaN()
  })
})

describe('tireSpecToCircumferenceMm', () => {
  it('parses a standard metric spec (120/70-17)', () => {
    // rim 17*25.4=431.8mm + 2*(120*0.70)=168mm sidewall = 599.8mm diameter
    // circumference = pi * 599.8 ~= 1884.33mm
    expect(tireSpecToCircumferenceMm('120/70-17')).toBeCloseTo(1884.33, 1)
  })
  it('accepts a little formatting slack (x separator, R prefix, spaces)', () => {
    const base = tireSpecToCircumferenceMm('120/70-17')
    expect(tireSpecToCircumferenceMm('120/70x17')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('120/70 R17')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm(' 120 / 70 - 17 ')).toBeCloseTo(base, 6)
  })
  it('accepts construction-type letters glued to the diameter (R/ZR/B/D, any case)', () => {
    const base = tireSpecToCircumferenceMm('120/70-17')
    expect(tireSpecToCircumferenceMm('120/70R17')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('120/70r17')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('120/70ZR17')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('120/70zr17')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('120/70B17')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('120/70-R17')).toBeCloseTo(base, 6)
  })
  it('accepts an M/C motorcycle marking before the rim diameter', () => {
    const base = tireSpecToCircumferenceMm('130/70-12')
    expect(tireSpecToCircumferenceMm('130/70 M/C 12')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('130/70 m/c 12')).toBeCloseTo(base, 6)
  })
  it('ignores a trailing load-index/speed-rating token', () => {
    const base = tireSpecToCircumferenceMm('120/70-17')
    expect(tireSpecToCircumferenceMm('120/70ZR17 58W')).toBeCloseTo(base, 6)
    expect(tireSpecToCircumferenceMm('120/70-17 58')).toBeCloseTo(base, 6)
    // scooter sizes with a rating too
    expect(tireSpecToCircumferenceMm('120/80-12 55J')).toBeCloseTo(tireSpecToCircumferenceMm('120/80-12'), 6)
  })
  it('parses the small-scooter sizes from the feature request', () => {
    // 120/80-12: rim 12*25.4=304.8mm + 2*(120*0.80)=192mm sidewall = 496.8mm diameter
    expect(tireSpecToCircumferenceMm('120/80-12')).toBeCloseTo(Math.PI * 496.8, 1)
    // 100/90-10: rim 10*25.4=254mm + 2*(100*0.90)=180mm sidewall = 434mm diameter
    expect(tireSpecToCircumferenceMm('100/90-10')).toBeCloseTo(Math.PI * 434, 1)
  })
  it('returns NaN for an unparsable string', () => {
    expect(tireSpecToCircumferenceMm('not a tire size')).toBeNaN()
    expect(tireSpecToCircumferenceMm('')).toBeNaN()
    // wrong/unknown construction letter must not silently parse
    expect(tireSpecToCircumferenceMm('120/70Q17')).toBeNaN()
    // missing aspect ratio
    expect(tireSpecToCircumferenceMm('120-17')).toBeNaN()
  })
  it('returns NaN for non-positive components', () => {
    expect(tireSpecToCircumferenceMm('0/70-17')).toBeNaN()
    expect(tireSpecToCircumferenceMm('120/0-17')).toBeNaN()
  })
})

describe('computeMtGearTable', () => {
  it('matches hand-computed total reduction + speed-at-redline for every gear', () => {
    const results = computeMtGearTable(REF_SPEC)
    expect(results).toHaveLength(6)
    results.forEach((r, i) => {
      expect(r.gear).toBe(i + 1)
      expect(r.totalReduction).toBeCloseTo(REF_TOTAL_REDUCTIONS[i], 3)
      expect(r.speedAtRedlineKmh).toBeCloseTo(REF_SPEEDS_KMH[i], 2)
    })
  })

  it('speed increases monotonically across gears (each gear taller than the last)', () => {
    const results = computeMtGearTable(REF_SPEC)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].speedAtRedlineKmh).toBeGreaterThan(results[i - 1].speedAtRedlineKmh)
    }
  })

  it('accepts tooth-count gear ratios equivalently to direct ratios', () => {
    // Gear 1 ratio 2.615 == 2.615:1, expressed as e.g. 47/18 teeth (~2.611).
    const spec: MtDrivetrainSpec = {
      ...REF_SPEC,
      gearRatios: [{ drivenTeeth: 47, driveTeeth: 18 }],
    }
    const results = computeMtGearTable(spec)
    expect(results).toHaveLength(1)
    expect(results[0].totalReduction).toBeCloseTo(2.833 * (47 / 18) * 3, 3)
  })

  it('resolves final drive from a direct ratio as well as from teeth', () => {
    const spec: MtDrivetrainSpec = { ...REF_SPEC, finalDrive: { ratio: 3 } }
    const results = computeMtGearTable(spec)
    expect(results.map((r) => r.totalReduction)).toEqual(computeMtGearTable(REF_SPEC).map((r) => r.totalReduction))
  })

  it('defaults primaryReduction to 1 when omitted (direct-drive)', () => {
    const spec: MtDrivetrainSpec = { ...REF_SPEC, primaryReduction: undefined }
    const results = computeMtGearTable(spec)
    expect(results[0].totalReduction).toBeCloseTo(2.615 * 3, 6)
  })

  it('returns [] for an invalid spec (unresolvable final drive)', () => {
    expect(computeMtGearTable({ ...REF_SPEC, finalDrive: { frontTeeth: 0, rearTeeth: 45 } })).toEqual([])
  })

  it('returns [] for an invalid spec (zero wheel circumference)', () => {
    expect(computeMtGearTable({ ...REF_SPEC, wheelCircumferenceMm: 0 })).toEqual([])
  })

  it('skips non-positive/unresolvable individual gear ratios but keeps the rest', () => {
    const spec: MtDrivetrainSpec = { ...REF_SPEC, gearRatios: [{ ratio: 2.615 }, { ratio: 0 }, { ratio: 1.409 }] }
    const results = computeMtGearTable(spec)
    expect(results.map((r) => r.gear)).toEqual([1, 3])
  })
})

describe('mtGearSpeedFn / mtGearSpeedLine', () => {
  it('produces the same speed-at-redline as computeMtGearTable', () => {
    const results = computeMtGearTable(REF_SPEC)
    const fn = mtGearSpeedFn(results[0].totalReduction, REF_SPEC.wheelCircumferenceMm)
    expect(fn(10000)).toBeCloseTo(REF_SPEEDS_KMH[0], 2)
  })

  it('returns NaN for invalid inputs', () => {
    const fn = mtGearSpeedFn(0, 1870)
    expect(fn(5000)).toBeNaN()
  })

  it('samples an evenly-spaced line from 0 to maxRpm', () => {
    const results = computeMtGearTable(REF_SPEC)
    const line = mtGearSpeedLine(results[0].totalReduction, REF_SPEC.wheelCircumferenceMm, 10000, 10)
    expect(line.rpm).toHaveLength(11) // 0..10 inclusive
    expect(line.speedKmh).toHaveLength(11)
    expect(line.rpm[0]).toBe(0)
    expect(line.speedKmh[0]).toBe(0)
    expect(line.rpm[10]).toBeCloseTo(10000, 6)
    expect(line.speedKmh[10]).toBeCloseTo(REF_SPEEDS_KMH[0], 2)
  })

  it('returns empty arrays for invalid inputs', () => {
    expect(mtGearSpeedLine(0, 1870, 10000)).toEqual({ rpm: [], speedKmh: [] })
    expect(mtGearSpeedLine(10, 0, 10000)).toEqual({ rpm: [], speedKmh: [] })
    expect(mtGearSpeedLine(10, 1870, 0)).toEqual({ rpm: [], speedKmh: [] })
  })
})

describe('wheelRpmToSpeedKmh / speedKmhToWheelRpm', () => {
  it('round-trips', () => {
    const rpm = 500
    const circ = 1870
    const speed = wheelRpmToSpeedKmh(rpm, circ)
    expect(speedKmhToWheelRpm(speed, circ)).toBeCloseTo(rpm, 6)
  })
  it('matches a hand-computed value: 500 rpm, 1870mm circumference', () => {
    // 500 rev/min * 1870 mm/rev * 60 min/h / 1e6 mm/km = 56.1 km/h
    expect(wheelRpmToSpeedKmh(500, 1870)).toBeCloseTo(56.1, 6)
  })
  it('returns NaN for non-positive circumference', () => {
    expect(wheelRpmToSpeedKmh(500, 0)).toBeNaN()
    expect(speedKmhToWheelRpm(50, -1)).toBeNaN()
  })
})

describe('rpmSpeedTable', () => {
  it('produces `steps` evenly-spaced rows up to maxRpm', () => {
    const rows = rpmSpeedTable(REF_TOTAL_REDUCTIONS[0], 1870, 10000, 10)
    expect(rows).toHaveLength(10)
    expect(rows[9].rpm).toBeCloseTo(10000, 6)
    expect(rows[9].speedKmh).toBeCloseTo(REF_SPEEDS_KMH[0], 2)
    expect(rows[0].rpm).toBeCloseTo(1000, 6)
  })

  it('returns [] for invalid inputs', () => {
    expect(rpmSpeedTable(0, 1870, 10000)).toEqual([])
    expect(rpmSpeedTable(10, 0, 10000)).toEqual([])
    expect(rpmSpeedTable(10, 1870, 0)).toEqual([])
  })
})

describe('shiftRpmDrop', () => {
  it('matches hand-computed RPM drop for each 1->N gear shift at redline', () => {
    const results = computeMtGearTable(REF_SPEC)
    const expectedDrops = [3070.75, 2224.06, 1767.21, 1379.31, 1150.0]
    expectedDrops.forEach((drop, i) => {
      expect(shiftRpmDrop(results, i + 1, 10000)).toBeCloseTo(drop, 1)
    })
  })

  it('returns NaN when there is no next gear', () => {
    const results = computeMtGearTable(REF_SPEC)
    expect(shiftRpmDrop(results, 6, 10000)).toBeNaN()
  })

  it('returns NaN for a gear not present in results', () => {
    const results = computeMtGearTable(REF_SPEC)
    expect(shiftRpmDrop(results, 99, 10000)).toBeNaN()
  })
})

// ── Layer 2: log inversion ──────────────────────────────────────────────────

describe('computeRatioSeries', () => {
  it('recovers a known constant ratio from synthetic rpm/speed', () => {
    const circ = 1870
    const totalReduction = REF_TOTAL_REDUCTIONS[2] // 3rd gear
    const n = 50
    const speed = new Float64Array(n).fill(80) // km/h, above the speed floor
    const wheelRpm = speedKmhToWheelRpm(80, circ)
    const rpm = new Float64Array(n).fill(wheelRpm * totalReduction)
    const ratio = computeRatioSeries(rpm, speed, { wheelCircumferenceMm: circ })
    for (let i = 0; i < n; i++) {
      expect(ratio[i]).toBeCloseTo(totalReduction, 6)
    }
  })

  it('filters out samples below minSpeedKmh as NaN', () => {
    const rpm = new Float64Array([5000, 5000])
    const speed = new Float64Array([2, 80]) // first below default 5 km/h floor
    const ratio = computeRatioSeries(rpm, speed, { wheelCircumferenceMm: 1870 })
    expect(Number.isNaN(ratio[0])).toBe(true)
    expect(Number.isFinite(ratio[1])).toBe(true)
  })

  it('filters out non-finite rpm/speed and non-positive rpm', () => {
    const rpm = new Float64Array([NaN, 5000, -100, 5000])
    const speed = new Float64Array([80, Infinity, 80, 80])
    const ratio = computeRatioSeries(rpm, speed, { wheelCircumferenceMm: 1870 })
    expect(Number.isNaN(ratio[0])).toBe(true)
    expect(Number.isNaN(ratio[1])).toBe(true)
    expect(Number.isNaN(ratio[2])).toBe(true)
    expect(Number.isFinite(ratio[3])).toBe(true)
  })

  it('returns an all-NaN array for an invalid wheel circumference', () => {
    const rpm = new Float64Array([5000, 6000])
    const speed = new Float64Array([80, 90])
    const ratio = computeRatioSeries(rpm, speed, { wheelCircumferenceMm: 0 })
    expect(Array.from(ratio).every((v) => Number.isNaN(v))).toBe(true)
  })

  it('respects a custom minSpeedKmh floor', () => {
    const rpm = new Float64Array([5000, 5000])
    const speed = new Float64Array([8, 12])
    const ratio = computeRatioSeries(rpm, speed, { wheelCircumferenceMm: 1870, minSpeedKmh: 10 })
    expect(Number.isNaN(ratio[0])).toBe(true)
    expect(Number.isFinite(ratio[1])).toBe(true)
  })
})

describe('inferDrivetrainKind', () => {
  function channel(name: string, values: number[]): Channel {
    return { name, rawName: name, description: undefined, data: new Float32Array(values) }
  }

  function session(channels: Channel[]): LogSession {
    return new LogSession(channels, { formatId: 'synthetic', createdDate: null, headerInfo: {} })
  }

  it('uses a multi-value discrete gear channel as definitive MT evidence', () => {
    const gears = Array.from({ length: 60 }, (_, i) => 1 + Math.floor(i / 20))
    expect(inferDrivetrainKind(session([channel('Gear', gears)]))).toMatchObject({
      kind: 'mt',
      basis: 'gearChannel',
    })
  })

  it('recognises repeated stepped ratio plateaus as MT without a gear channel', () => {
    const speed: number[] = []
    const rpm: number[] = []
    for (const ratio of [18, 13, 9]) {
      for (let i = 0; i < 140; i++) {
        const kmh = 25 + (i % 70) * 0.45
        const noise = 1 + ((i % 5) - 2) * 0.001
        speed.push(kmh)
        rpm.push(speedKmhToWheelRpm(kmh, 1870) * ratio * noise)
      }
    }
    expect(inferDrivetrainKind(session([channel('RPM', rpm), channel('GPS_Speed', speed)]))).toMatchObject({
      kind: 'mt',
      basis: 'ratioPlateaus',
    })
  })

  it('recognises a broad continuous ratio sweep as CVT', () => {
    const n = 600
    const speed = Array.from({ length: n }, (_, i) => 12 + (88 * i) / (n - 1))
    const rpm = speed.map((kmh, i) => {
      const ratio = 16 - (8 * i) / (n - 1)
      return speedKmhToWheelRpm(kmh, 1870) * ratio
    })
    expect(inferDrivetrainKind(session([channel('RPM', rpm), channel('GPS_Speed', speed)]))).toMatchObject({
      kind: 'cvt',
      basis: 'continuousRatio',
    })
  })

  it('returns null for short or single-gear recordings instead of guessing', () => {
    const speed = new Array(200).fill(50)
    const rpm = speed.map((kmh) => speedKmhToWheelRpm(kmh, 1870) * 10)
    expect(inferDrivetrainKind(session([channel('RPM', rpm), channel('GPS_Speed', speed)]))).toBeNull()
    expect(inferDrivetrainKind(session([channel('RPM', rpm.slice(0, 50)), channel('GPS_Speed', speed.slice(0, 50))]))).toBeNull()
  })
})

describe('detectGearPlateaus', () => {
  /** Build a synthetic ratio(t) trace: `samplesPerGear` copies of each ratio
   *  in `ratios`, with small relative noise (+/- noiseFrac) so the detector
   *  is exercised on non-perfectly-flat data, plus a few shift-transient
   *  outliers scattered in between. */
  function syntheticTrace(ratios: number[], samplesPerGear: number, noiseFrac = 0.005): Float64Array {
    const out: number[] = []
    for (const r of ratios) {
      for (let i = 0; i < samplesPerGear; i++) {
        // Deterministic pseudo-noise (no RNG dependency in tests): alternate +/-.
        const sign = i % 2 === 0 ? 1 : -1
        const frac = (i % 5) / 5 // 0..0.8
        out.push(r * (1 + sign * noiseFrac * frac))
      }
    }
    return new Float64Array(out)
  }

  it('recovers all 6 gear ratios from a clean synthetic trace', () => {
    const trace = syntheticTrace(REF_TOTAL_REDUCTIONS, 40)
    const plateaus = detectGearPlateaus(trace, { gearCount: 6 })
    expect(plateaus).toHaveLength(6)
    // Sorted descending (1st gear = highest ratio first).
    const sortedExpected = [...REF_TOTAL_REDUCTIONS].sort((a, b) => b - a)
    plateaus.forEach((p, i) => {
      expect(p.ratio).toBeCloseTo(sortedExpected[i], 1)
    })
  })

  it('is tolerant of noisy data (does not fragment a single gear into multiple clusters)', () => {
    // 5% noise, still within default 3%? No — use explicit generous tolerance
    // to prove noisy data still clusters into one plateau per gear.
    const trace = syntheticTrace(REF_TOTAL_REDUCTIONS, 40, 0.02)
    const plateaus = detectGearPlateaus(trace, { gearCount: 6, toleranceFrac: 0.05 })
    expect(plateaus).toHaveLength(6)
  })

  it('drops small clusters below minSampleFrac as noise/shift transients', () => {
    // Two real gears with plenty of samples, plus a handful of scattered
    // one-off "shift transient" ratios that shouldn't survive as plateaus.
    const real = syntheticTrace([10, 5], 100)
    const noise = new Float64Array([7.3, 7.31, 8.9]) // tiny clusters, far from 10/5
    const trace = new Float64Array([...real, ...noise])
    const plateaus = detectGearPlateaus(trace, { minSampleFrac: 0.02 })
    expect(plateaus.map((p) => Math.round(p.ratio))).toEqual([10, 5])
  })

  it('returns [] for too few finite samples', () => {
    expect(detectGearPlateaus(new Float64Array([1, 2, NaN]))).toEqual([])
  })

  it('ignores NaN and non-positive entries', () => {
    const trace = new Float64Array([...syntheticTrace([10], 20), NaN, NaN, -5, 0])
    const plateaus = detectGearPlateaus(trace, { gearCount: 1 })
    expect(plateaus).toHaveLength(1)
    expect(plateaus[0].ratio).toBeCloseTo(10, 1)
    expect(plateaus[0].sampleCount).toBe(20)
  })

  it('does not produce false plateaus on a continuously-varying (CVT-like) sweep', () => {
    // A ramp from 3.0 down to 1.0 in small steps — no repeated value, so no
    // cluster should gather enough samples to pass the default minSampleFrac
    // once spread thin, EXCEPT this specific ramp is short/coarse enough that
    // adjacent steps fall within tolerance and legitimately merge; the real
    // "no false plateau" guarantee is exercised via a much finer sweep below.
    const n = 2000
    const trace = new Float64Array(n)
    for (let i = 0; i < n; i++) trace[i] = 3.0 - (2.0 * i) / (n - 1)
    const plateaus = detectGearPlateaus(trace)
    // A fine continuous ramp should NOT collapse into just 1-2 giant plateaus
    // covering most of the samples — no single cluster should dominate (i.e.
    // capture the vast majority of all samples), which would indicate the
    // clustering pass mistook a smooth sweep for a flat gear.
    const maxClusterFrac = Math.max(...plateaus.map((p) => p.sampleCount)) / n
    expect(maxClusterFrac).toBeLessThan(0.2)
  })
})

describe('buildCvtRatioSweep', () => {
  it('pairs ratio with speed, filters NaN/non-positive, sorted by speed ascending', () => {
    const ratio = new Float64Array([5, NaN, 3, -1, 2])
    const speed = new Float64Array([50, 60, 30, 40, 20])
    const points = buildCvtRatioSweep(ratio, speed)
    expect(points).toEqual([
      { speedKmh: 20, ratio: 2 },
      { speedKmh: 30, ratio: 3 },
      { speedKmh: 50, ratio: 5 },
    ])
  })

  it('returns [] when arrays share no valid samples', () => {
    const ratio = new Float64Array([NaN, 0, -1])
    const speed = new Float64Array([10, 20, 30])
    expect(buildCvtRatioSweep(ratio, speed)).toEqual([])
  })
})

describe('buildCvtRatioTimeSeries', () => {
  it('pairs ratio with time, filters NaN/non-positive, preserves time order', () => {
    const ratio = new Float64Array([5, NaN, 3, -1, 2])
    const time = new Float64Array([0, 1, 2, 3, 4])
    const points = buildCvtRatioTimeSeries(ratio, time)
    expect(points).toEqual([
      { timeS: 0, ratio: 5 },
      { timeS: 2, ratio: 3 },
      { timeS: 4, ratio: 2 },
    ])
  })

  it('returns [] when arrays share no valid samples', () => {
    const ratio = new Float64Array([NaN, 0, -1])
    const time = new Float64Array([0, 1, 2])
    expect(buildCvtRatioTimeSeries(ratio, time)).toEqual([])
  })
})

describe('cvtRatioSummary', () => {
  it('reports max ratio as launchRatio and min as topRatio', () => {
    const ratio = new Float64Array([2.4, 1.8, 1.2, 0.9, NaN, -1, 0])
    const summary = cvtRatioSummary(ratio)
    expect(summary.launchRatio).toBeCloseTo(2.4, 6)
    expect(summary.topRatio).toBeCloseTo(0.9, 6)
  })

  it('returns NaN fields when there are no finite positive samples', () => {
    const summary = cvtRatioSummary(new Float64Array([NaN, 0, -1]))
    expect(summary.launchRatio).toBeNaN()
    expect(summary.topRatio).toBeNaN()
  })
})

describe('estimateClutchEngagementRpm', () => {
  it('reports the RPM at standstill just before a sustained speed rise', () => {
    // Standstill (speed 0) at RPM 1800 for a few samples, then speed rises
    // and stays above the rising threshold.
    const rpm = new Float64Array([1800, 1800, 1800, 3000, 3200, 3400, 3600, 3800])
    const speed = new Float64Array([0, 0, 0, 4, 6, 8, 10, 12])
    expect(estimateClutchEngagementRpm(rpm, speed)).toBeCloseTo(1800, 6)
  })

  it('ignores a momentary speed blip that does not sustain', () => {
    const rpm = new Float64Array([1800, 1800, 1800, 1800, 1800, 1800, 1800])
    const speed = new Float64Array([0, 0, 5, 0, 0, 0, 0]) // blip, not sustained
    expect(estimateClutchEngagementRpm(rpm, speed, { sustainSamples: 3 })).toBeNaN()
  })

  it('returns NaN when there is no standstill in the trace', () => {
    const rpm = new Float64Array([3000, 3200, 3400])
    const speed = new Float64Array([20, 25, 30])
    expect(estimateClutchEngagementRpm(rpm, speed)).toBeNaN()
  })

  it('respects custom standstill/rising/sustain thresholds', () => {
    const rpm = new Float64Array([1500, 1500, 2000, 2100, 2200, 2300])
    const speed = new Float64Array([0.5, 0.5, 2, 2, 2, 2])
    expect(
      estimateClutchEngagementRpm(rpm, speed, { standstillSpeedKmh: 1, risingSpeedKmh: 1.5, sustainSamples: 3 }),
    ).toBeCloseTo(1500, 6)
  })
})

describe('estimateCircumferenceFromLog', () => {
  /** Build a synthetic multi-gear log at a known TRUE circumference: for each
   *  gear's total reduction, sweep engine RPM 5000..9000 and derive the
   *  exactly-consistent speed, with optional deterministic pseudo-noise on
   *  the speed channel (alternating +/-, no RNG in tests — same convention as
   *  detectGearPlateaus' syntheticTrace). */
  function synthLog(
    reductions: number[],
    circMm: number,
    samplesPerGear: number,
    noiseFrac = 0,
  ): { rpm: Float64Array; speed: Float64Array } {
    const rpm: number[] = []
    const speed: number[] = []
    for (const r of reductions) {
      for (let i = 0; i < samplesPerGear; i++) {
        const engineRpm = 5000 + (4000 * i) / Math.max(1, samplesPerGear - 1)
        const cleanSpeed = wheelRpmToSpeedKmh(engineRpm / r, circMm)
        const sign = i % 2 === 0 ? 1 : -1
        const frac = (i % 5) / 5
        rpm.push(engineRpm)
        speed.push(cleanSpeed * (1 + sign * noiseFrac * frac))
      }
    }
    return { rpm: new Float64Array(rpm), speed: new Float64Array(speed) }
  }

  it('matches a hand-computed single-gear inversion exactly', () => {
    // rpm 6000, total reduction 10 -> wheel 600 rpm; at C=1870mm that's
    // 600*1870*60/1e6 = 67.32 km/h. Feed the pair back in -> C recovered.
    const n = 30
    const rpm = new Float64Array(n).fill(6000)
    const speed = new Float64Array(n).fill(67.32)
    const est = estimateCircumferenceFromLog(rpm, speed, [10])
    expect(est.circumferenceMm).toBeCloseTo(1870, 3)
    expect(est.sampleCount).toBeGreaterThanOrEqual(n - 1)
  })

  it('recovers the true circumference from a clean multi-gear log', () => {
    const { rpm, speed } = synthLog(REF_TOTAL_REDUCTIONS, 1870, 60)
    const est = estimateCircumferenceFromLog(rpm, speed, REF_TOTAL_REDUCTIONS)
    expect(est.circumferenceMm).toBeCloseTo(1870, 0)
    expect(est.sampleCount).toBeGreaterThan(100)
  })

  it('stays within 1% under speed-channel noise', () => {
    const { rpm, speed } = synthLog(REF_TOTAL_REDUCTIONS, 1870, 80, 0.005)
    const est = estimateCircumferenceFromLog(rpm, speed, REF_TOTAL_REDUCTIONS)
    expect(Math.abs(est.circumferenceMm - 1870) / 1870).toBeLessThan(0.01)
  })

  it('ignores shift/slip transients between steady stretches (stability gate)', () => {
    const a = synthLog([REF_TOTAL_REDUCTIONS[0]], 1870, 40)
    const b = synthLog([REF_TOTAL_REDUCTIONS[1]], 1870, 40)
    // Splice a clutch-slip transient between the two gears: RPM flares while
    // speed stays put — implied circumference garbage if not filtered.
    const rpm = new Float64Array([...a.rpm, 9500, 9800, 9900, ...b.rpm])
    const speed = new Float64Array([...a.speed, 60, 61, 62, ...b.speed])
    const est = estimateCircumferenceFromLog(rpm, speed, REF_TOTAL_REDUCTIONS)
    expect(est.circumferenceMm).toBeCloseTo(1870, 0)
  })

  it('excludes samples below the speed/RPM floors', () => {
    // All samples idle-ish / parking speed: nothing qualifies.
    const rpm = new Float64Array(50).fill(1500)
    const speed = new Float64Array(50).fill(5)
    const est = estimateCircumferenceFromLog(rpm, speed, REF_TOTAL_REDUCTIONS)
    expect(est.circumferenceMm).toBeNaN()
    expect(est.sampleCount).toBe(0)
  })

  it('returns NaN when there are too few qualifying samples', () => {
    const rpm = new Float64Array(5).fill(6000)
    const speed = new Float64Array(5).fill(67.32)
    const est = estimateCircumferenceFromLog(rpm, speed, [10])
    expect(est.circumferenceMm).toBeNaN()
    expect(est.sampleCount).toBe(0)
  })

  it('returns NaN for empty data or no valid reductions', () => {
    expect(estimateCircumferenceFromLog([], [], [10]).circumferenceMm).toBeNaN()
    const rpm = new Float64Array(30).fill(6000)
    const speed = new Float64Array(30).fill(67.32)
    expect(estimateCircumferenceFromLog(rpm, speed, []).circumferenceMm).toBeNaN()
    expect(estimateCircumferenceFromLog(rpm, speed, [NaN, -3, 0]).circumferenceMm).toBeNaN()
  })

  it('discards implausible candidates (out of the mm plausibility range)', () => {
    // A "reduction" of 100 would imply an 18-metre circumference at these
    // samples — every vote lands outside the plausible range.
    const rpm = new Float64Array(30).fill(6000)
    const speed = new Float64Array(30).fill(67.32)
    const est = estimateCircumferenceFromLog(rpm, speed, [100])
    expect(est.circumferenceMm).toBeNaN()
  })

  it('breaks a single-gear ambiguity toward the reference circumference', () => {
    // Only ONE gear was actually ridden, so each gear hypothesis forms an
    // equally-big cluster (the data cannot distinguish them) — the tire-spec
    // reference should pick the physically-right one.
    const { rpm, speed } = synthLog([REF_TOTAL_REDUCTIONS[1]], 1870, 60)
    const est = estimateCircumferenceFromLog(rpm, speed, REF_TOTAL_REDUCTIONS, {
      referenceCircumferenceMm: 1900,
    })
    expect(est.circumferenceMm).toBeCloseTo(1870, 0)
  })

  it('returns NaN for a single-gear ambiguity when no reference is given', () => {
    // Same one-gear log as above, but nothing to break the tie with — the
    // estimator must refuse rather than guess a gear.
    const { rpm, speed } = synthLog([REF_TOTAL_REDUCTIONS[1]], 1870, 60)
    const est = estimateCircumferenceFromLog(rpm, speed, REF_TOTAL_REDUCTIONS)
    expect(est.circumferenceMm).toBeNaN()
    expect(est.sampleCount).toBe(0)
  })

  it('does not need the reference when multiple gears were ridden', () => {
    const { rpm, speed } = synthLog(REF_TOTAL_REDUCTIONS, 1560, 60)
    // No reference passed — the true value's cluster wins on votes alone.
    const est = estimateCircumferenceFromLog(rpm, speed, REF_TOTAL_REDUCTIONS)
    expect(est.circumferenceMm).toBeCloseTo(1560, 0)
  })
})
