/**
 * Phase 7 — acceleration / drag test: scan the WHOLE session (not a single
 * lap) for the fastest segment matching a configurable condition, mirroring a
 * drag-strip timer (e.g. "fastest 100 m", "0->100 km/h").
 *
 * This is deliberately NOT a {@link LapMetric} (see `lapMetrics.ts`). A
 * `LapMetric` answers "what's this lap's value of X", one number per lap
 * drawn from that lap's own [startIdx, endIdx) span. An accel test answers a
 * different question — "where, ANYWHERE in the whole recording, is the best
 * qualifying segment" — and the winning window routinely straddles a lap
 * boundary (out-lap acceleration onto the front straight, or an in-lap
 * carrying speed past the finish line) or lives in a section that isn't a lap
 * at all (pit-out, a straight-line test outside the circuit). Forcing it into
 * the per-lap model would mean re-deriving "whole session" as a synthetic lap
 * and losing cross-lap-boundary windows — so it stays a standalone
 * whole-session search, consumed directly by the UI panel rather than through
 * `computeMetric`/`LapContext`.
 */

/** A found best-matching segment. */
export interface AccelSegment {
  startIdx: number
  endIdx: number
  timeMs: number
  distanceM: number
  entrySpeedKmh: number
  exitSpeedKmh: number
}

export interface FastestDistanceFromLaunchOptions {
  /** Distance to cover (metres), e.g. 100 for a "fastest 100 m" search. */
  distanceM: number
  /**
   * The launch speed (km/h) to time FROM — e.g. 0 for a standing start, or a
   * rolling-launch speed like 40. A "launch" is a crossing where speed rises
   * THROUGH this value (from <= entrySpeedKmh to > entrySpeedKmh); the clock
   * starts at that crossing, not at some globally-fastest window that merely
   * happens to satisfy a floor.
   */
  entrySpeedKmh: number
}

/**
 * Times "from a launch at `entrySpeedKmh`, how long to cover `distanceM`" —
 * mirroring what the user actually means by e.g. "0 km/h start, 100 m: how
 * many seconds to cover it" (a standing-start drag time), NOT "anywhere in
 * the session where entry speed happens to be >= a floor, find the
 * fastest-covering window" (that's what the old floor-filter search did, and
 * why entry=0 used to return a near-top-speed window instead of a genuine
 * standing start — see the module doc history / accelTest.test.ts).
 *
 * Launch detection reuses {@link fastestSpeedSegment}'s `lastLowIdx` idea:
 * scan the whole session tracking the most recent sample at/below
 * `entrySpeedKmh` (a candidate launch base); the first time speed
 * subsequently rises strictly above it, that's a launch, interpolated to the
 * exact instant speed crosses `entrySpeedKmh` (same trap-timer semantics as
 * the other accel-test functions — a threshold crossed mid-sample doesn't
 * bias the result by up to one sample interval). For `entrySpeedKmh = 0`
 * this is exactly a standing start: the launch is where speed leaves zero.
 *
 * From each launch's interpolated start (time + distance), a two-pointer
 * scan advances an END cursor until cumulative distance covers `distanceM`
 * from that start (interpolated to the exact end at the trap distance, same
 * as {@link fastestSpeedSegment}/the old distance search). Because launch
 * starts and their target distances are both monotonically non-decreasing
 * across the session (cumDistM never decreases), the END cursor is shared
 * and only ever advances across ALL launches — still O(n) total, not
 * O(n * launches). Once a launch's remaining distance can't reach
 * `distanceM`, every later launch (starting even further along, with even
 * less track left) can't either, so the scan stops there.
 *
 * Among ALL launches found in the session, the one with the smallest elapsed
 * time wins. After a launch is resolved (whether or not it covered the
 * distance), a fresh dip back to/below `entrySpeedKmh` is required before
 * another launch can start — so a noisy plateau right at the threshold
 * doesn't spawn many overlapping "launches" from the same run.
 *
 * Returns null when: fewer than 2 samples, `distanceM <= 0`,
 * `entrySpeedKmh` isn't finite, no sample ever crosses UP through
 * `entrySpeedKmh` (no launch at all), or no launch's remaining track covers
 * `distanceM`.
 */
