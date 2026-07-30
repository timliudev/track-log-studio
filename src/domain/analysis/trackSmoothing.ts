/**
 * ⑥ (second half) — geometric smoothing of the DRAWN track line, via
 * centripetal Catmull-Rom spline resampling of already-projected screen
 * points. Sibling of `playback.ts`'s `interpolateSample` (⑤/⑥ marker glide —
 * DO NOT confuse the two): that module makes the CURSOR MARKER glide between
 * two real samples; this one makes the STROKED POLYLINE itself read as a
 * smooth curve instead of the visibly polygonal chords a 10Hz GPS trace
 * produces. Purely a rendering concern — the underlying samples, indices,
 * lap boundaries, and hit-testing are never touched; see TrackMap.vue's own
 * wiring notes for how the two stay separated.
 *
 * ## The user-facing "amount" knob
 *
 * `amount` is a plain number in `[0, 1]`, matching `settingsStore`'s
 * `trackLineSmoothing` preference: `0` = "忠實呈現" (faithful — the exact
 * recorded chords, byte-for-byte passthrough, see below), `1` = "平順"
 * (smoothest this module offers). Values outside `[0, 1]` are clamped;
 * non-finite values are treated as `0`.
 *
 * ## amount -> subdivision mapping
 *
 * Each ORIGINAL edge (the straight chord between two consecutive samples)
 * is replaced by `segmentsForAmount(amount)` shorter chords sampled off the
 * Catmull-Rom curve — i.e. `amount` controls how many extra points are
 * inserted per edge, not the curve's tension (tension is fixed at the
 * centripetal value, alpha = 0.5, which is the standard choice for avoiding
 * self-intersections/cusps on the kind of uneven, occasionally-doubled-back
 * point spacing a real GPS trace has — see Yuksel et al., "On the Parameterization
 * of Catmull-Rom Curves"). `amount <= 0` yields exactly 1 segment per edge —
 * i.e. no subdivision at all — but that path is never reached: it's
 * special-cased to a zero-cost passthrough (see below) instead, since the
 * spline math would reduce to the original chord anyway (just computed the
 * expensive way). Any `amount > 0` maps to at least 2 segments/edge (a
 * single evaluated midpoint already visibly rounds a corner), scaling up to
 * `MAX_SEGMENTS_PER_SPAN` (8) at `amount === 1`.
 *
 * ## The "0 = faithful" passthrough contract
 *
 * `amount <= 0` (the default) returns the INPUT arrays' own `Float64Array
 * .subarray()` views — zero allocation, zero floating-point re-derivation,
 * bit-identical to the original samples. This is deliberate: "忠實呈現"
 * must mean exactly that, not "a very light spline that happens to sit very
 * close to the original points," and it must cost nothing extra on the hot
 * "smoothing is off" path every existing installation is on by default.
 *
 * ## NaN gaps
 *
 * A `NaN` entry in the input `px`/`py` marks a missing GPS fix — the
 * existing canvas stroking code (`drawPlainSegment` et al. in TrackMap.vue)
 * breaks the polyline there rather than drawing a bogus connector across the
 * gap. This module preserves that contract exactly: the requested index
 * range is split into maximal NaN-free "runs" first, each run is splined
 * INDEPENDENTLY (a curve never reaches across a gap or "sees" the points on
 * the other side of one), and the output re-inserts a single `NaN` marker
 * between consecutive runs — so every existing caller of `drawPlainSegment`
 * can consume the smoothed output exactly like the original arrays, no
 * special-casing needed downstream.
 *
 * ## Subdivision cap
 *
 * Regardless of `amount`, no single run's output ever exceeds
 * `MAX_RUN_OUTPUT_POINTS` (20,000) points: for a very long uninterrupted run
 * (a multi-hour session with a rock-solid GPS fix throughout), the effective
 * segments-per-edge is reduced (down to 1, i.e. no-op) so the point count
 * can never explode past that ceiling. A typical session (tens of minutes at
 * 10 Hz, so low tens of thousands of samples) never approaches this at the
 * default subdivision cap; only exceptionally long, gap-free recordings
 * combined with the maximum smoothing amount would engage the reduction, and
 * even then it degrades gracefully (less subdivision, not an error).
 *
 * ## Endpoint duplication
 *
 * Catmull-Rom needs a point on EITHER side of the two points an edge spans
 * (4 control points per edge: the point before, the edge's own two points,
 * and the point after). At a run's own first/last edge there's no such
 * neighbour — the standard fix (used here) duplicates the nearest real
 * endpoint as the phantom one, which is what makes the curve pass exactly
 * through the run's own first and last points rather than overshooting past
 * them.
 */

