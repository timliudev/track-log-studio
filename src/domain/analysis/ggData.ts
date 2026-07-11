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
 * Shared filter+decimate core for {@link buildGgPoints} and
 * {@link buildGgPointsWithColor}: walks the aligned arrays once, drops any
 * sample where X, Y, OR (when given) the colour channel is non-finite
 * (dropout/NaN — same rule as the X/Y-only path, extended so a colour-axis
 * point is never shown without a meaningful colour), then stride-decimates
 * to `maxPoints`. `colorData == null` skips the third array entirely (the
 * plain X/Y path) and `colorValues` comes back `null` in that case.
 */
function buildGgPointsCore(
  xData: ArrayLike<number>,
  yData: ArrayLike<number>,
  colorData: ArrayLike<number> | null,
  opts: BuildGgPointsOptions,
): { points: [number, number][]; colorValues: number[] | null } {
  const scale = opts.scale ?? 1
  const n = Math.min(xData.length, yData.length, colorData?.length ?? Infinity)
  const start = Math.max(0, Math.min(opts.start ?? 0, n))
  const end = Math.max(start, Math.min(opts.end ?? n, n))

  const points: [number, number][] = []
  const colorValues: number[] | null = colorData ? [] : null
  for (let i = start; i < end; i++) {
    const x = xData[i]
    const y = yData[i]
    const c = colorData ? colorData[i] : 0
    if (!Number.isFinite(x) || !Number.isFinite(y) || (colorData && !Number.isFinite(c))) continue
    points.push([x * scale, y * scale])
    colorValues?.push(c)
  }

  const maxPoints = opts.maxPoints
  if (maxPoints == null || maxPoints <= 0 || points.length <= maxPoints) return { points, colorValues }

  const stride = Math.ceil(points.length / maxPoints)
  const decimatedPoints: [number, number][] = []
  const decimatedColors: number[] | null = colorValues ? [] : null
  for (let i = 0; i < points.length; i += stride) {
    decimatedPoints.push(points[i])
    decimatedColors?.push(colorValues![i])
  }
  // Always keep the final point so the tail of the range isn't silently cut.
  const last = points[points.length - 1]
  if (decimatedPoints[decimatedPoints.length - 1] !== last) {
    decimatedPoints.push(last)
    decimatedColors?.push(colorValues![colorValues!.length - 1])
  }
  return { points: decimatedPoints, colorValues: decimatedColors }
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
  return buildGgPointsCore(xData, yData, null, opts).points
}

/**
 * Colour-axis variant of {@link buildGgPoints} (third-channel scatter
 * colouring — see ScatterChart.vue's colour-axis picker): same X/Y
 * filter+scale+decimate behaviour, plus a `colorValues` array aligned 1:1
 * with `points` carrying the third channel's RAW (unscaled — colour values
 * aren't milli-g) value at each kept sample. A sample is dropped if X, Y, OR
 * the colour value is non-finite, so every returned point has a usable
 * colour.
 */
export function buildGgPointsWithColor(
  xData: ArrayLike<number>,
  yData: ArrayLike<number>,
  colorData: ArrayLike<number>,
  opts: BuildGgPointsOptions = {},
): { points: [number, number][]; colorValues: number[] } {
  const { points, colorValues } = buildGgPointsCore(xData, yData, colorData, opts)
  return { points, colorValues: colorValues ?? [] }
}
