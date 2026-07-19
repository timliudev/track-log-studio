export interface ReductionStageInput {
  driveTeeth: number
  drivenTeeth: number
}

export interface FixedReductionInput {
  mode: 'ratio' | 'stages'
  ratio: number
  stages: ReductionStageInput[]
}

export interface RadiusBoundsMm {
  min: number
  max: number
}

export interface CvtGeometryInput {
  pureRatio: number
  pitchLengthMm: number
  centerDistanceMm: number
  frontRadiusBoundsMm: RadiusBoundsMm
  rearRadiusBoundsMm: RadiusBoundsMm
  frontReferenceRadiusMm?: number
  rearReferenceRadiusMm?: number
  frontSheaveHalfAngleDeg: number
  rearSheaveHalfAngleDeg: number
}

export interface CvtGeometrySolution {
  status: 'ok' | 'invalid-input' | 'no-root' | 'out-of-bounds'
  frontRadiusMm: number
  rearRadiusMm: number
  frontWrapAngleRad: number
  rearWrapAngleRad: number
  frontDisplacementMm: number
  rearDisplacementMm: number
  lengthResidualMm: number
  frontBoundsExcessRatio: number
  rearBoundsExcessRatio: number
}

export interface SheaveAngleMismatch {
  displacementScaleDifferenceRatio: number
  edgeWidthDifferenceMm: number
  wedgeGainDifferenceRatio: number
}

const ROOT_TOLERANCE_MM = 1e-9
const MAX_BISECTION_STEPS = 100

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function validBounds(bounds: RadiusBoundsMm): boolean {
  return finitePositive(bounds.min) && finitePositive(bounds.max) && bounds.max >= bounds.min
}

function blankSolution(status: CvtGeometrySolution['status']): CvtGeometrySolution {
  return {
    status,
    frontRadiusMm: Number.NaN,
    rearRadiusMm: Number.NaN,
    frontWrapAngleRad: Number.NaN,
    rearWrapAngleRad: Number.NaN,
    frontDisplacementMm: Number.NaN,
    rearDisplacementMm: Number.NaN,
    lengthResidualMm: Number.NaN,
    frontBoundsExcessRatio: Number.NaN,
    rearBoundsExcessRatio: Number.NaN,
  }
}

/** Resolve a direct reduction or a sequence of driving/driven tooth pairs. */
export function resolveFixedReduction(input: FixedReductionInput): number {
  if (input.mode === 'ratio') return finitePositive(input.ratio) ? input.ratio : Number.NaN
  if (input.stages.length === 0) return Number.NaN
  let result = 1
  for (const stage of input.stages) {
    if (!finitePositive(stage.driveTeeth) || !finitePositive(stage.drivenTeeth)) return Number.NaN
    result *= stage.drivenTeeth / stage.driveTeeth
  }
  return result
}

/** Convert an outside circumference to the tensile-cord pitch line. */
export function pitchLengthFromOutsideMm(outsideLengthMm: number, cordOffsetFromOutsideMm: number): number {
  if (!finitePositive(outsideLengthMm) || !finitePositive(cordOffsetFromOutsideMm)) return Number.NaN
  const pitchLength = outsideLengthMm - 2 * Math.PI * cordOffsetFromOutsideMm
  return finitePositive(pitchLength) ? pitchLength : Number.NaN
}

/** Exact open-belt path length for two pitch radii. */
export function openBeltLengthMm(frontRadiusMm: number, rearRadiusMm: number, centerDistanceMm: number): number {
  if (!finitePositive(frontRadiusMm) || !finitePositive(rearRadiusMm) || !finitePositive(centerDistanceMm)) {
    return Number.NaN
  }
  const delta = rearRadiusMm - frontRadiusMm
  if (Math.abs(delta) >= centerDistanceMm) return Number.NaN
  const epsilon = Math.asin(delta / centerDistanceMm)
  return (
    Math.PI * (frontRadiusMm + rearRadiusMm) +
    2 * delta * epsilon +
    2 * Math.sqrt(centerDistanceMm ** 2 - delta ** 2)
  )
}

/** Common engineering approximation retained as a regression reference. */
export function approximateOpenBeltLengthMm(
  frontRadiusMm: number,
  rearRadiusMm: number,
  centerDistanceMm: number,
): number {
  if (!finitePositive(frontRadiusMm) || !finitePositive(rearRadiusMm) || !finitePositive(centerDistanceMm)) {
    return Number.NaN
  }
  const delta = rearRadiusMm - frontRadiusMm
  return 2 * centerDistanceMm + Math.PI * (frontRadiusMm + rearRadiusMm) + delta ** 2 / centerDistanceMm
}

export function pureCvtRatio(totalReduction: number, gearReduction: number, finalReduction: number): number {
  if (!finitePositive(totalReduction) || !finitePositive(gearReduction) || !finitePositive(finalReduction)) {
    return Number.NaN
  }
  return totalReduction / gearReduction / finalReduction
}

export function sheaveDisplacementMm(
  radiusMm: number,
  referenceRadiusMm: number,
  sheaveHalfAngleDeg: number,
  direction: 'front-closing' | 'rear-opening',
): number {
  if (!finitePositive(radiusMm) || !finitePositive(referenceRadiusMm) || !finitePositive(sheaveHalfAngleDeg)) {
    return Number.NaN
  }
  const magnitude = 2 * (radiusMm - referenceRadiusMm) * Math.tan((sheaveHalfAngleDeg * Math.PI) / 180)
  return direction === 'front-closing' ? magnitude : -magnitude
}

