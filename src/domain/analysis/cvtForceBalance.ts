import { solveCvtGeometry, type CvtGeometryInput, type CvtGeometrySolution } from './cvtDynamics'

export interface ForceCurvePoint {
  travelMm: number
  value: number
}

export interface RollerTrackPoint {
  travelMm: number
  radiusMm: number
}

export interface TorqueCamPoint {
  travelMm: number
  angleDeg: number
  effectiveRadiusMm: number
}

export interface CvtRollerModel {
  massesG: readonly number[]
  track: readonly RollerTrackPoint[]
  efficiency: number | null
}

export type CvtSpringModel =
  | { mode: 'linear'; rateNPerMm: number; installedPreloadMm: number }
  | { mode: 'curve'; points: readonly ForceCurvePoint[] }

export interface CvtTorqueCamModel {
  points: readonly TorqueCamPoint[]
  torqueShare: number | null
  torsionTorqueNm: number
}

export interface CvtCouplingModel {
  mode: 'disabled' | 'ideal' | 'calibrated'
  calibratedScale: number | null
  calibrationMap?: readonly { ratio: number; scale: number }[]
}

export interface CvtForceBalanceInput {
  actuationKind: 'mechanical' | 'electronic'
  geometry: Omit<CvtGeometryInput, 'pureRatio'>
  frontRpm: number
  rearTorqueNm: number
  roller: CvtRollerModel | null
  spring: CvtSpringModel | null
  torqueCam: CvtTorqueCamModel | null
  coupling: CvtCouplingModel
  samples?: number
}

export type CvtForceDisabledReason =
  | 'electronic-actuation'
  | 'operating-condition'
  | 'roller-masses'
  | 'roller-track'
  | 'roller-efficiency'
  | 'rear-spring'
  | 'torque-cam'
  | 'torque-share'
  | 'coupling'
  | 'geometry'

export interface CvtForcePoint {
  ratio: number
  geometry: CvtGeometrySolution
  frontRollerForceN: number
  rearSpringForceN: number
  rearCamForceN: number
  rearTotalForceN: number
  couplingRatio: number
  residualN: number
}

export interface CvtEquilibriumRoot extends CvtForcePoint {
  stable: boolean
  slopeNPerRatio: number
}

export interface CvtForceBalanceResult {
  status: 'disabled' | 'equilibrium' | 'endpoint' | 'no-feasible-geometry'
  disabledReasons: CvtForceDisabledReason[]
  curve: CvtForcePoint[]
  roots: CvtEquilibriumRoot[]
  selected: CvtForcePoint | null
  endpoint: 'low-ratio' | 'high-ratio' | null
}

const DEG_TO_RAD = Math.PI / 180
const RPM_TO_RAD_PER_SECOND = (2 * Math.PI) / 60

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function nonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function sortedStrictlyIncreasing(points: readonly { travelMm: number }[]): boolean {
  return points.length >= 2 && points.every((point, index) =>
    Number.isFinite(point.travelMm) && (index === 0 || point.travelMm > points[index - 1].travelMm),
  )
}

function segmentIndex(points: readonly { travelMm: number }[], travelMm: number): number {
  if (travelMm < points[0].travelMm || travelMm > points[points.length - 1].travelMm) return -1
  if (travelMm === points[points.length - 1].travelMm) return points.length - 2
  for (let index = 0; index < points.length - 1; index += 1) {
    if (travelMm >= points[index].travelMm && travelMm <= points[index + 1].travelMm) return index
  }
  return -1
}

/** Piecewise-linear interpolation. Values outside the measured travel are unavailable. */
export function interpolateForceCurve(points: readonly ForceCurvePoint[], travelMm: number): number {
  if (!sortedStrictlyIncreasing(points) || !Number.isFinite(travelMm) || points.some((point) => !nonNegative(point.value))) {
    return Number.NaN
  }
  const index = segmentIndex(points, travelMm)
  if (index < 0) return Number.NaN
  const left = points[index]
  const right = points[index + 1]
  const fraction = (travelMm - left.travelMm) / (right.travelMm - left.travelMm)
  return left.value + fraction * (right.value - left.value)
}

