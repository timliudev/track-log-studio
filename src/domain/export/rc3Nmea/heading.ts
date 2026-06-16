import { bearingDeg, haversineM, toRadians, toDegrees } from './geo'

// Below this displacement between the two ends of a heading-window, GPS noise
// dominates and a freshly computed bearing is unreliable, so the previous
// heading is carried forward instead.
export const MIN_MOVE_M = 1.0

// Half-width (in valid-fix samples) of the baseline used for each raw bearing
// estimate. A wider baseline averages out point-to-point GPS jitter.
export const HEADING_HALF_WINDOW = 4

// Smoothing factor for the forward/backward EMA over heading unit vectors.
// Combining a forward and backward pass cancels the lag while keeping corner
// transitions continuous.
export const HEADING_EMA_ALPHA = 0.25

/** Forward exponential moving average; first element seeds the average. */
function ema(seq: number[]): number[] {
  const out: number[] = new Array(seq.length)
  let s = 0
  for (let i = 0; i < seq.length; i++) {
    s = i === 0 ? seq[i] : HEADING_EMA_ALPHA * seq[i] + (1 - HEADING_EMA_ALPHA) * s
    out[i] = s
  }
  return out
}

/** EMA run backwards then re-reversed (zero-phase second pass). */
function emaBackward(seq: number[]): number[] {
  return ema([...seq].reverse()).reverse()
}

/**
 * Smoothed per-fix course (heading) in degrees, ported from
 * compute_smoothed_courses() in loga2nmea.py. Operates on the sequence of
 * valid GPS fixes (decimal degrees); returns one heading per fix.
 */
export function computeSmoothedCourses(
  latList: number[],
  lonList: number[],
): number[] {
  const n = latList.length
  if (n === 0) return []
  if (n === 1) return [0]

  const raw: number[] = new Array(n)
  let lastRaw = 0
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - HEADING_HALF_WINDOW)
    const j1 = Math.min(n - 1, i + HEADING_HALF_WINDOW)
    if (j0 === j1) {
      raw[i] = lastRaw
      continue
    }
    const moved = haversineM(latList[j0], lonList[j0], latList[j1], lonList[j1])
    if (moved >= MIN_MOVE_M) {
      lastRaw = bearingDeg(latList[j0], lonList[j0], latList[j1], lonList[j1])
    }
    raw[i] = lastRaw
  }

  // Heading as unit vectors, smoothed component-wise (linear, so equivalent to
  // EMA over complex numbers as in the Python reference).
  const re = raw.map((a) => Math.cos(toRadians(a)))
  const im = raw.map((a) => Math.sin(toRadians(a)))
  const fRe = ema(re)
  const fIm = ema(im)
  const bRe = emaBackward(re)
  const bIm = emaBackward(im)

  const smoothed: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    let cr = fRe[i] + bRe[i]
    let ci = fIm[i] + bIm[i]
    if (Math.hypot(cr, ci) < 1e-9) {
      cr = fRe[i]
      ci = fIm[i]
    }
    // Match Python's always-non-negative modulo.
    smoothed[i] = ((toDegrees(Math.atan2(ci, cr)) % 360) + 360) % 360
  }
  return smoothed
}
