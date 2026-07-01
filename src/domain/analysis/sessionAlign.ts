/**
 * Phase 5 — session merge, step 1: time-align a "good GPS" session (e.g. a
 * RaceChrono .nmea) against a "good engine data" session (e.g. a .loga) that
 * has broken/missing GPS. Both sessions record independently (different
 * clocks, different start times), so before any channel can be borrowed from
 * one into the other we need the lag between their clocks.
 *
 * Approach: both sessions still measured the SAME physical vehicle speed
 * during overlapping wall-clock time, so vehicle speed is the shared signal
 * we cross-correlate to recover that lag — resample both speed series onto a
 * common fixed-step time grid, z-score normalize (so amplitude/units
 * differences don't bias the match), then scan candidate lags and keep the
 * one maximizing normalized cross-correlation.
 */

/** Options for {@link crossCorrelateOffset}. */
export interface CrossCorrelateOptions {
  /** Largest lag (ms, either direction) to consider. */
  maxLagMs: number
  /** Lag scan step (ms). Also the resampling grid step. */
  stepMs: number
}

/** Result of a successful alignment search. */
export interface AlignmentResult {
  /**
   * Milliseconds to ADD to `other`'s time axis so it lines up with `ref`'s
   * time axis (i.e. `ref(t) ~= other(t - offsetMs)`... concretely: shifting
   * `other`'s samples forward by `offsetMs` best matches `ref`).
   */
  offsetMs: number
  /** Normalized cross-correlation at the chosen offset, in [-1, 1] (higher = better match). */
  score: number
}

/** Linear-interpolate `data` (indexed by parallel `timeMs`) at time `t`; NaN if `t` is outside [timeMs[0], timeMs[-1]] or data is unusable around it. */
function sampleAt(timeMs: ArrayLike<number>, data: ArrayLike<number>, t: number): number {
  const n = timeMs.length
  if (n === 0) return NaN
  if (t < timeMs[0] || t > timeMs[n - 1]) return NaN

  // Binary search for the first index with timeMs[idx] >= t.
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (timeMs[mid] < t) lo = mid + 1
    else hi = mid
  }
  const i1 = lo
  if (timeMs[i1] === t) return data[i1]
  if (i1 === 0) return NaN
  const i0 = i1 - 1
  const t0 = timeMs[i0]
  const t1 = timeMs[i1]
  const span = t1 - t0
  if (!(span > 0)) return data[i0]
  const frac = (t - t0) / span
  const v0 = data[i0]
  const v1 = data[i1]
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return NaN
  return v0 + frac * (v1 - v0)
}

/** Resample `data`/`timeMs` onto a fixed grid `t0, t0+stepMs, ..., t1` via linear interpolation. NaN where out of range or source is NaN. */
function resample(timeMs: ArrayLike<number>, data: ArrayLike<number>, gridStart: number, gridEnd: number, stepMs: number): Float64Array {
  const count = Math.max(0, Math.floor((gridEnd - gridStart) / stepMs) + 1)
  const out = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    out[i] = sampleAt(timeMs, data, gridStart + i * stepMs)
  }
  return out
}

/** Z-score normalize in place semantics (returns a new array): (x - mean) / stddev, using only finite values for the stats. NaN stays NaN. Returns null if fewer than 2 finite values or stddev ~ 0 (no usable variance to correlate on). */
function zScore(data: Float64Array): Float64Array | null {
  let sum = 0
  let count = 0
  for (const v of data) {
    if (Number.isFinite(v)) {
      sum += v
      count++
    }
  }
  if (count < 2) return null
  const mean = sum / count

  let sqSum = 0
  for (const v of data) {
    if (Number.isFinite(v)) sqSum += (v - mean) * (v - mean)
  }
  const stddev = Math.sqrt(sqSum / count)
  if (!(stddev > 1e-9)) return null

  const out = new Float64Array(data.length)
  for (let i = 0; i < data.length; i++) {
    out[i] = Number.isFinite(data[i]) ? (data[i] - mean) / stddev : NaN
  }
  return out
}