/** Measured roller-centre radius and local dr/dx for equation (2-2). */
export function rollerTrackState(
  points: readonly RollerTrackPoint[],
  travelMm: number,
): { radiusMm: number; slope: number } | null {
  if (
    !sortedStrictlyIncreasing(points) ||
    !Number.isFinite(travelMm) ||
    points.some((point, index) => !positive(point.radiusMm) || (index > 0 && point.radiusMm < points[index - 1].radiusMm))
  ) return null
  const index = segmentIndex(points, travelMm)
  if (index < 0) return null
  const left = points[index]
  const right = points[index + 1]
  const slope = (right.radiusMm - left.radiusMm) / (right.travelMm - left.travelMm)
  const radiusMm = left.radiusMm + (travelMm - left.travelMm) * slope
  return { radiusMm, slope }
}

/** Ideal roller axial force, with explicit efficiency, from equations (2-3) and (2-5). */
export function rollerAxialForceN(model: CvtRollerModel, travelMm: number, frontRpm: number): number {
  if (!positive(frontRpm) || !positive(model.efficiency ?? Number.NaN) || model.efficiency! > 1) return Number.NaN
  if (model.massesG.length === 0 || model.massesG.some((mass) => !positive(mass))) return Number.NaN
  const track = rollerTrackState(model.track, travelMm)
  if (!track) return Number.NaN
  const massKg = model.massesG.reduce((sum, mass) => sum + mass, 0) / 1000
  const radiusM = track.radiusMm / 1000
  const omega = frontRpm * RPM_TO_RAD_PER_SECOND
  return model.efficiency! * massKg * omega ** 2 * radiusM * track.slope
}

/** Rear compression-spring force from equation (2-6), or a measured force–travel curve. */
export function rearSpringForceN(model: CvtSpringModel, travelMm: number): number {
  if (!nonNegative(travelMm)) return Number.NaN
  if (model.mode === 'curve') return interpolateForceCurve(model.points, travelMm)
  if (!positive(model.rateNPerMm) || !nonNegative(model.installedPreloadMm)) return Number.NaN
  return model.rateNPerMm * (model.installedPreloadMm + travelMm)
}

function torqueCamState(points: readonly TorqueCamPoint[], travelMm: number): TorqueCamPoint | null {
  if (
    !sortedStrictlyIncreasing(points) ||
    points.some((point) => !positive(point.angleDeg) || point.angleDeg >= 90 || !positive(point.effectiveRadiusMm))
  ) return null
  const index = segmentIndex(points, travelMm)
  if (index < 0) return null
  const left = points[index]
  const right = points[index + 1]
  const fraction = (travelMm - left.travelMm) / (right.travelMm - left.travelMm)
  return {
    travelMm,
    angleDeg: left.angleDeg + fraction * (right.angleDeg - left.angleDeg),
    effectiveRadiusMm: left.effectiveRadiusMm + fraction * (right.effectiveRadiusMm - left.effectiveRadiusMm),
  }
}

/** Torque-cam axial force from equation (2-10); angle is relative to circumferential direction. */
export function rearCamForceN(model: CvtTorqueCamModel, travelMm: number, rearTorqueNm: number): number {
  if (!nonNegative(rearTorqueNm) || !nonNegative(model.torsionTorqueNm)) return Number.NaN
  if (!positive(model.torqueShare ?? Number.NaN) || model.torqueShare! >= 1) return Number.NaN
  const cam = torqueCamState(model.points, travelMm)
  if (!cam) return Number.NaN
  const effectiveTorqueNm = model.torqueShare! * rearTorqueNm + model.torsionTorqueNm
  return (1 / Math.tan(cam.angleDeg * DEG_TO_RAD)) * effectiveTorqueNm / (cam.effectiveRadiusMm / 1000)
}

