/**
 * Largest-Triangle-Three-Buckets downsampling for display. Keeps the visual
 * shape of a series while reducing it to ~maxPoints points. First and last
 * points are always kept. Analysis always uses full resolution; this is only
 * for plotting.
 */
export function lttb(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  maxPoints: number,
): { x: number[]; y: number[] } {
  const n = x.length
  if (maxPoints >= n || maxPoints < 3 || n < 3) {
    return { x: Array.from(x), y: Array.from(y) }
  }

  const outX: number[] = [x[0]]
  const outY: number[] = [y[0]]
  const bucketSize = (n - 2) / (maxPoints - 2)
  let a = 0 // index of the last selected point

  for (let i = 0; i < maxPoints - 2; i++) {
    // average point of the next bucket
    const nextStart = Math.floor((i + 1) * bucketSize) + 1
    const nextEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n)
    let avgX = 0
    let avgY = 0
    let count = 0
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += x[j]
      avgY += y[j]
      count++
    }
    if (count === 0) count = 1
    avgX /= count
    avgY /= count

    // point in the current bucket forming the largest triangle
    const curStart = Math.floor(i * bucketSize) + 1
    const curEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n)
    let maxArea = -1
    let maxIdx = curStart
    for (let j = curStart; j < curEnd; j++) {
      const area = Math.abs(
        (x[a] - avgX) * (y[j] - y[a]) - (x[a] - x[j]) * (avgY - y[a]),
      )
      if (area > maxArea) {
        maxArea = area
        maxIdx = j
      }
    }
    outX.push(x[maxIdx])
    outY.push(y[maxIdx])
    a = maxIdx
  }

  outX.push(x[n - 1])
  outY.push(y[n - 1])
  return { x: outX, y: outY }
}