/** Centripetal parameterization exponent (Yuksel et al.) — avoids cusps/
 *  self-intersections that the uniform (alpha=0) or chordal (alpha=1)
 *  variants can produce on unevenly-spaced points, which a real GPS trace
 *  (near-stationary at a hairpin, fast on a straight) always has. */
const ALPHA = 0.5

/** Extra chords per original edge at `amount === 1`. Any `amount > 0` maps
 *  to at least 2 (see module doc) up to this. */
export const MAX_SEGMENTS_PER_SPAN = 8

/** Hard ceiling on one NaN-free run's smoothed output length — see the
 *  module doc's "Subdivision cap" section. */
export const MAX_RUN_OUTPUT_POINTS = 20000

/** Guards the Catmull-Rom knot-interval divisions below against a
 *  zero-length span (two coincident samples — not unusual in real GPS data
 *  at a dead stop) producing a divide-by-zero/NaN. */
const MIN_KNOT_SPACING = 1e-9

/** Clamp a possibly-garbage `amount` (external/persisted input) into the
 *  valid `[0, 1]` range; non-finite collapses to `0` (the faithful default). */
function clampAmount(amount: number): number {
  return Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0
}

/** amount (0..1] -> extra chords per original edge. Only called once
 *  `amount > 0` has already been established by the caller. */
function segmentsForAmount(amount: number): number {
  return Math.max(2, Math.round(amount * MAX_SEGMENTS_PER_SPAN))
}

/** One point on the centripetal Catmull-Rom curve through control points
 *  p0..p3 (p1 -> p2 is the span being interpolated), at local parameter
 *  `t` in `[0, 1]` (`t=0` -> exactly p1, `t=1` -> exactly p2). Standard
 *  formulation: centripetal knot spacing (`ALPHA`) + the two-stage linear
 *  blend (De Casteljau-style) that reduces to it. */
function catmullRomPoint(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
  t: number,
): { x: number; y: number } {
  const d01 = Math.max(Math.hypot(p1x - p0x, p1y - p0y), MIN_KNOT_SPACING)
  const d12 = Math.max(Math.hypot(p2x - p1x, p2y - p1y), MIN_KNOT_SPACING)
  const d23 = Math.max(Math.hypot(p3x - p2x, p3y - p2y), MIN_KNOT_SPACING)

  const t0 = 0
  const t1 = t0 + d01 ** ALPHA
  const t2 = t1 + d12 ** ALPHA
  const t3 = t2 + d23 ** ALPHA
  const tt = t1 + t * (t2 - t1)

  const a1x = ((t1 - tt) / (t1 - t0)) * p0x + ((tt - t0) / (t1 - t0)) * p1x
  const a1y = ((t1 - tt) / (t1 - t0)) * p0y + ((tt - t0) / (t1 - t0)) * p1y
  const a2x = ((t2 - tt) / (t2 - t1)) * p1x + ((tt - t1) / (t2 - t1)) * p2x
  const a2y = ((t2 - tt) / (t2 - t1)) * p1y + ((tt - t1) / (t2 - t1)) * p2y
  const a3x = ((t3 - tt) / (t3 - t2)) * p2x + ((tt - t2) / (t3 - t2)) * p3x
  const a3y = ((t3 - tt) / (t3 - t2)) * p2y + ((tt - t2) / (t3 - t2)) * p3y

  const b1x = ((t2 - tt) / (t2 - t0)) * a1x + ((tt - t0) / (t2 - t0)) * a2x
  const b1y = ((t2 - tt) / (t2 - t0)) * a1y + ((tt - t0) / (t2 - t0)) * a2y
  const b2x = ((t3 - tt) / (t3 - t1)) * a2x + ((tt - t1) / (t3 - t1)) * a3x
  const b2y = ((t3 - tt) / (t3 - t1)) * a2y + ((tt - t1) / (t3 - t1)) * a3y

  return {
    x: ((t2 - tt) / (t2 - t1)) * b1x + ((tt - t1) / (t2 - t1)) * b2x,
    y: ((t2 - tt) / (t2 - t1)) * b1y + ((tt - t1) / (t2 - t1)) * b2y,
  }
}

