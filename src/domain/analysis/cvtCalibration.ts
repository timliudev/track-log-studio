import {
  cvtForceDisabledReasons,
  evaluateCvtForceAtRatio,
  type CvtForceBalanceInput,
} from './cvtForceBalance'

export interface FixedReductionCalibration {
  status: 'ok' | 'unstable' | 'invalid'
  combinedFixedReduction: number
  medianTotalReduction: number
  relativeMad: number
  sampleCount: number
}

export interface CvtCalibrationMapPoint {
  ratio: number
  scale: number
}

export interface RollerMassSensitivityPoint {
  ratio: number
  nominalRpm: number
  lighterRpm: number
  heavierRpm: number
  lighterDeltaRpm: number
  heavierDeltaRpm: number
}

export interface RollerMassSensitivityResult {
  status: 'ok' | 'disabled' | 'no-root'
  totalMassG: number
  deltaTotalMassG: number
  points: RollerMassSensitivityPoint[]
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** Infer a combined fixed reduction from a user-confirmed locked, steady segment. */
export function inferFixedReductionFromSegment(
  measuredTotalReduction: ArrayLike<number>,
  startIndex: number,
  endIndex: number,
  referencePureCvtRatio: number,
  unstableRelativeMad = 0.01,
): FixedReductionCalibration {
  if (!positive(referencePureCvtRatio) || !Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
    return { status: 'invalid', combinedFixedReduction: Number.NaN, medianTotalReduction: Number.NaN, relativeMad: Number.NaN, sampleCount: 0 }
  }
  const start = Math.max(0, Math.min(startIndex, endIndex))
  const end = Math.min(measuredTotalReduction.length - 1, Math.max(startIndex, endIndex))
  const values: number[] = []
  for (let index = start; index <= end; index += 1) {
    const value = measuredTotalReduction[index]
    if (positive(value)) values.push(value)
  }
  if (values.length < 3) {
    return { status: 'invalid', combinedFixedReduction: Number.NaN, medianTotalReduction: Number.NaN, relativeMad: Number.NaN, sampleCount: values.length }
  }
  const center = median(values)
  const mad = median(values.map((value) => Math.abs(value - center)))
  const relativeMad = mad / center
  return {
    status: relativeMad <= unstableRelativeMad ? 'ok' : 'unstable',
    combinedFixedReduction: center / referencePureCvtRatio,
    medianTotalReduction: center,
    relativeMad,
    sampleCount: values.length,
  }
}

/** Piecewise-linear directional kcal map. No extrapolation beyond measured q. */
export function calibrationScaleAtRatio(points: readonly CvtCalibrationMapPoint[], ratio: number): number {
  const sorted = [...points]
    .filter((point) => positive(point.ratio) && positive(point.scale))
    .sort((a, b) => a.ratio - b.ratio)
  if (sorted.length === 0 || ratio < sorted[0].ratio || ratio > sorted[sorted.length - 1].ratio) return Number.NaN
  if (sorted.length === 1) return ratio === sorted[0].ratio ? sorted[0].scale : Number.NaN
  if (ratio === sorted[sorted.length - 1].ratio) return sorted[sorted.length - 1].scale
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index]
    const right = sorted[index + 1]
    if (ratio < left.ratio || ratio > right.ratio) continue
    const fraction = (ratio - left.ratio) / (right.ratio - left.ratio)
    return left.scale + fraction * (right.scale - left.scale)
  }
  return Number.NaN
}

/** Solve Ψ(q, rpm)=0 at a fixed ratio and load using a bounded RPM bisection. */
export function solveEquilibriumRpmAtRatio(
  input: CvtForceBalanceInput,
  ratio: number,
  rpmBounds: { min: number; max: number } = { min: 500, max: 20000 },
): number {
  if (!positive(ratio) || !positive(rpmBounds.min) || rpmBounds.max <= rpmBounds.min) return Number.NaN
  const lowerInput = { ...input, frontRpm: rpmBounds.min }
  const upperInput = { ...input, frontRpm: rpmBounds.max }
  if (cvtForceDisabledReasons(lowerInput).length > 0 || cvtForceDisabledReasons(upperInput).length > 0) return Number.NaN
  let lower = rpmBounds.min
  let upper = rpmBounds.max
  let lowerPoint = evaluateCvtForceAtRatio(lowerInput, ratio)
  let upperPoint = evaluateCvtForceAtRatio(upperInput, ratio)
  if (!lowerPoint || !upperPoint || Math.sign(lowerPoint.residualN) === Math.sign(upperPoint.residualN)) return Number.NaN
  for (let step = 0; step < 70; step += 1) {
    const middle = (lower + upper) / 2
    const point = evaluateCvtForceAtRatio({ ...input, frontRpm: middle }, ratio)
    if (!point) return Number.NaN
    if (Math.abs(point.residualN) < 1e-7) return middle
    if (Math.sign(point.residualN) === Math.sign(lowerPoint.residualN)) {
      lower = middle
      lowerPoint = point
    } else {
      upper = middle
      upperPoint = point
    }
  }
  void upperPoint
  return (lower + upper) / 2
}

function withTotalMass(input: CvtForceBalanceInput, totalMassG: number): CvtForceBalanceInput {
  const original = input.roller?.massesG.reduce((sum, value) => sum + value, 0) ?? 0
  if (!input.roller || !positive(original) || !positive(totalMassG)) return input
  const scale = totalMassG / original
  return {
    ...input,
    roller: { ...input.roller, massesG: input.roller.massesG.map((mass) => mass * scale) },
  }
}

/** Re-solve each fixed-q operating point for total roller mass ±Δg. */
export function sweepTotalRollerMass(
  input: CvtForceBalanceInput,
  ratios: readonly number[],
  deltaTotalMassG: number,
): RollerMassSensitivityResult {
  const totalMassG = input.roller?.massesG.reduce((sum, value) => sum + value, 0) ?? Number.NaN
  if (!positive(totalMassG) || !positive(deltaTotalMassG) || totalMassG <= deltaTotalMassG || cvtForceDisabledReasons(input).length > 0) {
    return { status: 'disabled', totalMassG, deltaTotalMassG, points: [] }
  }
  const lighter = withTotalMass(input, totalMassG - deltaTotalMassG)
  const heavier = withTotalMass(input, totalMassG + deltaTotalMassG)
  const points: RollerMassSensitivityPoint[] = []
  for (const ratio of ratios) {
    const nominalRpm = solveEquilibriumRpmAtRatio(input, ratio)
    const lighterRpm = solveEquilibriumRpmAtRatio(lighter, ratio)
    const heavierRpm = solveEquilibriumRpmAtRatio(heavier, ratio)
    if (![nominalRpm, lighterRpm, heavierRpm].every(Number.isFinite)) continue
    points.push({
      ratio,
      nominalRpm,
      lighterRpm,
      heavierRpm,
      lighterDeltaRpm: lighterRpm - nominalRpm,
      heavierDeltaRpm: heavierRpm - nominalRpm,
    })
  }
  return { status: points.length > 0 ? 'ok' : 'no-root', totalMassG, deltaTotalMassG, points }
}