export function cvtForceDisabledReasons(input: CvtForceBalanceInput): CvtForceDisabledReason[] {
  const reasons: CvtForceDisabledReason[] = []
  if (input.actuationKind === 'electronic') reasons.push('electronic-actuation')
  if (!positive(input.frontRpm) || !nonNegative(input.rearTorqueNm)) reasons.push('operating-condition')
  if (!input.roller || input.roller.massesG.length === 0 || input.roller.massesG.some((mass) => !positive(mass))) {
    reasons.push('roller-masses')
  }
  if (!input.roller || !sortedStrictlyIncreasing(input.roller.track)) reasons.push('roller-track')
  if (!input.roller || !positive(input.roller.efficiency ?? Number.NaN) || input.roller.efficiency! > 1) {
    reasons.push('roller-efficiency')
  }
  if (!input.spring) reasons.push('rear-spring')
  if (input.rearTorqueNm > 0 && !input.torqueCam) reasons.push('torque-cam')
  if (input.rearTorqueNm > 0 && (!input.torqueCam || !positive(input.torqueCam.torqueShare ?? Number.NaN))) {
    reasons.push('torque-share')
  }
  if (input.coupling.mode === 'disabled') reasons.push('coupling')
  const validCalibrationPoints = input.coupling.calibrationMap?.filter((point) => positive(point.ratio) && positive(point.scale)) ?? []
  if (
    input.coupling.mode === 'calibrated' &&
    !positive(input.coupling.calibratedScale ?? Number.NaN) &&
    validCalibrationPoints.length < 2
  ) reasons.push('coupling')
  const geometry = input.geometry
  if (
    !positive(geometry.pitchLengthMm) || !positive(geometry.centerDistanceMm) ||
    !positive(geometry.frontSheaveHalfAngleDeg) || !positive(geometry.rearSheaveHalfAngleDeg) ||
    !positive(geometry.frontRadiusBoundsMm.min) || !positive(geometry.frontRadiusBoundsMm.max) ||
    !positive(geometry.rearRadiusBoundsMm.min) || !positive(geometry.rearRadiusBoundsMm.max)
  ) reasons.push('geometry')
  return [...new Set(reasons)]
}

export function evaluateCvtForceAtRatio(input: CvtForceBalanceInput, ratio: number): CvtForcePoint | null {
  const geometry = solveCvtGeometry({ ...input.geometry, pureRatio: ratio })
  if (geometry.status !== 'ok') return null
  const frontRollerForceN = rollerAxialForceN(input.roller!, geometry.frontDisplacementMm, input.frontRpm)
  const rearSpringForceNValue = rearSpringForceN(input.spring!, geometry.rearDisplacementMm)
  const rearCamForceNValue = input.rearTorqueNm === 0
    ? 0
    : rearCamForceN(input.torqueCam!, geometry.rearDisplacementMm, input.rearTorqueNm)
  const idealRatio = geometry.frontWrapAngleRad / geometry.rearWrapAngleRad
  const map = input.coupling.calibrationMap
  let scale = input.coupling.calibratedScale ?? Number.NaN
  if (input.coupling.mode === 'calibrated' && map?.length) {
    const points = [...map].filter((point) => positive(point.ratio) && positive(point.scale)).sort((a, b) => a.ratio - b.ratio)
    if (points.length === 1 && ratio === points[0].ratio) scale = points[0].scale
    else {
      for (let index = 0; index < points.length - 1; index += 1) {
        const left = points[index]
        const right = points[index + 1]
        if (ratio < left.ratio || ratio > right.ratio) continue
        scale = left.scale + (ratio - left.ratio) / (right.ratio - left.ratio) * (right.scale - left.scale)
        break
      }
    }
  }
  const couplingRatio = input.coupling.mode === 'calibrated' ? idealRatio * scale : idealRatio
  const rearTotalForceN = rearSpringForceNValue + rearCamForceNValue
  const residualN = frontRollerForceN - couplingRatio * rearTotalForceN
  if (![frontRollerForceN, rearSpringForceNValue, rearCamForceNValue, couplingRatio, residualN].every(Number.isFinite)) {
    return null
  }
  return {
    ratio,
    geometry,
    frontRollerForceN,
    rearSpringForceN: rearSpringForceNValue,
    rearCamForceN: rearCamForceNValue,
    rearTotalForceN,
    couplingRatio,
    residualN,
  }
}

