import { describe, expect, it } from 'vitest'
import { xyzPoints } from '@/domain/analysis/scatter3d'

describe('xyzPoints', () => {
  it('combines aligned XY points and the third channel into finite XYZ tuples', () => {
    expect(xyzPoints({
      points: [[1, 2], [3, 4]],
      zValues: [10, 20],
    })).toEqual([[1, 2, 10], [3, 4, 20]])
  })

  it('does not fabricate a Z coordinate for a series missing the selected channel', () => {
    expect(xyzPoints({ points: [[1, 2]] })).toEqual([])
  })
})
