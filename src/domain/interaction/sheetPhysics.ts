/**
 * B118(a) — drag-to-dismiss math for CardMenu's mobile bottom sheet.
 *
 * Pure, side-effect-free functions (same "no DOM, no Vue, just math" style as
 * xRangeGesture.ts's pan/zoom clamp and edgeGesture.ts's edge-swipe predicate)
 * so the physics can be unit-tested without a real touchscreen or a live
 * pointer-event stream — CardMenu.vue wires these to actual PointerEvents and
 * does the imperative DOM writes; this module never touches `window`/`document`.
 *
 * B117 UPDATE: this module IS now that shared velocity-sample/rubber-band/
 * projection helper — `useCssGridDashboardDrag.ts` (drag-release spring),
 * `TrackMap.vue` and `UPlotChart.vue` (pan momentum) all import `project()`/
 * `rubberBand()`/`pushSample()` directly from here rather than duplicating
 * them, per B117's explicit instruction in docs/ISSUES.md. The one
 * generalisation B117 needed — velocity sampling over BOTH axes, not just Y
 * (a card drag has X and Y release velocity; CardMenu's sheet only ever
 * needed Y) — was added here as an ADDITIVE change: {@link PointerSample}
 * gained an optional `x` field and {@link estimateVelocity2DPxPerSec} is a
 * new function alongside the original Y-only `estimateVelocityPxPerSec`,
 * which is UNCHANGED and still what CardMenu.vue uses. `pushSample` itself
 * needed no change at all — it only ever looked at `t`, so it already worked
 * for 2D samples unmodified.
 */

/** One (timestamp-ms, position-px) sample of a pointer's vertical position
 *  during a drag — `t` should come from `performance.now()`, `y` from
 *  whatever position measure the caller is tracking velocity for (CardMenu
 *  tracks the sheet's own translateY, already rubber-banded — see
 *  {@link dragTranslateY} — so the estimated velocity naturally slows near
 *  the resisted boundary the same way the visible sheet does). */
export interface PointerSample {
  t: number
  y: number
  /** Horizontal position, px — OPTIONAL (B117 addition): CardMenu's vertical
   *  sheet drag never sets this and {@link estimateVelocityPxPerSec} never
   *  reads it, so every pre-existing call site is unaffected. Only
   *  {@link estimateVelocity2DPxPerSec} (B117's card-drag release velocity,
   *  which needs BOTH axes) reads it. */
  x?: number
}

/** Rolling window used by {@link estimateVelocityPxPerSec}: only samples
 *  within this many ms of the newest one are kept. Bounds memory (a very
 *  long drag doesn't grow the array forever) and, more importantly, keeps
 *  the velocity estimate representative of the FINAL flick rather than
 *  averaged over the whole gesture (a slow drag ending in a fast flick
 *  should read as fast, not diluted by the slow part at the start). */
const DEFAULT_VELOCITY_WINDOW_MS = 100

/**
 * Append `sample` to `samples`, dropping everything older than
 * {@link DEFAULT_VELOCITY_WINDOW_MS} (or `windowMs`) relative to it. Returns
 * a NEW array (matches the rest of this codebase's "state update returns a
 * new value" convention, e.g. sessionSelection.ts) so callers can hold the
 * previous array in a `const` without aliasing bugs.
 */
export function pushSample(
  samples: readonly PointerSample[],
  sample: PointerSample,
  windowMs = DEFAULT_VELOCITY_WINDOW_MS,
): PointerSample[] {
  const cutoff = sample.t - windowMs
  return [...samples.filter((s) => s.t >= cutoff), sample]
}

/**
 * Estimate release velocity (px/s, signed — positive = downward = toward
 * dismissal) from a short window of recent samples. Uses the OLDEST and
 * NEWEST sample in the window (a straight-line secant) rather than a
 * least-squares fit over every sample in between — with only a handful of
 * pointermove samples in a ~100ms window, a secant is both simpler and, in
 * practice, no less accurate than fitting noise. Fewer than 2 samples (or a
 * degenerate zero/negative time span, e.g. duplicate timestamps) can't
 * produce a velocity — returns 0, which reads downstream as "no flick,
 * decide on position alone".
 */
export function estimateVelocityPxPerSec(samples: readonly PointerSample[]): number {
  if (samples.length < 2) return 0
  const first = samples[0]
  const last = samples[samples.length - 1]
  const dtMs = last.t - first.t
  if (!(dtMs > 0)) return 0
  return ((last.y - first.y) / dtMs) * 1000
}

/**
 * B117 — two-axis sibling of {@link estimateVelocityPxPerSec}, for gestures
 * that carry momentum on BOTH axes at once (a dragged dashboard card, a
 * panned map/chart) rather than CardMenu's vertical-only sheet. Same secant-
 * over-the-window approach, just applied to `x` and `y` independently from
 * the SAME pair of samples (one shared time window, not two separately-
 * windowed 1D estimates) so a diagonal flick's X and Y velocities are
 * measured over identical, consistent start/end samples. A sample missing
 * `x` (shouldn't happen for a caller that actually wants 2D velocity, but
 * guards the same way the rest of this module treats malformed input) reads
 * as `x: 0` rather than `NaN` propagating through the whole result.
 */
