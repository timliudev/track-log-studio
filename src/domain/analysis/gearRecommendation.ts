import type { GearRatioInput, MtDrivetrainSpec } from '@/domain/analysis/drivetrain'
import {
  resolveGearRatio,
  resolveFinalDrive,
  speedKmhToWheelRpm,
  computeMtGearTable,
} from '@/domain/analysis/drivetrain'

/**
 * F8 — 齒比建議 (gear-ratio recommendation), motorcycle context.
 *
 * `drivetrain.ts` (see its header) turns a manually-entered MT spec into pure
 * GEOMETRY: total reduction and speed-at-a-given-rpm. It has no notion of the
 * ENGINE — no torque curve, no powerband, no "where should I actually shift".
 * This module adds that layer on top, entirely as pure math (no Vue/Pinia/DOM
 * anywhere here — see the forbidden-files note in the PR description for why
 * this batch is deliberately UI-less).
 *
 * ── Two engine-profile fidelities, and why the split matters ───────────────
 *
 * Riders describe their engine in one of two ways:
 *
 * 1. **`curve`** — a digitised dyno sheet or manufacturer curve: an ordered
 *    list of (rpm, torque) samples plus redline. This is the ONLY input that
 *    actually encodes the SHAPE of the power delivery — where torque starts
 *    falling off, whether there's a mid-range dip, how power tails at
 *    redline. Anything that needs to reason about that shape (where two
 *    gears' wheel-torque curves cross over, a forward accel simulation) is
 *    only honest when it has real curve data.
 * 2. **`twoPoint`** — just the peak-torque rpm, peak-power rpm and redline
 *    (the numbers on a spec sheet), with the peak values themselves optional.
 *    This is enough to define a USABLE BAND (peak-torque rpm .. redline) and
 *    feed band-edge heuristics (ratio spacing, landing-rpm diagnosis,
 *    top-speed solving) — none of those need the curve's shape, only its
 *    edges. But a two-point profile is HONESTLY NOT a curve: interpolating
 *    "torque at 6500rpm" from three sparse facts would be fabricating data
 *    the rider never gave us.
 *
 * **Honesty constraint, enforced by the type system**: every function that
 * needs the actual curve shape (`torqueAt`, `peakPowerRpm`, `optimalShiftRpm`,
 * `simulateAcceleration`) is typed to accept ONLY `EngineCurveProfile`, never
 * the `EngineProfile` union — so passing a `twoPoint` profile to them is a
 * COMPILE ERROR, not a silent bad-data fallback. Functions that only need the
 * band edges (`usableBand`, `recommendRatioSpacing`, `diagnoseExistingRatios`,
 * `finalDriveForTopSpeed`, `recommendForMeasuredSpeeds`) accept either kind
 * via `EngineProfile` / `UsableBand`, because they were designed to work off
 * just the edges in the first place.
 *
 * ── Units ────────────────────────────────────────────────────────────────
 *
 * RPM = engine rpm. Torque = newton-metres (Nm). Power is normalised
 * internally to kW. Speed = km/h (matches `drivetrain.ts`). Ratios are
 * dimensionless (engine turns per wheel turn), matching `drivetrain.ts`'s
 * convention: gear index 0 = 1st gear (highest ratio) .. index N-1 = top gear.
 *
 * ── Horsepower: which "hp"? ──────────────────────────────────────────────
 *
 * Two incompatible units are both called "horsepower" on spec sheets:
 * **metric horsepower (PS/CV/cv)**, 1 PS = 0.735499 kW, and **mechanical
 * (imperial) horsepower**, 1 hp = 0.745700 kW — about 1.4% apart, enough to
 * matter for a torque-band calculation. This module defaults every hp
 * conversion to **metric PS** (`HorsepowerStandard = 'metric'`), because the
 * bikes this tool targets are near-universally spec'd in PS/cv on their home
 * markets; callers with a US-market mechanical-hp figure must pass
 * `standard: 'mechanical'` explicitly. Every function that accepts hp takes
 * an explicit `standard` parameter (never a silent global default baked into
 * the call site) so the choice is visible at every call.
 *
 * Power<->torque conversion (SI, both directions used throughout):
 *   P[kW] = T[Nm] * rpm / 9549.3        (9549.3 = 60 / (2*pi*1000))
 *   T[Nm] = P[kW] * 9549.3 / rpm
 *
 * ── Interpolation policy ────────────────────────────────────────────────
 *
 * `torqueAt` is linear between adjacent curve points and CLAMPS outside the
 * point range (returns the nearest endpoint's torque) — it never
 * extrapolates. A dyno sheet says nothing about torque above its last sample
 * or below its first; guessing there would silently fabricate data.
 */

// ── Unit conversions ────────────────────────────────────────────────────────

/** Which "horsepower" a caller means — see the module header. */
export type HorsepowerStandard = 'metric' | 'mechanical'

/** kW per 1 metric horsepower (PS/CV/cv). */
const KW_PER_METRIC_PS = 0.73549875
/** kW per 1 mechanical (imperial) horsepower. */
const KW_PER_MECHANICAL_HP = 0.7456998716

/** Convert a horsepower figure to kW under the given standard (default metric PS). */
export function hpToKw(hp: number, standard: HorsepowerStandard = 'metric'): number {
  if (!Number.isFinite(hp) || hp < 0) return NaN
  return hp * (standard === 'mechanical' ? KW_PER_MECHANICAL_HP : KW_PER_METRIC_PS)
}

/** Convert kW to a horsepower figure under the given standard (default metric PS). */
export function kwToHp(kw: number, standard: HorsepowerStandard = 'metric'): number {
  if (!Number.isFinite(kw) || kw < 0) return NaN
  return kw / (standard === 'mechanical' ? KW_PER_MECHANICAL_HP : KW_PER_METRIC_PS)
}

