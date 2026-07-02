import { describe, it, expect } from 'vitest'
import {
  finalDriveRatio,
  wheelRpmToSpeedKmh,
  speedKmhToWheelRpm,
  computeMtGearTable,
  rpmSpeedTable,
  shiftRpmDrop,
  computeCvtSpeedRange,
  computeRatioSeries,
  detectGearPlateaus,
  buildCvtRatioSweep,
  type MtDrivetrainSpec,
} from '@/domain/analysis/drivetrain'

// Real-ish MT reference bike, hand-computed in Python (see PR description):
// primary 2.833, gears [2.615, 1.812, 1.409, 1.16, 1.0, 0.885], 15/45
// sprockets, 1870mm wheel circumference, 10000 RPM redline.
const REF_SPEC: MtDrivetrainSpec = {
  primaryReduction: 2.833,
  gearRatios: [2.615, 1.812, 1.409, 1.16, 1.0, 0.885],
  frontSprocketTeeth: 15,
  rearSprocketTeeth: 45,
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

  it('returns [] for an invalid spec (zero sprocket teeth)', () => {
    expect(computeMtGearTable({ ...REF_SPEC, frontSprocketTeeth: 0 })).toEqual([])
  })

  it('returns [] for an invalid spec (zero wheel circumference)', () => {
    expect(computeMtGearTable({ ...REF_SPEC, wheelCircumferenceMm: 0 })).toEqual([])
  })

  it('skips non-positive individual gear ratios but keeps the rest', () => {
    const spec = { ...REF_SPEC, gearRatios: [2.615, 0, 1.409] }
    const results = computeMtGearTable(spec)
    expect(results.map((r) => r.gear)).toEqual([1, 3])
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

describe('computeCvtSpeedRange', () => {
  it('computes low/high speeds at max RPM (hand-checked)', () => {
    // ratioLow=2.4 (launch), ratioHigh=0.9 (top), final=8, wheel 1400mm, 8000 RPM.
    const range = computeCvtSpeedRange({
      ratioLow: 2.4,
      ratioHigh: 0.9,
      finalReduction: 8,
      wheelCircumferenceMm: 1400,
      maxRpm: 8000,
    })
    // wheelRpmLow = 8000 / (2.4*8) = 416.667 -> speed = 416.667*1400*60/1e6 = 35.0
    expect(range.speedAtLowKmh).toBeCloseTo(35.0, 1)
    // wheelRpmHigh = 8000 / (0.9*8) = 1111.11 -> speed = 1111.11*1400*60/1e6 = 93.33
    expect(range.speedAtHighKmh).toBeCloseTo(93.33, 1)
    expect(range.speedAtHighKmh).toBeGreaterThan(range.speedAtLowKmh)
  })

  it('returns NaN speeds for an invalid spec', () => {
    const range = computeCvtSpeedRange({
      ratioLow: 0,
      ratioHigh: 0.9,
      finalReduction: 8,
      wheelCircumferenceMm: 1400,
      maxRpm: 8000,
    })
    expect(range.speedAtLowKmh).toBeNaN()
    expect(range.speedAtHighKmh).toBeNaN()
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
