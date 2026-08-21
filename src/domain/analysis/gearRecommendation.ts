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