/**
 * Power at a given engine speed for a given torque: P[kW] = T[Nm] * rpm / 9549.3.
 * The constant converts Nm * rad/s to kW (9549.3 = 60000 / (2*pi)); see the
 * module header. Returns NaN for non-finite or non-positive rpm/torque.
 */
export function powerKwFromTorqueNm(torqueNm: number, rpm: number): number {
  if (!Number.isFinite(torqueNm) || !Number.isFinite(rpm) || torqueNm <= 0 || rpm <= 0) return NaN
  return (torqueNm * rpm) / 9549.3
}

/** Inverse of {@link powerKwFromTorqueNm}: T[Nm] = P[kW] * 9549.3 / rpm. */
export function torqueNmFromPowerKw(powerKw: number, rpm: number): number {
  if (!Number.isFinite(powerKw) || !Number.isFinite(rpm) || powerKw <= 0 || rpm <= 0) return NaN
  return (powerKw * 9549.3) / rpm
}

// ── Engine profile types ─────────────────────────────────────────────────

/** One (rpm, torque) sample on a digitised curve. */
export interface EnginePoint {
  rpm: number
  torqueNm: number
}

/**
 * Full digitised torque curve — the ONLY profile kind that encodes curve
 * shape (see module header). Construct via {@link createEngineCurveProfile},
 * which validates; do not build this literal by hand in application code.
 */
export interface EngineCurveProfile {
  kind: 'curve'
  points: EnginePoint[]
  redlineRpm: number
}

/**
 * Spec-sheet-only profile: peak-torque rpm, peak-power rpm, redline, and
 * (optionally) the peak values themselves. Deliberately cannot express curve
 * shape — see module header for why functions needing shape reject this kind
 * at compile time. Construct via {@link createEngineTwoPointProfile}.
 */
export interface EngineTwoPointProfile {
  kind: 'twoPoint'
  peakTorqueRpm: number
  peakPowerRpm: number
  redlineRpm: number
  peakTorqueNm?: number
  peakPowerKw?: number
}

/** Either profile kind — see module header for which functions accept this
 *  vs. requiring {@link EngineCurveProfile} specifically. */
export type EngineProfile = EngineCurveProfile | EngineTwoPointProfile

/** Minimum curve points required to call it a curve rather than a couple of
 *  spec-sheet facts (below this, use {@link createEngineTwoPointProfile}). */
const MIN_CURVE_POINTS = 3

/**
 * Validate and construct an {@link EngineCurveProfile}. Requires at least
 * {@link MIN_CURVE_POINTS} points, STRICTLY increasing rpm (the caller's
 * array order is trusted as the intended curve order — this validates it,
 * it does not sort for you, since silently reordering could mask a data-
 * entry mistake), and every rpm/torque finite and positive. `redlineRpm`
 * must be finite and positive (it need not equal the last point's rpm — a
 * curve can stop short of redline on a sparse manual digitisation).
 *
 * Returns `null` on any validation failure rather than throwing or building
 * a partially-invalid object, matching this module's "return null, don't
 * propagate NaN" convention.
 */
export function createEngineCurveProfile(points: EnginePoint[], redlineRpm: number): EngineCurveProfile | null {
  if (!Number.isFinite(redlineRpm) || redlineRpm <= 0) return null
  if (!Array.isArray(points) || points.length < MIN_CURVE_POINTS) return null
  for (const p of points) {
    if (!Number.isFinite(p.rpm) || p.rpm <= 0 || !Number.isFinite(p.torqueNm) || p.torqueNm <= 0) return null
  }
  for (let i = 1; i < points.length; i++) {
    if (!(points[i].rpm > points[i - 1].rpm)) return null
  }
  return { kind: 'curve', points: points.map((p) => ({ rpm: p.rpm, torqueNm: p.torqueNm })), redlineRpm }
}

/**
 * Validate and construct an {@link EngineTwoPointProfile}. Requires
 * `0 < peakTorqueRpm < peakPowerRpm <= redlineRpm` (peak power conventionally
 * arrives above peak torque as torque falls off faster than rpm rises — see
 * {@link peakPowerRpm}'s doc for the curve-mode analogue) and any supplied
 * optional peak values to be finite and positive. Returns `null` on failure.
 */
export function createEngineTwoPointProfile(input: {
  peakTorqueRpm: number
  peakPowerRpm: number
  redlineRpm: number
  peakTorqueNm?: number
  peakPowerKw?: number
}): EngineTwoPointProfile | null {
  const { peakTorqueRpm, peakPowerRpm: peakPower, redlineRpm, peakTorqueNm, peakPowerKw } = input
  if (!Number.isFinite(peakTorqueRpm) || peakTorqueRpm <= 0) return null
  if (!Number.isFinite(peakPower) || peakPower <= 0) return null
  if (!Number.isFinite(redlineRpm) || redlineRpm <= 0) return null
  if (!(peakTorqueRpm < peakPower) || !(peakPower <= redlineRpm)) return null
  if (peakTorqueNm != null && (!Number.isFinite(peakTorqueNm) || peakTorqueNm <= 0)) return null
  if (peakPowerKw != null && (!Number.isFinite(peakPowerKw) || peakPowerKw <= 0)) return null
  return {
    kind: 'twoPoint',
    peakTorqueRpm,
    peakPowerRpm: peakPower,
    redlineRpm,
    ...(peakTorqueNm != null ? { peakTorqueNm } : {}),
    ...(peakPowerKw != null ? { peakPowerKw } : {}),
  }
}

// ── Curve-only derivations ──────────────────────────────────────────────

/**
 * Torque at an arbitrary rpm: linear interpolation between the two bracketing
 * curve points, CLAMPED (not extrapolated) outside `[points[0].rpm,
 * points[last].rpm]` — see module header's interpolation policy. Returns NaN
 * if the profile has no points (should not happen for a profile constructed
 * via {@link createEngineCurveProfile}).
 */
