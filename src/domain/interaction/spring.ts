/**
 * B117 — a general-purpose critically/under/over-damped spring integrator,
 * parameterised the way Apple's own APIs expose spring motion (SwiftUI's
 * `Animation.spring(response:dampingFraction:)`, UIKit's `UISpringTimingParameters`)
 * rather than the textbook physics-class knobs (mass/stiffness/damping) —
 * `response` (seconds) is roughly "how long the spring takes to first reach
 * the target", `dampingRatio` is the familiar 0 (undamped, oscillates
 * forever) .. 1 (critically damped, no overshoot) .. >1 (overdamped,
 * sluggish) control most engineers already have intuition for from other
 * physical-motion contexts. Converting to the underlying stiffness/damping
 * coefficients (assuming unit mass, which is the standard simplification —
 * only the RATIOS between stiffness/damping/mass matter for the shape of the
 * motion, not their absolute values) is a one-line formula done once inside
 * {@link springStep} rather than asking every call site to reason about
 * stiffness in "px per px of displacement" units it has no intuition for.
 *
 * Pure, side-effect-free, no DOM/Vue — same "math lives in src/domain,
 * rAF/pointer-event wiring lives in the composable" split every other piece
 * of gesture math in this codebase already follows (sheetPhysics.ts,
 * xRangeGesture.ts, cssGridDrag.ts, edgeGesture.ts). Two independent
 * `SpringState`s (one per axis) is the caller's job — see
 * useCssGridDashboardDrag.ts's drag-release settle for why a single 2D
 * spring over distance would desync X and Y when their release velocities
 * differ (a diagonal flick that's mostly-horizontal would have its Y axis
 * "dragged along" by the combined magnitude instead of settling on its own,
 * much shorter, timeline).
 */

/** One axis's spring state: its current offset from equilibrium (whatever
 *  unit the caller is animating in — px, for every current use) and its
 *  current rate of change of that offset (same unit per SECOND, despite this
 *  codebase's `dtMs`-flavoured timestamps elsewhere — see {@link springStep}'s
 *  own `dtSec` parameter for why: keeping the integration itself in SI
 *  seconds keeps the stiffness/damping formulas free of stray 1000×/1000÷
 *  scale factors that `dtMs` would otherwise smuggle into every term). */
export interface SpringState {
  position: number
  velocity: number
}

/** Apple-style spring tuning — see this module's own doc for why these two
 *  numbers instead of raw stiffness/damping/mass. */
export interface SpringParams {
  /** 1 = critically damped (approaches the target as fast as possible with
   *  NO overshoot); <1 = underdamped (overshoots then settles, "bouncier");
   *  >1 = overdamped (never overshoots, but slower than critical). */
  dampingRatio: number
  /** Seconds — informally, how long the spring takes to substantially reach
   *  the target for the first time; smaller = snappier/stiffer. */
  responseSec: number
}

/** Drag-release settle (B117 stage 1, `useCssGridDashboardDrag.ts`): the
 *  gesture that's settling already carried real momentum (the user's finger
 *  was moving at release, not stationary), so a touch of overshoot before
 *  settling reads as "the card has weight and is still finishing its
 *  motion" rather than "the card teleported" — the exact complaint B117
 *  filed against the old instant-snap behaviour. `dampingRatio: 0.8` is
 *  deliberately NOT critically damped for that reason. ⚠️ Needs real-device
 *  tuning — these two numbers were chosen from Apple's own published
 *  guidance for "snappy but weighted" UI springs, not measured against this
 *  app's actual card sizes/frame budget on a real touchscreen. */
export const SPRING_DRAG_RELEASE: SpringParams = { dampingRatio: 0.8, responseSec: 0.3 }

/** Default for callers with no momentum to preserve (e.g. a programmatic
 *  "snap to this value" with no release velocity behind it) — critically
 *  damped so it never overshoots a target the caller didn't intend to pass.
 *  Same `responseSec` as {@link SPRING_DRAG_RELEASE} so the two only differ
 *  in bounciness, not overall speed; also unverified on a real device. */