function boundsExcessRatio(value: number, bounds: RadiusBoundsMm): number {
  if (value < bounds.min) return (bounds.min - value) / bounds.min
  if (value > bounds.max) return (value - bounds.max) / bounds.max
  return 0
}

/** Solve the exact belt-length and ratio constraints as a bounded 1-D root. */
export function solveCvtGeometry(input: CvtGeometryInput): CvtGeometrySolution {
  const {
    pureRatio: ratio,
    pitchLengthMm,
    centerDistanceMm: center,
    frontRadiusBoundsMm,
    rearRadiusBoundsMm,
    frontSheaveHalfAngleDeg,
    rearSheaveHalfAngleDeg,
  } = input
  if (
    !finitePositive(ratio) ||
    !finitePositive(pitchLengthMm) ||
    !finitePositive(center) ||
    !finitePositive(frontSheaveHalfAngleDeg) ||
    !finitePositive(rearSheaveHalfAngleDeg) ||
    !validBounds(frontRadiusBoundsMm) ||
    !validBounds(rearRadiusBoundsMm)
  ) {
    return blankSolution('invalid-input')
  }

  let frontRadius: number
  if (Math.abs(ratio - 1) <= Number.EPSILON) {
    frontRadius = (pitchLengthMm - 2 * center) / (2 * Math.PI)
    if (!finitePositive(frontRadius)) return blankSolution('no-root')
  } else {
    const physicalUpper = (center * (1 - 1e-12)) / Math.abs(ratio - 1)
    let lower = Math.max(Number.EPSILON * center, 1e-9)
    let upper = physicalUpper
    const residual = (candidate: number): number => {
      const length = openBeltLengthMm(candidate, ratio * candidate, center)
      return length - pitchLengthMm
    }
    let lowerResidual = residual(lower)
    let upperResidual = residual(upper)
    if (!Number.isFinite(lowerResidual) || !Number.isFinite(upperResidual) || lowerResidual > 0 || upperResidual < 0) {
      return blankSolution('no-root')
    }
    for (let step = 0; step < MAX_BISECTION_STEPS; step += 1) {
      const midpoint = (lower + upper) / 2
      const midpointResidual = residual(midpoint)
      if (Math.abs(midpointResidual) <= ROOT_TOLERANCE_MM) {
        lower = midpoint
        upper = midpoint
        break
      }
      if (midpointResidual < 0) {
        lower = midpoint
        lowerResidual = midpointResidual
      } else {
        upper = midpoint
        upperResidual = midpointResidual
      }
    }
    void lowerResidual
    void upperResidual
    frontRadius = (lower + upper) / 2
  }

  const rearRadius = ratio * frontRadius
  const delta = rearRadius - frontRadius
  if (Math.abs(delta) >= center) return blankSolution('no-root')
  const epsilon = Math.asin(delta / center)
  const frontExcess = boundsExcessRatio(frontRadius, frontRadiusBoundsMm)
  const rearExcess = boundsExcessRatio(rearRadius, rearRadiusBoundsMm)
  const referenceFront = input.frontReferenceRadiusMm ?? frontRadiusBoundsMm.min
  const referenceRear = input.rearReferenceRadiusMm ?? rearRadiusBoundsMm.max
  return {
    status: frontExcess > 0 || rearExcess > 0 ? 'out-of-bounds' : 'ok',
    frontRadiusMm: frontRadius,
    rearRadiusMm: rearRadius,
    frontWrapAngleRad: Math.PI - 2 * epsilon,
    rearWrapAngleRad: Math.PI + 2 * epsilon,
    frontDisplacementMm: sheaveDisplacementMm(
      frontRadius,
      referenceFront,
      frontSheaveHalfAngleDeg,
      'front-closing',
    ),
    rearDisplacementMm: sheaveDisplacementMm(rearRadius, referenceRear, rearSheaveHalfAngleDeg, 'rear-opening'),
    lengthResidualMm: openBeltLengthMm(frontRadius, rearRadius, center) - pitchLengthMm,
    frontBoundsExcessRatio: frontExcess,
    rearBoundsExcessRatio: rearExcess,
  }
}

export function sheaveAngleMismatch(
  beltHalfAngleDeg: number,
  sheaveHalfAngleDeg: number,
  radialContactHeightMm: number,
): SheaveAngleMismatch | null {
  if (!finitePositive(beltHalfAngleDeg) || !finitePositive(sheaveHalfAngleDeg) || !finitePositive(radialContactHeightMm)) {
    return null
  }
  const beltAngle = (beltHalfAngleDeg * Math.PI) / 180
  const sheaveAngle = (sheaveHalfAngleDeg * Math.PI) / 180
  return {
    displacementScaleDifferenceRatio: Math.tan(sheaveAngle) / Math.tan(beltAngle) - 1,
    edgeWidthDifferenceMm: 2 * radialContactHeightMm * (Math.tan(sheaveAngle) - Math.tan(beltAngle)),
    wedgeGainDifferenceRatio: (1 / Math.sin(beltAngle)) / (1 / Math.sin(sheaveAngle)) - 1,
  }
}
