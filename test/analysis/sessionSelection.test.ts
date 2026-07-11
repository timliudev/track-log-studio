import { describe, expect, it } from 'vitest'
import { promotePrimarySession, toggleIncludedSession } from '@/domain/analysis/sessionSelection'

describe('sessionSelection', () => {
  it('adds and removes comparison recordings without changing the primary', () => {
    expect(toggleIncludedSession({ primaryId: 1, comparisonIds: [] }, 2)).toEqual({
      primaryId: 1,
      comparisonIds: [2],
    })
    expect(toggleIncludedSession({ primaryId: 1, comparisonIds: [2, 3] }, 2)).toEqual({
      primaryId: 1,
      comparisonIds: [3],
    })
  })

  it('promotes the first comparison when the primary is unchecked', () => {
    expect(toggleIncludedSession({ primaryId: 1, comparisonIds: [2, 3] }, 1)).toEqual({
      primaryId: 2,
      comparisonIds: [3],
    })
  })

  it('keeps the only visible recording selected', () => {
    const state = { primaryId: 1, comparisonIds: [] }
    expect(toggleIncludedSession(state, 1)).toBe(state)
  })

  it('changes the primary without changing the visible set', () => {
    expect(promotePrimarySession({ primaryId: 1, comparisonIds: [2, 3] }, 3)).toEqual({
      primaryId: 3,
      comparisonIds: [1, 2],
    })
  })
})
