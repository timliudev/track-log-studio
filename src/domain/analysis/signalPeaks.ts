/** A local maximum found by {@link findPeaks}, with its topographic prominence. */
export interface Peak {
  /** Index into the input signal. */
  index: number
  /** Signal value at the peak. */
  value: number
  /**
   * Topographic prominence: how far the peak stands above the higher of the
   * two nearest points (in either direction) that are themselves taller than
   * it (or the array boundary, if none is taller). A peak in the middle of a
   * long, never-flat climb still gets a small prominence if a nearby dip cuts
   * it off from its neighbours — this is what lets consecutive same-direction
   * corners (e.g. a triple-apex combo where curvature never returns to zero)
   * register as distinct peaks, rather than requiring the signal to fall to a
   * global floor between them.
   */
  prominence: number
}

/**
 * Find local maxima of a 1D signal and rank them by topographic prominence,
 * independent of any absolute baseline. A peak's prominence is its height
 * above the higher of its two "bases" (the lowest point reached while walking
 * outward in each direction before hitting a taller point, or the array
 * boundary). This is the same technique used to distinguish separate
 * mountain peaks along a ridge that never drops to sea level between them.
 *
 * `minProminence` filters out noise bumps riding on a bigger slope.
 * `minValue` is an optional absolute floor (e.g. "must exceed 15 deg of total
 * turn to count as a corner at all", filtering dead-straight GPS jitter).
 *
 * O(n) peaks in the worst case, each doing an O(n) outward scan — fine for a
 * single lap's sample count (hundreds to a few thousand points); would need a
 * monotonic-stack rewrite if ever run over much longer signals.
 */
export function findPeaks(
  signal: ArrayLike<number>,
  opts: { minProminence?: number; minValue?: number } = {},
): Peak[] {
  const minProminence = opts.minProminence ?? 0
  const minValue = opts.minValue ?? -Infinity
  const n = signal.length
  const peaks: Peak[] = []

  for (let i = 0; i < n; i++) {
    const v = signal[i]
    if (v < minValue) continue
    const l = i > 0 ? signal[i - 1] : -Infinity
    const r = i < n - 1 ? signal[i + 1] : -Infinity
    // Local max: not lower than either neighbour, and strictly higher than at
    // least one (rejects flat runs so a plateau isn't counted twice).
    if (!(v >= l && v >= r && (v > l || v > r))) continue

    let leftMin = v
    for (let j = i - 1; j >= 0; j--) {
      if (signal[j] > v) break
      if (signal[j] < leftMin) leftMin = signal[j]
    }
    let rightMin = v
    for (let j = i + 1; j < n; j++) {
      if (signal[j] > v) break
      if (signal[j] < rightMin) rightMin = signal[j]
    }

    const prominence = v - Math.max(leftMin, rightMin)
    if (prominence >= minProminence) {
      peaks.push({ index: i, value: v, prominence })
    }
  }

  return peaks
}