function findRoot(input: CvtForceBalanceInput, leftPoint: CvtForcePoint, rightPoint: CvtForcePoint): CvtEquilibriumRoot {
  let left = leftPoint
  let right = rightPoint
  for (let step = 0; step < 70; step += 1) {
    const middle = evaluateCvtForceAtRatio(input, (left.ratio + right.ratio) / 2)
    if (!middle) break
    if (Math.abs(middle.residualN) < 1e-7) {
      left = middle
      right = middle
      break
    }
    if (Math.sign(middle.residualN) === Math.sign(left.residualN)) left = middle
    else right = middle
  }
  const root = evaluateCvtForceAtRatio(input, (left.ratio + right.ratio) / 2) ?? left
  const span = Math.max(1e-5, root.ratio * 1e-4)
  const before = evaluateCvtForceAtRatio(input, root.ratio - span)
  const after = evaluateCvtForceAtRatio(input, root.ratio + span)
  const slopeNPerRatio = before && after
    ? (after.residualN - before.residualN) / (after.ratio - before.ratio)
    : (rightPoint.residualN - leftPoint.residualN) / (rightPoint.ratio - leftPoint.ratio)
  return { ...root, slopeNPerRatio, stable: slopeNPerRatio > 0 }
}

/** Solve all quasi-static equilibria and report the mechanical endpoint when no root exists. */
export function solveCvtForceBalance(input: CvtForceBalanceInput): CvtForceBalanceResult {
  const reasons = cvtForceDisabledReasons(input)
  if (reasons.length > 0) {
    return { status: 'disabled', disabledReasons: reasons, curve: [], roots: [], selected: null, endpoint: null }
  }
  const lowerRatio = input.geometry.rearRadiusBoundsMm.min / input.geometry.frontRadiusBoundsMm.max
  const upperRatio = input.geometry.rearRadiusBoundsMm.max / input.geometry.frontRadiusBoundsMm.min
  const count = Math.max(25, Math.min(1001, Math.round(input.samples ?? 161)))
  const curve: CvtForcePoint[] = []
  for (let index = 0; index < count; index += 1) {
    const ratio = lowerRatio + (upperRatio - lowerRatio) * index / (count - 1)
    const point = evaluateCvtForceAtRatio(input, ratio)
    if (point) curve.push(point)
  }
  if (curve.length === 0) {
    return { status: 'no-feasible-geometry', disabledReasons: [], curve, roots: [], selected: null, endpoint: null }
  }
  const roots: CvtEquilibriumRoot[] = []
  for (let index = 0; index < curve.length - 1; index += 1) {
    const left = curve[index]
    const right = curve[index + 1]
    if (left.residualN === 0) roots.push(findRoot(input, left, right))
    else if (Math.sign(left.residualN) !== Math.sign(right.residualN)) roots.push(findRoot(input, left, right))
  }
  if (roots.length > 0) {
    const selected = roots.find((root) => root.stable) ?? roots[0]
    return { status: 'equilibrium', disabledReasons: [], curve, roots, selected, endpoint: null }
  }
  const low = curve[0]
  const high = curve[curve.length - 1]
  const endpoint = low.residualN > 0 && high.residualN > 0 ? 'low-ratio' : 'high-ratio'
  return {
    status: 'endpoint',
    disabledReasons: [],
    curve,
    roots,
    selected: endpoint === 'low-ratio' ? low : high,
    endpoint,
  }
}
