/** A point cloud that has already been filtered and sampled for XY scatter. */
export interface Scatter3dSeriesInput {
  points: readonly [number, number][]
  zValues?: readonly number[]
}

/** Combine aligned XY points and a selected third channel into finite XYZ tuples. */
export function xyzPoints(series: Scatter3dSeriesInput): [number, number, number][] {
  if (!series.zValues) return []
  return series.points.flatMap((point, index) => {
    const z = series.zValues![index]
    return Number.isFinite(z) ? [[point[0], point[1], z]] : []
  })
}