export function torqueAt(profile: EngineCurveProfile, rpm: number): number {
  const pts = profile.points
  if (pts.length === 0 || !Number.isFinite(rpm)) return NaN
  if (rpm <= pts[0].rpm) return pts[0].torqueNm
  const last = pts[pts.length - 1]
  if (rpm >= last.rpm) return last.torqueNm
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (rpm >= a.rpm && rpm <= b.rpm) {
      const t = (rpm - a.rpm) / (b.rpm - a.rpm)
      return a.torqueNm + t * (b.torqueNm - a.torqueNm)
    }
  }
  return NaN
}

/** Power (kW) at an arbitrary rpm — {@link torqueAt} fed through {@link powerKwFromTorqueNm}. */
export function powerKwAt(profile: EngineCurveProfile, rpm: number): number {
  return powerKwFromTorqueNm(torqueAt(profile, rpm), rpm)
}

/**
 * The rpm of the curve's maximum-torque sample. Because torque is piecewise
 * LINEAR between samples, its maximum over the whole domain always occurs at
 * one of the sample points themselves (a line segment's max is always at an
 * endpoint) — no interior search is needed, unlike {@link peakPowerRpm}.
 */
export function peakTorqueRpm(profile: EngineCurveProfile): number {
  const pts = profile.points
  if (pts.length === 0) return NaN
  let best = pts[0]
  for (const p of pts) if (p.torqueNm > best.torqueNm) best = p
  return best.rpm
}

/**
 * The rpm of the curve's maximum power point. UNLIKE torque, power
 * `P(r) = T(r)*r/9549.3` is piecewise QUADRATIC (torque is linear in each
 * segment, and multiplying a linear function by `r` makes it quadratic), so
 * its maximum can fall STRICTLY INSIDE a segment, not just at a sample point
 * — this is exactly why real engines' peak-power rpm sits somewhere between
 * two dyno samples, past peak torque, rather than landing on a sample.
 *
 * For each segment `T(r) = a + b*r` (b = the segment's torque slope), power
 * is proportional to `a*r + b*r^2`, whose critical point is at
 * `r* = -a / (2*b)`. When `b < 0` (torque falling — the common case just
 * past peak torque) the segment is concave and `r*` is a genuine interior
 * maximum if it falls within the segment; when `b >= 0` the segment is
 * convex (or flat) and its maximum is at an endpoint, already covered by the
 * endpoint scan. This function checks every sample point PLUS every
 * segment's interior critical point (when it lands inside that segment) and
 * returns the highest-power rpm among all candidates.
 */
