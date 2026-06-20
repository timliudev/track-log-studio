/**
 * Per-sample normalisation for the track heatmap (#10): map a channel's values
 * to [0, 1] over the channel's own min..max so the track polyline can be
 * gradient-coloured by value (e.g. RPM/G to reveal corner entry/exit).
 *
 * Only samples that BOTH have a valid GPS fix and a finite value count toward
 * the range — invalid/blank samples normalise to NaN so the renderer can skip
 * colouring those segments. A degenerate range (all equal, or <2 valid points)
 * yields all-0.5 with min === max so the legend still reads sensibly.
 */
export interface ChannelNorm {
  /** Per-sample value in [0, 1], NaN where the sample has no colour. */
  norm: Float64Array
  /** Min / max of the contributing values (NaN if none). */
  min: number
  max: number
}

export function normalizeChannel(data: Float32Array, valid: Uint8Array): ChannelNorm {
  const n = data.length
  const norm = new Float64Array(n)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    const v = data[i]
    if (valid[i] !== 1 || !Number.isFinite(v)) {
      norm[i] = NaN
      continue
    }
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min === Infinity) {
    // No contributing samples — leave norm all-NaN, signal an empty range.
    return { norm, min: NaN, max: NaN }
  }
  const span = max - min
  for (let i = 0; i < n; i++) {
    const v = data[i]
    if (valid[i] !== 1 || !Number.isFinite(v)) continue
    norm[i] = span > 0 ? (v - min) / span : 0.5
  }
  return { norm, min, max }
}
