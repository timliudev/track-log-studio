export type Aggregation = 'max' | 'min' | 'avg'

/**
 * Aggregate a channel over a lap's sample span [startIdx, endIdx] (inclusive),
 * ignoring NaN. Returns NaN if the span has no finite samples. avg = arithmetic
 * mean of finite samples.
 *
 * The span is clamped safely: a negative startIdx is treated as 0 and an endIdx
 * at or beyond `data.length` is clamped to the last index, so out-of-range laps
 * never read past the array.
 */
export function aggregateChannel(
  data: Float32Array,
  startIdx: number,
  endIdx: number,
  agg: Aggregation,
): number {
  const lo = Math.max(0, startIdx)
  const hi = Math.min(endIdx, data.length - 1)

  let acc = agg === 'max' ? -Infinity : agg === 'min' ? Infinity : 0
  let count = 0
  for (let i = lo; i <= hi; i++) {
    const v = data[i]
    if (Number.isNaN(v)) continue
    count++
    if (agg === 'max') {
      if (v > acc) acc = v
    } else if (agg === 'min') {
      if (v < acc) acc = v
    } else {
      acc += v
    }
  }

  if (count === 0) return NaN
  return agg === 'avg' ? acc / count : acc
}