/**
 * Normalized cross-correlation between two equal-length z-scored series at a
 * given integer sample lag (positive lag = `b` shifted later relative to
 * `a`). Only overlapping, both-finite sample pairs contribute. Returns null
 * if fewer than 2 such pairs overlap at this lag.
 */
function correlationAt(a: Float64Array, b: Float64Array, lagSamples: number): number | null {
  const n = a.length
  let sum = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    const j = i + lagSamples
    if (j < 0 || j >= n) continue
    const av = a[i]
    const bv = b[j]
    if (!Number.isFinite(av) || !Number.isFinite(bv)) continue
    sum += av * bv
    count++
  }
  if (count < 2) return null
  return sum / count
}

/**
 * Find the time offset that best aligns `other`'s clock to `ref`'s clock,
 * using vehicle speed as the shared reference signal.
 *
 * Both series are resampled onto a common fixed-step grid spanning the union
 * of their time ranges (linear interpolation; missing/out-of-range samples
 * become NaN and are simply excluded from the correlation sum at each lag),
 * then z-score normalized. The lag range [-maxLagMs, +maxLagMs] is scanned in
 * `stepMs` increments and the lag with the highest normalized
 * cross-correlation wins.
 *
 * Returns null when either series is empty/too short, has no variance
 * (constant or all-NaN, e.g. stationary vehicle throughout), or no lag in
 * range has enough overlapping finite samples to score.
 */
export function crossCorrelateOffset(
  refSpeed: ArrayLike<number>,
  refTimeMs: ArrayLike<number>,
  otherSpeed: ArrayLike<number>,
  otherTimeMs: ArrayLike<number>,
  opts: CrossCorrelateOptions,
): AlignmentResult | null {
  const { maxLagMs, stepMs } = opts
  if (!(stepMs > 0) || !(maxLagMs >= 0)) return null
  if (refSpeed.length < 2 || refTimeMs.length < 2 || otherSpeed.length < 2 || otherTimeMs.length < 2) return null
  if (refSpeed.length !== refTimeMs.length || otherSpeed.length !== otherTimeMs.length) return null

  const refStart = refTimeMs[0]
  const refEnd = refTimeMs[refTimeMs.length - 1]
  const otherStart = otherTimeMs[0]
  const otherEnd = otherTimeMs[otherTimeMs.length - 1]
  if (!Number.isFinite(refStart) || !Number.isFinite(refEnd) || !Number.isFinite(otherStart) || !Number.isFinite(otherEnd)) {
    return null
  }

  // Common grid: union of both ranges, padded by maxLagMs on each side so a
  // real shift up to maxLagMs still has overlapping samples to correlate.
  const gridStart = Math.min(refStart, otherStart) - maxLagMs
  const gridEnd = Math.max(refEnd, otherEnd) + maxLagMs
  if (!(gridEnd > gridStart)) return null

  const refGrid = resample(refTimeMs, refSpeed, gridStart, gridEnd, stepMs)
  const otherGrid = resample(otherTimeMs, otherSpeed, gridStart, gridEnd, stepMs)
  if (refGrid.length < 2 || otherGrid.length < 2) return null

  const refNorm = zScore(refGrid)
  const otherNorm = zScore(otherGrid)
  if (!refNorm || !otherNorm) return null

  const maxLagSamples = Math.round(maxLagMs / stepMs)
  let bestLagSamples = 0
  let bestScore = -Infinity
  let found = false

  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag++) {
    const score = correlationAt(refNorm, otherNorm, lag)
    if (score == null) continue
    found = true
    if (score > bestScore) {
      bestScore = score
      bestLagSamples = lag
    }
  }

  if (!found) return null

  // correlationAt(ref, other, lag) pairs ref[i] with other[i + lag]; i.e.
  // other sample at grid-index (i+lag) matches ref sample at grid-index i, so
  // other's clock reads (i+lag)*stepMs while ref's reads i*stepMs at the same
  // physical instant -> other is ahead by lag*stepMs -> shifting other's time
  // axis forward by -lag*stepMs (equivalently adding -lag*stepMs) lines it up
  // with ref. offsetMs is defined as "add to other's time axis to match ref".
  return { offsetMs: -bestLagSamples * stepMs, score: bestScore }
}