export function estimateVelocity2DPxPerSec(samples: readonly PointerSample[]): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 }
  const first = samples[0]
  const last = samples[samples.length - 1]
  const dtMs = last.t - first.t
  if (!(dtMs > 0)) return { vx: 0, vy: 0 }
  const vx = (((last.x ?? 0) - (first.x ?? 0)) / dtMs) * 1000
  const vy = ((last.y - first.y) / dtMs) * 1000
  return { vx, vy }
}

/**
 * WebKit's rubber-band formula (the same curve behind `UIScrollView`'s
 * over-scroll resistance): as `overshootPx` grows, the returned distance
 * keeps growing but ever more slowly, asymptotically approaching `dimPx`
 * (never quite reaching it, however far the finger travels) rather than
 * passing straight through — "it gets harder to pull, not impossible",
 * which is what makes a rubber-banded drag feel like a physical resistance
 * instead of a hard stop (B117 flags the app's existing hard stops —
 * `xRangeGesture.clampRange`, TrackMap's zoom clamp — as reading "like it
 * crashed"; this is the fix for THIS surface, applied independently of that
 * branch, see this module's top doc). `coefficient` shapes how QUICKLY it
 * approaches that asymptote (higher = looser, reaches near-`dimPx` sooner)
 * — it does not change what the asymptote itself is.
 *
 * `overshootPx` is expected non-negative (the caller separates "which
 * direction" from "how far past the limit"); `dimPx` is normally the sheet's
 * own rendered height, so the resistance scales with the sheet's size rather
 * than a fixed pixel budget that would feel wrong on a small vs. tall sheet.
 */
export function rubberBand(overshootPx: number, dimPx: number, coefficient = 0.55): number {
  if (!(overshootPx > 0)) return 0
  if (!(dimPx > 0)) return overshootPx
  return (coefficient * overshootPx * dimPx) / (dimPx + coefficient * overshootPx)
}

/**
 * Turn a raw, UNRESISTED candidate translateY (how far the pointer has
 * dragged the sheet from its resting position, `0` = rest, positive = down)
 * into the value actually applied to the sheet's `transform`. Downward drag
 * (`raw >= 0`, moving toward dismissal) tracks the finger 1:1 — no
 * resistance in the direction the gesture is "supposed" to go. Upward drag
 * (`raw < 0`, past the resting position, nothing left to reveal above it)
 * is resisted via {@link rubberBand} against the sheet's own height, so it
 * creeps rather than following 1:1 — mirrors iOS over-scroll at the top of
 * a list.
 */
export function dragTranslateY(rawTranslateYPx: number, sheetHeightPx: number, coefficient = 0.55): number {
  if (rawTranslateYPx >= 0) return rawTranslateYPx
  return -rubberBand(-rawTranslateYPx, sheetHeightPx, coefficient)
}

/**
 * Project where a thrown value with velocity `v` (px/s) will eventually
 * settle under exponential decay (deceleration proportional to remaining
 * speed — the standard "flick" deceleration model iOS scrolling uses, decay
 * `0.998` ≈ the constant Apple's own `UIScrollView` documentation and
 * multiple reverse-engineering write-ups cite for its deceleration curve).
 * Returns a PIXEL offset (not a velocity) — how much farther the gesture
 * would travel if released right now and allowed to coast to a stop.
 *
 * Derivation: velocity at time t (ms) is `v(t) = v0 * decay^t`. Total
 * distance is the integral `∫v(t)dt` from 0 to ∞, which is a geometric
 * series that sums to `v0 / (1000 * -ln(decay))`... this codebase (and the
 * task spec this was written against) uses the simpler discrete-step
 * closed form `(v/1000) * decay / (1 - decay)` instead of the continuous
 * `-1/ln(decay)` form — both converge to nearly the same number for
 * `decay` this close to 1 (< 0.1% apart at 0.998), and the discrete form is
 * the one actually specified, so it's the one implemented here rather than
 * a "more correct" continuous derivation that would silently change the
 * dismiss threshold's calibration.
 */
export function project(velocityPxPerSec: number, decay = 0.998): number {
  return ((velocityPxPerSec / 1000) * decay) / (1 - decay)
}

