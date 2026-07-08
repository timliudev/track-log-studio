/**
 * G-G diagram (friction circle) data prep: two force channels (e.g. aRacer's
 * `TC_Xforce`/`TC_Yforce`, stored in milli-g) reduced to a scatter of
 * [x, y] points in g units, ready for a chart. Pure — no chart/session
 * coupling, mirroring the other `domain/analysis` helpers.
 */

/**
 * Whether a channel name "looks like" a signed force/acceleration channel
 * (aRacer's `TC_Xforce`/`TC_Yforce` and similar — anything with "force" in
 * its name), i.e. the kind of channel pair where a 1:1 XY plot is
 * meaningful (both axes share the same physical unit and roughly the same
 * magnitude, so a circle really does mean "equal grip in every direction").
 * Shared between ScatterChart.vue (milli-g scale + the equal-aspect default)
 * and analyzerStore's `addChart`/chartConfigs' persisted-payload backfill —
 * see #5 in the equal-aspect fix: defaulting EVERY channel pair to a
 * true-1:1 axis scale (not just force pairs) squashes the axis with the
 * smaller data range into a sliver whenever the two channels have very
 * different magnitudes (e.g. RPM vs a 0–100 signal).
 */
export function looksLikeForce(name: string | null | undefined): boolean {
  return name != null && /force/i.test(name)
}

/** Whether BOTH sides of an XY channel pair look like force/acceleration
 *  channels — the only case where defaulting to a 1:1 axis scale is safe
 *  (see {@link looksLikeForce}). */
export function looksLikeForcePair(
  xChannel: string | null | undefined,
  yChannel: string | null | undefined,
): boolean {
  return looksLikeForce(xChannel) && looksLikeForce(yChannel)
}

export interface BuildGgPointsOptions {
  /** Multiply raw channel values by this to get g units. aRacer TC_*force is
   *  milli-g, so 0.001. Default 1 (already in g). */
  scale?: number
  /** Inclusive/exclusive sample range [start, end) to include. Defaults to
   *  the whole array. */
  start?: number
  end?: number
  /** Stride-decimate to at most this many points (keeps every Nth sample,
   *  always including the last in range). Undefined/<=0 = no decimation. */
  maxPoints?: number
}

/**
 * Build [x, y] scatter points (in g) from two aligned raw channel arrays.
 * Filters out samples where either channel is non-finite (dropout/NaN), then
 * simple stride-decimates to `maxPoints` if given. Both channels are scaled
 * the same way (they're the same physical unit — milli-g or g).
 */
export function buildGgPoints(
  xData: ArrayLike<number>,
  yData: ArrayLike<number>,
  opts: BuildGgPointsOptions = {},
): [number, number][] {
  const scale = opts.scale ?? 1
  const n = Math.min(xData.length, yData.length)
  const start = Math.max(0, Math.min(opts.start ?? 0, n))
  const end = Math.max(start, Math.min(opts.end ?? n, n))

  const points: [number, number][] = []
  for (let i = start; i < end; i++) {
    const x = xData[i]
    const y = yData[i]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    points.push([x * scale, y * scale])
  }

  const maxPoints = opts.maxPoints
  if (maxPoints == null || maxPoints <= 0 || points.length <= maxPoints) return points

  const stride = Math.ceil(points.length / maxPoints)
  const decimated: [number, number][] = []
  for (let i = 0; i < points.length; i += stride) decimated.push(points[i])
  // Always keep the final point so the tail of the range isn't silently cut.
  const last = points[points.length - 1]
  if (decimated[decimated.length - 1] !== last) decimated.push(last)
  return decimated
}