export function fastestDistanceFromLaunch(
  cumDistM: Float64Array,
  timeMs: Float64Array,
  speedKmh: ArrayLike<number>,
  opts: FastestDistanceFromLaunchOptions,
): AccelSegment | null {
  const n = cumDistM.length
  const { distanceM, entrySpeedKmh } = opts
  if (n < 2 || n !== timeMs.length || !(distanceM > 0) || !Number.isFinite(entrySpeedKmh)) {
    return null
  }

  /** Interpolate the fraction along (i-1 -> i) where speed crosses `target`,
   *  assuming speed[i-1] and speed[i] bracket it (one at/below, one above). */
  function crossingFrac(i: number, target: number): number {
    const v0 = speedKmh[i - 1]
    const v1 = speedKmh[i]
    const span = v1 - v0
    if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return 0
    return Math.min(1, Math.max(0, (target - v0) / span))
  }

  function lerp(i: number, frac: number, arr: Float64Array): number {
    return arr[i - 1] + frac * (arr[i] - arr[i - 1])
  }

  let best: AccelSegment | null = null
  // Most recent sample index seen at/below entrySpeedKmh — a candidate
  // launch base — or -1 when none has been seen yet. See fastestSpeedSegment
  // for why the LATEST such index (not the earliest) is kept.
  let lastLowIdx = -1
  // Two-pointer END cursor shared across launches (see doc above for why
  // this stays valid across the whole scan without restarting from 0).
  let end = 0

  for (let i = 0; i < n; i++) {
    const v = speedKmh[i]
    if (!Number.isFinite(v)) continue

    if (v <= entrySpeedKmh) {
      lastLowIdx = i
      continue
    }

    if (lastLowIdx < 0) continue // still waiting for a qualifying low point to launch from

    // v > entrySpeedKmh and we have a launch base: interpolate the exact
    // launch instant (crossing entrySpeedKmh between lastLowIdx and i).
    const startI = lastLowIdx
    let startTimeMs: number
    let startDistM: number
    let startSpeedKmh: number
    if (startI + 1 < n && Number.isFinite(speedKmh[startI + 1]) && (speedKmh[startI + 1] as number) > entrySpeedKmh) {
      const f = crossingFrac(startI + 1, entrySpeedKmh)
      startTimeMs = lerp(startI + 1, f, timeMs)
      startDistM = lerp(startI + 1, f, cumDistM)
      startSpeedKmh = entrySpeedKmh
    } else {
      startTimeMs = timeMs[startI]
      startDistM = cumDistM[startI]
      startSpeedKmh = speedKmh[startI] as number
    }

    // This launch is resolved; require a fresh dip back to entrySpeedKmh
    // before another one can start (see doc above).
    lastLowIdx = -1

    if (!Number.isFinite(startTimeMs) || !Number.isFinite(startDistM)) continue

    const targetDist = startDistM + distanceM
    // Floor the shared END cursor at startI+1 (not the current loop index
    // `i`) — they can differ when invalid/NaN speed samples sit between the
    // launch and its detection, and the window's end may legitimately fall
    // in that gap (cumDistM/timeMs there can still be valid).
    if (end < startI + 1) end = startI + 1
    while (end < n - 1 && cumDistM[end] < targetDist) end++
    if (cumDistM[end] < targetDist) break // remaining track too short — later launches fare no better

    const d0 = cumDistM[end - 1]
    const d1 = cumDistM[end]
    const t0 = timeMs[end - 1]
    const t1 = timeMs[end]
    if (!Number.isFinite(d0) || !Number.isFinite(d1) || !Number.isFinite(t0) || !Number.isFinite(t1)) {
      continue
    }
    const span = d1 - d0
    const frac = span > 1e-9 ? Math.min(1, Math.max(0, (targetDist - d0) / span)) : 0
    const endTimeMs = t0 + frac * (t1 - t0)
    const elapsed = endTimeMs - startTimeMs
    if (!(elapsed > 0)) continue

    if (best == null || elapsed < best.timeMs) {
      const exitV0 = speedKmh[end - 1]
      const exitV1 = speedKmh[end]
      const exitSpeedKmh =
        Number.isFinite(exitV0) && Number.isFinite(exitV1)
          ? exitV0 + frac * (exitV1 - exitV0)
          : (speedKmh[end] as number)
      best = {
        startIdx: startI,
        endIdx: end,
        timeMs: elapsed,
        distanceM,
        entrySpeedKmh: startSpeedKmh,
        exitSpeedKmh,
      }
    }
  }

  return best
}

export interface FastestSpeedOptions {
  /** Entry speed threshold (km/h) — the window starts where speed first is <= this. */
  fromKmh: number
  /** Exit speed threshold (km/h) — the window ends where speed first reaches >= this. */
  toKmh: number
}