export function peakPowerRpm(profile: EngineCurveProfile): number {
  const pts = profile.points
  if (pts.length === 0) return NaN
  let bestRpm = pts[0].rpm
  let bestPower = powerKwFromTorqueNm(pts[0].torqueNm, pts[0].rpm)
  for (const p of pts) {
    const power = powerKwFromTorqueNm(p.torqueNm, p.rpm)
    if (Number.isFinite(power) && power > bestPower) {
      bestPower = power
      bestRpm = p.rpm
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const slope = (b.torqueNm - a.torqueNm) / (b.rpm - a.rpm)
    if (slope >= 0) continue // convex/flat segment: max already at an endpoint
    const intercept = a.torqueNm - slope * a.rpm
    const rStar = -intercept / (2 * slope)
    if (rStar > a.rpm && rStar < b.rpm) {
      const power = powerKwFromTorqueNm(torqueAt(profile, rStar), rStar)
      if (Number.isFinite(power) && power > bestPower) {
        bestPower = power
        bestRpm = rStar
      }
    }
  }
  return bestRpm
}

// ── Stage 2: usable band + ratio spacing ────────────────────────────────

/**
 * The engine's "usable band" for gearing purposes: the rpm window a rider
 * should try to keep the engine within while accelerating hard —
 * `bottomRpm` = peak-torque rpm (below this you're lugging, off the torque
 * peak) and `topRpm` = the rpm you should shift at.
 *
 * v1 sets `topRpm = redlineRpm` for BOTH profile kinds: in two-point mode
 * that's the only edge we have; in curve mode the true optimal shift point
 * depends on the NEXT gear's ratio too (see {@link optimalShiftRpm}), so a
 * single band shared across all gears can only ever be an approximation —
 * refining `topRpm` per-gear from the curve is left as future work (noted
 * here rather than silently done wrong).
 */
export interface UsableBand {
  bottomRpm: number
  topRpm: number
}

/**
 * Derive the usable band from either profile kind — see {@link UsableBand}'s
 * doc for why `topRpm` is `redlineRpm` in both cases for now. Returns `null`
 * if the profile's fields aren't usable (defensive: should not happen for a
 * profile constructed via {@link createEngineCurveProfile} /
 * {@link createEngineTwoPointProfile}).
 */
export function usableBand(profile: EngineProfile): UsableBand | null {
  if (profile.kind === 'curve') {
    const bottomRpm = peakTorqueRpm(profile)
    if (!Number.isFinite(bottomRpm) || !(profile.redlineRpm > bottomRpm)) return null
    return { bottomRpm, topRpm: profile.redlineRpm }
  }
  const bottomRpm = profile.peakTorqueRpm
  if (!Number.isFinite(bottomRpm) || !(profile.redlineRpm > bottomRpm)) return null
  return { bottomRpm, topRpm: profile.redlineRpm }
}

/** Input for {@link recommendRatioSpacing}: exactly one of `topGearRatio` /
 *  `firstGearRatio` must be supplied as the anchor the rest are derived from. */
export interface RatioSpacingInput {
  band: UsableBand
  /** How many gears to produce ratios for (>= 1). */
  gearCount: number
  /** Anchor: the top (last) gear's ratio. Mutually exclusive with `firstGearRatio`. */
  topGearRatio?: number
  /** Anchor: the 1st gear's ratio. Mutually exclusive with `topGearRatio`. */
  firstGearRatio?: number
  /**
   * Widens spacing towards the top gears when > 1 (default 1 = pure
   * geometric progression). Real gearboxes are usually PROGRESSIVE, not
   * purely geometric: lower gears are kept close together for hard
   * acceleration off the line (where every extra bit of wheel torque
   * matters and rpm drop must stay small), while the top 1-2 gears are
   * spaced further apart as an overdrive/cruise ratio, since by then
   * acceleration matters less than covering ground per engine revolution.
   * Implemented by multiplying the base geometric step
   * `k = band.topRpm / band.bottomRpm` by `progressionFactor^i` for the
   * i-th gear-to-gear step counting from 1st gear (i=0 is the 1st->2nd
   * step) — so each successive step widens further, i.e. the spacing
   * between the top two gears is the widest of all.
   */
  progressionFactor?: number
}

/**
 * Recommend a full set of per-gear ratios as a (by default) geometric
 * progression whose step is exactly `band.topRpm / band.bottomRpm`: shifting
 * at `topRpm` and landing at `bottomRpm` in the next gear keeps every shift
 * landing right at the bottom of the usable band (see {@link
 * diagnoseExistingRatios} for the inverse — checking whether an EXISTING
 * spec's shifts land there). `progressionFactor` optionally widens the
 * upper-gear spacing beyond pure geometric — see its doc on {@link
 * RatioSpacingInput}.
 *
 * Returns `null` when: `gearCount < 1`; the band is degenerate
 * (`topRpm <= bottomRpm`); neither or both of `topGearRatio`/`firstGearRatio`
 * are supplied; the supplied anchor isn't a finite positive number; or
 * `progressionFactor` is supplied but < 1 (narrowing the top gears isn't a
 * meaningful "progressive" gearbox and almost certainly indicates a caller
 * bug rather than an intended input).
 */
export function recommendRatioSpacing(input: RatioSpacingInput): number[] | null {
  const { band, gearCount, topGearRatio, firstGearRatio, progressionFactor = 1 } = input
  if (!Number.isInteger(gearCount) || gearCount < 1) return null
  if (!Number.isFinite(band.bottomRpm) || !Number.isFinite(band.topRpm) || !(band.topRpm > band.bottomRpm)) return null
  if (!Number.isFinite(progressionFactor) || progressionFactor < 1) return null
  const hasTop = topGearRatio != null
  const hasFirst = firstGearRatio != null
  if (hasTop === hasFirst) return null // exactly one anchor required
  const anchor = hasTop ? topGearRatio! : firstGearRatio!
  if (!Number.isFinite(anchor) || anchor <= 0) return null

  const k = band.topRpm / band.bottomRpm
  // step(i) = k * progressionFactor^i is the ratio g[i] / g[i+1] (both
  // 0-indexed, gear i = i+1'th gear) — widening with i per the doc above.
  const step = (i: number): number => k * Math.pow(progressionFactor, i)

  const ratios = new Array<number>(gearCount)
  if (gearCount === 1) {
    ratios[0] = anchor
    return ratios
  }
  if (hasFirst) {
    ratios[0] = anchor
    for (let i = 1; i < gearCount; i++) ratios[i] = ratios[i - 1] / step(i - 1)
  } else {
    ratios[gearCount - 1] = anchor
    for (let i = gearCount - 2; i >= 0; i--) ratios[i] = ratios[i + 1] * step(i)
  }
  return ratios
}

/**
 * Per-upshift landing diagnosis for an EXISTING drivetrain spec: for every
 * consecutive gear pair, the engine rpm the shift lands on (assuming
 * constant road speed through the shift, so wheel rpm — not engine rpm — is
 * what's actually continuous) and its signed distance to the usable band's
 * `bottomRpm`. This is the single most actionable diagnostic in this module
 * — it directly answers "when I shift from 3rd to 4th, do I fall out of the
 * powerband, and by how much?" (e.g. 「三檔升四檔掉到 6200 rpm，比扭力峰低 800」).
 *
 * Physics: at the shift instant, wheel rpm is shared across the shift
 * (speed doesn't jump), so `landingRpm = shiftRpm * g_next / g_current`.
 * Only the GEARBOX ratio matters here (not total reduction) because primary
 * reduction and final drive multiply every gear identically and cancel out
 * of the ratio `g_next / g_current` — so this deliberately takes just the
 * gear ratios, not a full {@link resolveFinalDrive}-resolved spec.
 *
 * `shiftRpm` defaults to `band.topRpm` (i.e. assumes the rider always
 * upshifts right at the top of the band / redline); pass an explicit value
 * to diagnose a rider's actual, earlier shift points instead.
 *
 * `gearRatios` entries that don't resolve to a valid positive ratio (see
 * {@link resolveGearRatio}) are skipped, along with the upshift pair(s) that
 * would have referenced them. Returns `[]` for fewer than 2 valid gears or
 * an invalid `shiftRpm`/`band.bottomRpm`.
 */
export interface RatioDiagnosis {
  /** The FROM gear of this upshift (1-based) — e.g. `gear: 3` means the 3rd->4th shift. */
  gear: number
  /** The rpm the shift is assumed to happen at (see `shiftRpm` param doc). */
  shiftRpm: number
  /** Engine rpm immediately after the shift. */
  landingRpm: number
  /** `landingRpm - band.bottomRpm`: negative = landed below the torque peak (bogged down). */
  deltaFromBottomRpm: number
}

export function diagnoseExistingRatios(
  gearRatios: readonly GearRatioInput[],
  band: UsableBand,
  shiftRpm: number = band.topRpm,
): RatioDiagnosis[] {
  if (!Number.isFinite(shiftRpm) || shiftRpm <= 0 || !Number.isFinite(band.bottomRpm)) return []
  const ratios = gearRatios.map((g) => resolveGearRatio(g))
  const out: RatioDiagnosis[] = []
  for (let i = 0; i < ratios.length - 1; i++) {
    const gFrom = ratios[i]
    const gTo = ratios[i + 1]
    if (!(gFrom > 0) || !(gTo > 0)) continue
    const landingRpm = shiftRpm * (gTo / gFrom)
    out.push({ gear: i + 1, shiftRpm, landingRpm, deltaFromBottomRpm: landingRpm - band.bottomRpm })
  }
  return out
}

// ── Stage 3: top-speed / final-drive solving ────────────────────────────

/** Input for {@link finalDriveForTopSpeed}. */
export interface FinalDriveForTopSpeedInput {
  targetTopSpeedKmh: number
  redlineRpm: number
  /** Top (last) gear's ratio (gearbox ratio only, not total reduction). */
  topGearRatio: number
  /** Defaults to 1 (no separate primary stage), matching `drivetrain.ts`'s
   *  `computeMtGearTable` convention. */
  primaryReduction?: number
  wheelCircumferenceMm: number
}

/**
 * Solve for the final-drive ratio that puts the vehicle at `targetTopSpeedKmh`
 * exactly when the engine reaches `redlineRpm` in top gear.
 *
 * Derivation, inverting `drivetrain.ts`'s `computeMtGearTable`/
 * `wheelRpmToSpeedKmh` relationship (totalReduction = primary * topGearRatio
 * * final; wheelRpm = redlineRpm / totalReduction; speed = wheelRpm *
 * circumference-derived constant): solve wheelRpm for the TARGET speed via
 * {@link speedKmhToWheelRpm} (the exact inverse of {@link
 * wheelRpmToSpeedKmh}, so this is algebraically exact, not iterative), then
 * `final = redlineRpm / (primary * topGearRatio * wheelRpmTarget)`.
 *
 * Returns `null` for any non-finite/non-positive input, or if the solved
 * final drive isn't finite/positive.
 */
export function finalDriveForTopSpeed(input: FinalDriveForTopSpeedInput): number | null {
  const { targetTopSpeedKmh, redlineRpm, topGearRatio, wheelCircumferenceMm } = input
  const primary = input.primaryReduction != null && input.primaryReduction > 0 ? input.primaryReduction : 1
  if (
    !(targetTopSpeedKmh > 0) ||
    !(redlineRpm > 0) ||
    !(topGearRatio > 0) ||
    !(wheelCircumferenceMm > 0) ||
    !Number.isFinite(primary)
  ) {
    return null
  }
  const wheelRpmTarget = speedKmhToWheelRpm(targetTopSpeedKmh, wheelCircumferenceMm)
  if (!(wheelRpmTarget > 0)) return null
  const final = redlineRpm / (primary * topGearRatio * wheelRpmTarget)
  return Number.isFinite(final) && final > 0 ? final : null
}

/** One ranked candidate front/rear sprocket combination near a target ratio. */
export interface SprocketCombo {
  frontTeeth: number
  rearTeeth: number
  /** `rearTeeth / frontTeeth`, matching `drivetrain.ts`'s `finalDriveRatio`. */
  ratio: number
  /** `|ratio - target| / target` — smaller is closer to the requested ratio. */
  errorFrac: number
}

export interface SprocketSearchOptions {
  /** Front (countershaft) sprocket teeth range to search, inclusive.
   *  Default `[11, 18]` — the common range for chain-drive motorcycle
   *  countershaft sprockets (smaller is mechanically unusual/fragile,
   *  larger is rare on typical sport/naked bikes). */
  frontTeethRange?: [number, number]
  /** Rear (wheel) sprocket teeth range to search, inclusive. Default
   *  `[35, 52]` — the common range for rear sprockets on the same class of
   *  bike. */
  rearTeethRange?: [number, number]
  /** Maximum number of ranked results to return. Default 5. */
  maxResults?: number
}

/**
 * Rank realistic front/rear sprocket tooth combinations by how closely their
 * ratio (`rearTeeth / frontTeeth`) matches `targetRatio` — for turning a
 * solved final-drive RATIO (e.g. from {@link finalDriveForTopSpeed}) into
 * actually-buyable sprocket sizes. Brute-force search over the (small,
 * bounded) teeth ranges — see {@link SprocketSearchOptions} for the default
 * ranges and their rationale — sorted by `errorFrac` ascending.
 *
 * Returns `[]` for a non-finite/non-positive `targetRatio` or degenerate
 * teeth ranges (min > max, or any bound non-positive).
 */
export function rankSprocketCombos(targetRatio: number, opts: SprocketSearchOptions = {}): SprocketCombo[] {
  const [frontMin, frontMax] = opts.frontTeethRange ?? [11, 18]
  const [rearMin, rearMax] = opts.rearTeethRange ?? [35, 52]
  const maxResults = opts.maxResults ?? 5
  if (!(targetRatio > 0) || !Number.isFinite(targetRatio)) return []
  if (!(frontMin > 0) || !(rearMin > 0) || frontMin > frontMax || rearMin > rearMax) return []

  const combos: SprocketCombo[] = []
  for (let front = frontMin; front <= frontMax; front++) {
    for (let rear = rearMin; rear <= rearMax; rear++) {
      const ratio = rear / front
      combos.push({ frontTeeth: front, rearTeeth: rear, ratio, errorFrac: Math.abs(ratio - targetRatio) / targetRatio })
    }
  }
  combos.sort((a, b) => a.errorFrac - b.errorFrac)
  return combos.slice(0, Math.max(0, maxResults))
}

/** Result of {@link diagnoseTopSpeedGearing}. */
export interface TopSpeedGearingDiagnosis {
  /** Top-gear speed at redline per the entered spec (via `computeMtGearTable`). */
  theoreticalTopSpeedKmh: number
  /** The rider-supplied achieved top speed. */
  achievedTopSpeedKmh: number
  /** `achievedTopSpeedKmh - theoreticalTopSpeedKmh`. */
  deltaKmh: number
  /**
   * 'over-geared': achieved speed falls meaningfully short of the
   * redline-in-top-gear theoretical speed — the gearing is taller than the
   * engine can actually pull to redline, so a numerically LARGER final
   * drive (shorter gearing) would let the engine reach redline (and
   * typically improve real-world acceleration/top speed both).
   * 'matched': achieved is within `toleranceFrac` of theoretical — the
   * spec's redline-in-top-gear prediction lines up with reality.
   * 'under-geared': achieved EXCEEDS theoretical by more than tolerance.
   * Under normal riding this shouldn't happen (redline caps engine rpm, so
   * achieved speed can't exceed the redline-in-top-gear prediction without
   * either over-revving past the entered redline or the entered spec
   * itself being wrong — e.g. wheel circumference too small). Reported
   * honestly as 'under-geared' per the requested tri-state, but the caller
   * should treat it as a prompt to double check the entered spec first.
   */
  gearingVerdict: 'over-geared' | 'matched' | 'under-geared'
}

/**
 * Compare an MT spec's theoretical top-gear-at-redline speed (reusing {@link
 * computeMtGearTable} — no reimplementation) against a rider-supplied
 * ACHIEVED top speed, and classify the gearing — see {@link
 * TopSpeedGearingDiagnosis} for the verdict semantics and their caveats.
 *
 * `toleranceFrac` (default 0.03 = 3%, generous enough to absorb GPS/speedo
 * measurement slop and minor tyre-wear circumference drift while still
 * catching a real gearing mismatch) is the relative band around
 * `theoreticalTopSpeedKmh` that counts as 'matched'.
 *
 * Returns `null` if the spec has no valid top gear (empty
 * `computeMtGearTable` result) or `achievedTopSpeedKmh` isn't finite/positive.
 */
export function diagnoseTopSpeedGearing(
  spec: MtDrivetrainSpec,
  achievedTopSpeedKmh: number,
  toleranceFrac = 0.03,
): TopSpeedGearingDiagnosis | null {
  if (!(achievedTopSpeedKmh > 0) || !Number.isFinite(toleranceFrac) || toleranceFrac < 0) return null
  const table = computeMtGearTable(spec)
  if (table.length === 0) return null
  const topGear = table[table.length - 1]
  const theoreticalTopSpeedKmh = topGear.speedAtRedlineKmh
  if (!(theoreticalTopSpeedKmh > 0)) return null

  const deltaKmh = achievedTopSpeedKmh - theoreticalTopSpeedKmh
  const relDelta = Math.abs(deltaKmh) / theoreticalTopSpeedKmh
  const gearingVerdict: TopSpeedGearingDiagnosis['gearingVerdict'] =
    relDelta <= toleranceFrac ? 'matched' : deltaKmh < 0 ? 'over-geared' : 'under-geared'

  return { theoreticalTopSpeedKmh, achievedTopSpeedKmh, deltaKmh, gearingVerdict }
}

// ── Stage 4 (curve-only): true optimal upshift rpm ──────────────────────

/** Result of {@link optimalShiftRpm}. */
export interface OptimalShiftResult {
  /** The recommended shift rpm. */
  rpm: number
  /**
   * 'crossover': a genuine wheel-torque crossover was found within
   * `[peakPowerRpm, redlineRpm]` — `rpm` is that crossover point.
   * 'redlineClamped': no crossover was found in that window (see {@link
   * optimalShiftRpm}'s doc for what this means physically) — `rpm` is
   * simply `profile.redlineRpm`, i.e. "just take it to redline, staying in
   * gear is never worse before that".
   */
  reason: 'crossover' | 'redlineClamped'
}

/**
 * The TRUE optimal upshift rpm between two adjacent gears, from the actual
 * torque curve — not the band-edge heuristic {@link diagnoseExistingRatios}
 * uses. Requires an {@link EngineCurveProfile} specifically (not the
 * `EngineProfile` union) — see the module header's honesty constraint: this
 * genuinely needs the curve's shape, so a two-point profile is a COMPILE
 * ERROR here, not a silently-wrong approximation.
 *
 * Physics: at engine rpm `r` in the current gear, wheel torque is
 * `T(r) * gearRatioN`. If you instead shift up, road speed is unchanged
 * through the shift (only engine rpm changes, via the ratio step), so the
 * new engine rpm is `r * gearRatioNext / gearRatioN` and the new wheel
 * torque is `T(r * gearRatioNext/gearRatioN) * gearRatioNext`. The optimal
 * shift point r* is where these are EQUAL — below r*, staying in gear gives
 * more wheel torque (more acceleration); above r*, shifting up already
 * gives more. This is found by scanning `diff(r) = wheelTorqueCurrent(r) -
 * wheelTorqueNext(r)` for a sign change (positive -> negative, i.e. "stay
 * wins" flipping to "shift wins") over `[peakPowerRpm(profile),
 * redlineRpm]` — starting the scan at peak power rather than 0 or peak
 * torque because a crossover below peak power (while power is still
 * climbing) is not a realistic "should I shift now" question — and
 * bisecting to convergence once a sign change is confirmed at the window's
 * two ends.
 *
 * When `diff` does NOT go from positive-at-`peakPowerRpm` to
 * non-positive-at-`redlineRpm` (either it's already non-positive at the
 * start of the window, meaning any crossover lies below the window and
 * isn't resolved by this scan, or it stays positive throughout, meaning
 * staying in gear is better everywhere in the window) there is no
 * confirmed crossover to report — the honest answer is "ride it to
 * redline" (`reason: 'redlineClamped'`), never a guessed rpm outside the
 * scanned window.
 *
 * Returns `null` for a non-curve profile reaching this function at runtime
 * (defensive — the type system should already prevent this at compile
 * time), non-positive/out-of-order gear ratios (`gearRatioNext` must be
 * less than `gearRatioN` — an upshift, not a downshift or no-op), or a
 * degenerate `[peakPowerRpm, redlineRpm]` window.
 */
export function optimalShiftRpm(
  profile: EngineCurveProfile,
  gearRatioN: number,
  gearRatioNext: number,
): OptimalShiftResult | null {
  if (profile.kind !== 'curve') return null // defensive; the type system should already prevent this
  if (!(gearRatioN > 0) || !(gearRatioNext > 0) || !(gearRatioNext < gearRatioN)) return null
  const lo = peakPowerRpm(profile)
  const hi = profile.redlineRpm
  if (!Number.isFinite(lo) || !(lo < hi)) return null

  const ratioScale = gearRatioNext / gearRatioN // < 1: engine rpm drops on upshift
  const diff = (r: number): number => {
    const wheelTorqueCurrent = torqueAt(profile, r) * gearRatioN
    const wheelTorqueNext = torqueAt(profile, r * ratioScale) * gearRatioNext
    return wheelTorqueCurrent - wheelTorqueNext
  }

  const diffLo = diff(lo)
  const diffHi = diff(hi)
  if (!(diffLo > 0) || !(diffHi <= 0)) {
    return { rpm: hi, reason: 'redlineClamped' }
  }

  // Bisection for the sign change (diffLo > 0, diffHi <= 0 confirmed above).
  let a = lo
  let b = hi
  let fa = diffLo
  for (let i = 0; i < 60; i++) {
    const mid = (a + b) / 2
    const fm = diff(mid)
    if (fa > 0 === fm > 0) {
      a = mid
      fa = fm
    } else {
      b = mid
    }
  }
  return { rpm: (a + b) / 2, reason: 'crossover' }
}

// ── Stage 5: log-driven target ───────────────────────────────────────────

/**
 * Which gear a rider realistically selects at a given road speed, and
 * whether that gear keeps the engine within the usable band. See {@link
 * recommendForMeasuredSpeeds}'s doc for the scoring-rule rationale this
 * implements: prefer the TALLEST (highest-numbered) gear whose rpm at this
 * speed falls in-band — riders don't rev a low gear just because it's
 * technically in-band when a taller gear is equally in-band and quieter/
 * more efficient — falling back to whichever gear's rpm is CLOSEST to the
 * band when none qualify.
 */
function selectGearForSpeed(
  speedKmh: number,
  totalReductions: readonly number[],
  wheelCircumferenceMm: number,
  band: UsableBand,
): { gearIndex: number; rpm: number; inBand: boolean } | null {
  const wheelRpm = speedKmhToWheelRpm(speedKmh, wheelCircumferenceMm)
  if (!(wheelRpm > 0)) return null
  let best: { gearIndex: number; rpm: number; inBand: boolean; missDistance: number } | null = null
  for (let i = 0; i < totalReductions.length; i++) {
    const reduction = totalReductions[i]
    if (!(reduction > 0)) continue
    const rpm = wheelRpm * reduction
    if (!(rpm > 0)) continue
    const inBand = rpm >= band.bottomRpm && rpm <= band.topRpm
    if (inBand) {
      // Ascending i = ascending gear number here (see the module's spec-
      // input convention), so unconditionally overwriting on every in-band
      // match keeps the TALLEST (highest-index) qualifying gear.
      best = { gearIndex: i, rpm, inBand: true, missDistance: 0 }
    } else if (!best || !best.inBand) {
      const missDistance = rpm < band.bottomRpm ? band.bottomRpm - rpm : rpm - band.topRpm
      if (!best || missDistance < best.missDistance) best = { gearIndex: i, rpm, inBand: false, missDistance }
    }
  }
  return best ? { gearIndex: best.gearIndex, rpm: best.rpm, inBand: best.inBand } : null
}

/** Input for {@link recommendForMeasuredSpeeds}. */
export interface MeasuredSpeedsInput {
  /** Plain road-speed samples (km/h) from the log — the caller extracts
   *  these from a `LogSession`; this module stays pure and never touches
   *  `LogSession` itself. */
  speedSamplesKmh: number[]
  /** Optional corner-EXIT speeds specifically (km/h) — where band occupancy
   *  matters most for lap time, since that's where the rider is asking for
   *  maximum acceleration. */
  cornerExitSpeedsKmh?: number[]
  spec: MtDrivetrainSpec
  band: UsableBand
}

/** Result of {@link recommendForMeasuredSpeeds}. */
export interface MeasuredSpeedsScore {
  /** Fraction (0-1) of `speedSamplesKmh` where the realistically-selected
   *  gear (see {@link selectGearForSpeed}) keeps engine rpm within the band,
   *  using the CURRENT spec's gearing. */
  bandOccupancyFrac: number
  /** Same metric restricted to `cornerExitSpeedsKmh`, or `null` when that
   *  array was omitted/empty. */
  cornerExitBandOccupancyFrac: number | null
  /** The multiplicative scale applied to the current final drive that
   *  maximises band occupancy over the combined sample pool (1 = no change
   *  is already optimal within the searched range). */
  suggestedFinalDriveScale: number
  /** `resolveFinalDrive(spec.finalDrive) * suggestedFinalDriveScale`, or NaN
   *  if the current spec has no resolvable final drive. */
  suggestedFinalDrive: number
  /** Band occupancy achieved by `suggestedFinalDrive`, over the same pool
   *  used to search for it (samples + corner exits combined, when corner
   *  exits were supplied — see the module doc below for why). */
  suggestedBandOccupancyFrac: number
}

/** Final-drive search range as a multiplicative scale on the CURRENT final
 *  drive — 0.6-1.6x covers realistic front/rear sprocket swaps (e.g. -2/+2
 *  teeth on a typical 15/45 setup spans roughly this range) without
 *  wandering into physically silly gearing. */
const FINAL_DRIVE_SEARCH_MIN_SCALE = 0.6
const FINAL_DRIVE_SEARCH_MAX_SCALE = 1.6
/** Scan resolution: 240 steps across the search range above gives ~0.42%
 *  scale resolution — finer than any real sprocket-tooth granularity, so it
 *  won't miss the true optimum for lack of resolution. */
const FINAL_DRIVE_SEARCH_STEPS = 240

/**
 * Score an MT spec's CURRENT gearing against a rider's actually-measured
 * speed distribution, and suggest a final-drive rescale that maximises how
 * often the realistically-selected gear keeps the engine in its usable
 * band.
 *
 * ── Scoring rule (stated explicitly, no unstated magic constants) ────────
 *
 * For every speed sample, {@link selectGearForSpeed} picks the gear a rider
 * would realistically be in: the TALLEST gear whose rpm at that speed falls
 * within `[band.bottomRpm, band.topRpm]`, or — when no gear qualifies — the
 * gear whose rpm is numerically closest to the band (so an over-tall or
 * over-short spec still gets a defined nearest-gear answer instead of an
 * arbitrary one). `bandOccupancyFrac` is simply the fraction of samples
 * where that selected gear DID qualify (was actually in-band). This mirrors
 * how a rider actually rides: they don't rev a lower gear "for style" when
 * a taller one is equally in the meat of the powerband.
 *
 * `cornerExitSpeedsKmh`, when supplied, gets the SAME scoring separately
 * (`cornerExitBandOccupancyFrac`) because corner-exit acceleration is where
 * gearing choice affects lap time the most — every other sample is just
 * "how the engine happens to be loafing at that moment", but a corner exit
 * is specifically a moment the rider is asking for everything the engine
 * has.
 *
 * ── Final-drive suggestion ────────────────────────────────────────────────
 *
 * Holding the gearbox ratios and primary reduction fixed (the practical,
 * cheap adjustment is a front/rear sprocket swap, i.e. final drive only —
 * see {@link rankSprocketCombos} for turning the result into buyable teeth),
 * this brute-force scans a multiplicative scale on the CURRENT final drive
 * over `[0.6, 1.6]` in 240 steps (see the constants above for why that
 * range/resolution) and reports whichever scale maximises band occupancy.
 * The search pool is `speedSamplesKmh` plus `cornerExitSpeedsKmh` (when
 * supplied) POOLED TOGETHER, un-weighted — corner exits already get their
 * own separate diagnostic score above, so folding them into the search pool
 * without double-weighting keeps "what final drive is best overall" honest
 * rather than secretly over-indexing on corners.
 *
 * Returns `null` when: the band is degenerate; the spec resolves to no
 * valid gears (`computeMtGearTable` returns `[]`); or `speedSamplesKmh` has
 * no valid (finite, positive) samples.
 */
export function recommendForMeasuredSpeeds(input: MeasuredSpeedsInput): MeasuredSpeedsScore | null {
  const { speedSamplesKmh, cornerExitSpeedsKmh, spec, band } = input
  if (!Number.isFinite(band.bottomRpm) || !Number.isFinite(band.topRpm) || !(band.topRpm > band.bottomRpm)) return null

  const baseTable = computeMtGearTable(spec)
  if (baseTable.length === 0) return null
  const baseReductions = baseTable.map((r) => r.totalReduction)

  const validSpeeds = speedSamplesKmh.filter((s) => Number.isFinite(s) && s > 0)
  if (validSpeeds.length === 0) return null
  const validCornerExits = (cornerExitSpeedsKmh ?? []).filter((s) => Number.isFinite(s) && s > 0)

  const scoreFor = (reductions: number[], speeds: number[]): number => {
    let inBandCount = 0
    let counted = 0
    for (const s of speeds) {
      const sel = selectGearForSpeed(s, reductions, spec.wheelCircumferenceMm, band)
      if (!sel) continue
      counted++
      if (sel.inBand) inBandCount++
    }
    return counted > 0 ? inBandCount / counted : 0
  }

  const bandOccupancyFrac = scoreFor(baseReductions, validSpeeds)
  const cornerExitBandOccupancyFrac = validCornerExits.length > 0 ? scoreFor(baseReductions, validCornerExits) : null

  const pool = validCornerExits.length > 0 ? [...validSpeeds, ...validCornerExits] : validSpeeds
  const baseFinal = resolveFinalDrive(spec.finalDrive)

  let bestScale = 1
  let bestScore = scoreFor(baseReductions, pool)
  if (Number.isFinite(baseFinal) && baseFinal > 0) {
    for (let i = 0; i <= FINAL_DRIVE_SEARCH_STEPS; i++) {
      const scale =
        FINAL_DRIVE_SEARCH_MIN_SCALE +
        ((FINAL_DRIVE_SEARCH_MAX_SCALE - FINAL_DRIVE_SEARCH_MIN_SCALE) * i) / FINAL_DRIVE_SEARCH_STEPS
      // Scaling the final drive scales every gear's totalReduction equally
      // (primary * gearRatio are unaffected), so this avoids recomputing
      // computeMtGearTable per step.
      const reductions = baseReductions.map((r) => r * scale)
      const score = scoreFor(reductions, pool)
      if (score > bestScore) {
        bestScore = score
        bestScale = scale
      }
    }
  }

  const suggestedFinalDrive = Number.isFinite(baseFinal) && baseFinal > 0 ? baseFinal * bestScale : NaN

  return {
    bandOccupancyFrac,
    cornerExitBandOccupancyFrac,
    suggestedFinalDriveScale: bestScale,
    suggestedFinalDrive,
    suggestedBandOccupancyFrac: bestScore,
  }
}