/**
 * B117 stage 3 — the CUMULATIVE glide distance travelled `elapsedMs` after
 * release, under the exact same discrete exponential-decay model
 * {@link project} already implements — this is a live, drivable-by-rAF
 * ANIMATION built on top of that "where does it eventually stop" projection,
 * for TrackMap.vue's pan-release glide and UPlotChart.vue's touch-pan-release
 * glide (B117's stage-3 requirement: "use the existing project() for the
 * glide target").
 *
 * Derivation: distance travelled from release (t=0ms) to time t is the
 * PARTIAL sum {@link project} takes all the way to infinity — using the same
 * `v(t) = v0 * decay^t` per-ms velocity {@link project}'s own doc derives:
 *
 *   traveled(t) = sum_{i=1}^{t} v0*decay^i / 1000
 *               = (v0/1000) * decay * (1 - decay^t) / (1 - decay)
 *               = project(v0, decay) * (1 - decay^t)
 *
 * — an EXACT closed form, not a numerically-integrated approximation: no
 * per-frame accumulation error regardless of how irregular real rAF frame
 * timing is (a dropped frame just means the next call passes a larger
 * `elapsedMs`, landing on the exact same curve rather than "catching up"
 * through however many intermediate steps were skipped). It also trivially
 * satisfies "reduces to `project()` itself as t -> infinity" by construction
 * (`decay^t -> 0`), so a caller checking "has this glide effectively
 * finished" can compare `traveled` against `project(v0, decay)` directly
 * instead of tracking velocity decay separately.
 *
 * A caller drives this by recording `t0 = performance.now()` at release and
 * calling `momentumOffsetAt(v0, now() - t0)` each animation frame, adding
 * the result to the value's position AT RELEASE (not accumulating a running
 * delta) — see TrackMap.vue's/UPlotChart.vue's own glide loops.
 */
export function momentumOffsetAt(velocityPxPerSec: number, elapsedMs: number, decay = 0.998): number {
  if (!(elapsedMs > 0)) return 0
  return project(velocityPxPerSec, decay) * (1 - decay ** elapsedMs)
}

export interface DismissDecisionParams {
  /** Sheet's translateY at release, in px (0 = resting, positive = dragged
   *  toward dismissal). Should be the RESISTED value actually on screen
   *  (see {@link dragTranslateY}), not the raw unresisted drag distance —
   *  a drag that spent itself fighting rubber-band resistance genuinely
   *  travelled less than the raw finger movement, and the dismiss decision
   *  should see that. */
  releaseOffsetPx: number
  /** Signed velocity at release (px/s, positive = downward), from
   *  {@link estimateVelocityPxPerSec}. */
  velocityPxPerSec: number
  /** The sheet's own rendered height — both the projection target and the
   *  rubber-band scale share this so "dismiss" means "roughly the same
   *  thing" regardless of how tall the sheet's content made it. */
  sheetHeightPx: number
  /** Fraction of `sheetHeightPx` the PROJECTED landing point must clear to
   *  dismiss. Default 0.5 — "if this throw's momentum would carry it past
   *  the halfway point, let it go" (mirrors iOS sheet/card dismiss
   *  thresholds). */
  dismissFraction?: number
  /** A velocity at/above this magnitude dismisses regardless of where the
   *  release happened, even a release still near the top — "clearly a
   *  downward flick" should never require the sheet to already be halfway
   *  down first. 700px/s is a brisk-but-not-extreme flick. */
  flickVelocityPxPerSec?: number
}

/**
 * The dismiss/return decision itself: project the release's momentum
 * forward (see {@link project}) and check whether the PROJECTED landing
 * point — not the raw release position — clears the dismiss threshold, OR
 * whether the release velocity alone was a clear enough downward flick to
 * dismiss outright. Everything else springs back to rest.
 *
 * Using the projection rather than the bare release position is what makes
 * a fast downward flick from near the TOP of the sheet still dismiss it
 * (B118's spec) — a naive "did you release past the halfway point" check
 * would miss exactly that case, the most common real-world dismiss gesture.
 */
export function shouldDismissSheet(params: DismissDecisionParams): boolean {
  const { releaseOffsetPx, velocityPxPerSec, sheetHeightPx } = params
  const dismissFraction = params.dismissFraction ?? 0.5
  const flickVelocityPxPerSec = params.flickVelocityPxPerSec ?? 700
  if (velocityPxPerSec >= flickVelocityPxPerSec) return true
  if (!(sheetHeightPx > 0)) return releaseOffsetPx > 0
  const projected = releaseOffsetPx + project(velocityPxPerSec)
  return projected > sheetHeightPx * dismissFraction
}

/**
 * Read the `translateY` component out of a computed `transform` string
 * (`getComputedStyle(el).transform`, or the value CardMenu itself last
 * wrote) — used to freeze a sheet's CURRENT on-screen position when a new
 * drag grabs it mid-animation (interruption support, B118's "grabbing a
 * sheet that is mid-animation must pick it up from its current on-screen
 * position"). Only ever needs to understand `matrix(...)` (2D, what a plain
 * `translateY()` compiles to) and `matrix3d(...)` (some browsers report 3D
 * matrices even for a 2D-only transform) — CardMenu never applies anything
 * beyond a single Y translation to the sheet, so those two forms are the
 * only ones this needs to parse. `'none'`/anything unrecognised reads as 0
 * (== resting position), which is the correct fallback either way (no
 * transform applied == no offset from rest).
 */
export function parseTranslateY(transformCss: string): number {
  const matrix2d = /^matrix\(([^)]+)\)$/.exec(transformCss.trim())
  if (matrix2d) {
    const parts = matrix2d[1].split(',').map((n) => Number.parseFloat(n))
    return parts[5] ?? 0
  }
  const matrix3d = /^matrix3d\(([^)]+)\)$/.exec(transformCss.trim())
  if (matrix3d) {
    const parts = matrix3d[1].split(',').map((n) => Number.parseFloat(n))
    return parts[13] ?? 0
  }
  return 0
}