/**
 * Minimum-time window where speed goes from `<= fromKmh` to `>= toKmh`
 * (e.g. 0 -> 100 km/h), scanning the whole session.
 *
 * Noise/monotonic rule (documented, not merely implied): the endpoints alone
 * define a run — NOT strict monotonicity in between. Concretely, the scan
 * tracks `lastLowIdx`, the most recent sample at/below `fromKmh`; the first
 * time speed subsequently reaches `>= toKmh`, that pairs (`lastLowIdx`, this
 * sample) into one candidate run, and `lastLowIdx` resets so the next run
 * needs a fresh dip back to/below `fromKmh` before it can start. This means:
 * a small backward blip (GPS/sensor noise, momentary wheelspin correction)
 * *inside* a run does NOT reject it — only the two threshold crossings
 * matter. It also means the reported start is the LATEST qualifying low
 * point before the target is hit (closest to the actual launch), so a run
 * that idles at low speed for a while before launching is timed from the
 * launch, not from when it first dipped below `fromKmh`. Two separate accel
 * runs in the same log each produce their own candidate; the faster wins.
 *
 * Time/distance are interpolated at the crossing points (same trap-timer
 * semantics as {@link fastestDistanceFromLaunch}) so a threshold crossed
 * mid-sample doesn't bias the result by up to one sample interval.
 *
 * Returns null when: fewer than 2 samples, `toKmh <= fromKmh`, or no
 * candidate run reaches `toKmh` anywhere in the session.
 */
export function fastestSpeedSegment(
  timeMs: Float64Array,
  speedKmh: ArrayLike<number>,
  cumDistM: Float64Array,
  opts: FastestSpeedOptions,
): AccelSegment | null {
  const n = timeMs.length
  const { fromKmh, toKmh } = opts
  if (n < 2 || n !== cumDistM.length || !(toKmh > fromKmh)) return null

  /** Interpolate the fraction along (i-1 -> i) where speed crosses `target`,
   *  assuming speed[i-1] and speed[i] bracket it (one below, one at/above). */
  function crossingFrac(i: number, target: number): number {
    const v0 = speedKmh[i - 1]
    const v1 = speedKmh[i]
    const span = v1 - v0
    if (!Number.isFinite(span) || Math.abs(span) < 1e-9) return 0
    return Math.min(1, Math.max(0, (target - v0) / span))
  }

  function lerp(i: number, frac: number, arr: Float64Array): number {
    return arr[i - 1] + frac * (arr[i] - arr[i - 1])
  }

  let best: AccelSegment | null = null
  // The most recent sample index seen at/below fromKmh (a qualifying low
  // point a run could start from), or -1 when none has been seen yet. Kept
  // as the LATEST such index (not the earliest) so a run starts as close as
  // possible to its actual launch point, and a small mid-run dip back below
  // fromKmh naturally re-bases the start to that later, more representative
  // point rather than the very first low sample in the log.
  let lastLowIdx = -1

  for (let i = 0; i < n; i++) {
    const v = speedKmh[i]
    if (!Number.isFinite(v)) continue

    if (v <= fromKmh) {
      lastLowIdx = i
      continue
    }

    if (lastLowIdx < 0) continue // still waiting for a qualifying low point to start a run

    if (v < toKmh) continue // run in progress, hasn't reached the target yet

    // v >= toKmh and we have a qualifying start: interpolate both edges.
    const startI = lastLowIdx
    let startTimeMs: number
    let startDistM: number
    let entrySpeedKmh: number
    if (startI + 1 < n && Number.isFinite(speedKmh[startI + 1]) && speedKmh[startI + 1] > fromKmh) {
      const f = crossingFrac(startI + 1, fromKmh)
      startTimeMs = lerp(startI + 1, f, timeMs)
      startDistM = lerp(startI + 1, f, cumDistM)
      entrySpeedKmh = fromKmh
    } else {
      startTimeMs = timeMs[startI]
      startDistM = cumDistM[startI]
      entrySpeedKmh = speedKmh[startI]
    }

    // Interpolate the toKmh-crossing between i-1 and i.
    let endTimeMs: number
    let endDistM: number
    if (i > 0 && Number.isFinite(speedKmh[i - 1]) && speedKmh[i - 1] < toKmh) {
      const f = crossingFrac(i, toKmh)
      endTimeMs = lerp(i, f, timeMs)
      endDistM = lerp(i, f, cumDistM)
    } else {
      endTimeMs = timeMs[i]
      endDistM = cumDistM[i]
    }

    const elapsed = endTimeMs - startTimeMs
    if (elapsed > 0 && (best == null || elapsed < best.timeMs)) {
      best = {
        startIdx: startI,
        endIdx: i,
        timeMs: elapsed,
        distanceM: endDistM - startDistM,
        entrySpeedKmh,
        exitSpeedKmh: toKmh,
      }
    }

    // This candidate is resolved; require a fresh dip back to fromKmh before
    // starting another one (so a single noisy plateau at the target doesn't
    // spawn many overlapping "runs").
    lastLowIdx = -1
  }

  return best
}