export const SPRING_DEFAULT: SpringParams = { dampingRatio: 1.0, responseSec: 0.3 }

/** Longest single step this integrator is asked to trust, in seconds — a
 *  backgrounded tab / a dropped frame can hand back a `dtSec` far larger
 *  than a real 60Hz frame, and semi-implicit Euler (like any fixed-step
 *  explicit integrator) can become numerically unstable — visibly
 *  overshoot far past the target, or even diverge — for a large enough
 *  single step. Callers should clamp `dtSec` to this before calling
 *  {@link springStep} (the rAF-driving composables do); kept here as the
 *  one shared constant rather than a magic number re-picked at each call
 *  site. 1/30s ≈ two dropped 60Hz frames' worth — generous enough that a
 *  normal frame is never clamped, tight enough to stay numerically stable
 *  for this spring's stiffness range. */
export const SPRING_MAX_DT_SEC = 1 / 30

/**
 * Advance one axis of spring motion by `dtSec` seconds using semi-implicit
 * (symplectic) Euler integration — velocity is updated from the current
 * acceleration FIRST, then position is updated from the NEW velocity (rather
 * than the naive "both from the old state" explicit Euler), which is both
 * simpler to reason about than RK4 and, critically, unconditionally stable
 * for a damped spring at any dampingRatio >= 0 as long as `dtSec` stays
 * reasonable (see {@link SPRING_MAX_DT_SEC}) — explicit Euler on a spring
 * this stiff can gain energy and oscillate outward instead of settling.
 *
 * `dtSec <= 0` is a no-op (returns `state` unchanged) — a caller computing
 * `dtSec` from two consecutive `performance.now()` reads can hand back 0 on
 * a genuinely duplicate rAF timestamp, and this should never step motion
 * backwards.
 */
export function springStep(state: SpringState, target: number, params: SpringParams, dtSec: number): SpringState {
  if (!(dtSec > 0)) return state
  // Unit-mass stiffness/damping from (dampingRatio, responseSec) — standard
  // conversion for a response/dampingRatio-parameterised spring: angular
  // frequency omega = 2*pi/response (undamped natural frequency), stiffness
  // = omega^2 (F = -k*x with unit mass), damping = 2*dampingRatio*omega
  // (critical damping at dampingRatio=1 is exactly 2*omega for unit mass —
  // the standard "c_critical = 2*sqrt(k*m)" result specialised to m=1,
  // k=omega^2, giving c_critical = 2*omega).
  const angularFreq = (2 * Math.PI) / params.responseSec
  const stiffness = angularFreq * angularFreq
  const damping = 2 * params.dampingRatio * angularFreq
  const displacement = state.position - target
  const acceleration = -stiffness * displacement - damping * state.velocity
  const velocity = state.velocity + acceleration * dtSec
  const position = state.position + velocity * dtSec
  return { position, velocity }
}

/** Default thresholds for {@link isSpringSettled}: below ~1/3 of a CSS px
 *  and a fraction of a px/frame at 60Hz is visually indistinguishable from
 *  rest, so continuing to run rAF frames past this point would just burn
 *  battery for a motion nobody can see. */
const DEFAULT_POSITION_EPSILON = 0.3
const DEFAULT_VELOCITY_EPSILON = 4

/**
 * Whether a spring has settled close enough to `target`, on BOTH position
 * and velocity, to stop animating — a position-only check would call a
 * still-fast-moving spring "settled" the instant it happens to cross the
 * target (which it will, for any underdamped `dampingRatio < 1`), freezing
 * the animation mid-overshoot instead of letting it complete.
 */
export function isSpringSettled(
  state: SpringState,
  target: number,
  positionEpsilon = DEFAULT_POSITION_EPSILON,
  velocityEpsilon = DEFAULT_VELOCITY_EPSILON,
): boolean {
  return Math.abs(state.position - target) < positionEpsilon && Math.abs(state.velocity) < velocityEpsilon
}