/**
 * Smooth ONE contiguous, NaN-free run of points (`xs`/`ys`, same length).
 * `amount` is assumed already validated/clamped and `> 0` (the `<= 0` and
 * `length < 3` "nothing to do" cases are short-circuited by the caller,
 * {@link smoothTrackRange}, so this always either has real spline work to do
 * or is never called).
 *
 * Endpoint duplication (see module doc): the phantom point before the run's
 * first sample and after its last sample is that same first/last sample —
 * this is what makes the curve pass exactly through them rather than
 * overshooting.
 */
function smoothRun(xs: Float64Array, ys: Float64Array, amount: number): { x: Float64Array; y: Float64Array } {
  const m = xs.length
  const spans = m - 1
  let segments = segmentsForAmount(amount)
  // Subdivision cap (module doc): shrink segments/span, never below 1 (=
  // no-op — degrades to the original chord for that run), so total output
  // length never exceeds MAX_RUN_OUTPUT_POINTS regardless of run length.
  if (spans * segments + 1 > MAX_RUN_OUTPUT_POINTS) {
    segments = Math.max(1, Math.floor((MAX_RUN_OUTPUT_POINTS - 1) / spans))
  }
  if (segments <= 1) return { x: xs, y: ys }

  const outLen = spans * segments + 1
  const ox = new Float64Array(outLen)
  const oy = new Float64Array(outLen)
  let w = 0
  for (let i = 0; i < spans; i++) {
    const p0i = i === 0 ? 0 : i - 1
    const p3i = i + 2 < m ? i + 2 : m - 1
    const p0x = xs[p0i], p0y = ys[p0i]
    const p1x = xs[i], p1y = ys[i]
    const p2x = xs[i + 1], p2y = ys[i + 1]
    const p3x = xs[p3i], p3y = ys[p3i]
    // t=1 (exactly p2) is deliberately never evaluated here — it's identical
    // to the NEXT span's t=0 (or, for the very last span, appended once
    // below) so the shared boundary point is written exactly once.
    for (let s = 0; s < segments; s++) {
      const t = s / segments
      const p = catmullRomPoint(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t)
      ox[w] = p.x
      oy[w] = p.y
      w++
    }
  }
  ox[w] = xs[m - 1]
  oy[w] = ys[m - 1]
  return { x: ox, y: oy }
}

/**
 * Smooth the polyline over projected-pixel index range `[lo, hi]` (inclusive,
 * same convention as TrackMap.vue's `drawPlainSegment`), preserving NaN gap
 * breaks. This is the module's one exported entry point — see the module doc
 * above for the full contract (amount mapping, the amount<=0 passthrough,
 * NaN handling, the subdivision cap, endpoint duplication).
 *
 * The output is always drawable exactly the way the input was: iterate
 * `[0, result.x.length - 1]`, `moveTo`/`lineTo` on non-NaN runs, break on
 * NaN — i.e. it's a drop-in replacement for the `(px, py, lo, hi)` arguments
 * `drawPlainSegment` already takes (pass `0, result.x.length - 1` as its own
 * lo/hi).
 */
export function smoothTrackRange(
  px: Float64Array,
  py: Float64Array,
  lo: number,
  hi: number,
  amount: number,
): { x: Float64Array; y: Float64Array } {
  const clamped = clampAmount(amount)
  if (clamped <= 0 || hi < lo) {
    // The "忠實呈現" cheap path — a zero-copy view onto the caller's own
    // buffers, bit-identical to the un-smoothed original.
    return { x: px.subarray(lo, hi + 1), y: py.subarray(lo, hi + 1) }
  }

  const outX: number[] = []
  const outY: number[] = []
  let anyRunYet = false
  let i = lo
  while (i <= hi) {
    if (Number.isNaN(px[i])) {
      i++
      continue
    }
    let j = i
    while (j <= hi && !Number.isNaN(px[j])) j++
    // Run is [i, j - 1], length j - i.
    if (anyRunYet) {
      outX.push(NaN)
      outY.push(NaN)
    }
    const runLen = j - i
    if (runLen < 3) {
      // Nothing to spline through (module doc's "short runs" case) — the
      // 1-2 point run is copied through unchanged, same NaN-preserving
      // contract as a smoothed run.
      for (let k = i; k < j; k++) {
        outX.push(px[k])
        outY.push(py[k])
      }
    } else {
      const rx = px.subarray(i, j)
      const ry = py.subarray(i, j)
      const sm = smoothRun(rx, ry, clamped)
      for (let k = 0; k < sm.x.length; k++) {
        outX.push(sm.x[k])
        outY.push(sm.y[k])
      }
    }
    anyRunYet = true
    i = j
  }
  return { x: Float64Array.from(outX), y: Float64Array.from(outY) }
}
