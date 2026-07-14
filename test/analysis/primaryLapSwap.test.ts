import { describe, expect, it } from 'vitest'
import { swapPrimaryLapState } from '@/domain/analysis/primaryLapSwap'

describe('primaryLapSwap', () => {
  it('swap: promotes the new primary\'s per-session state into the primary facet', () => {
    const result = swapPrimaryLapState<number>({
      oldPrimaryId: 1,
      newPrimaryId: 2,
      selected: [],
      manualExcluded: [],
      offsets: {},
      selectedAcrossSessions: [{ fileId: 2, index: 0 }, { fileId: 2, index: 3 }],
      manualExcludedBySession: { 2: [5] },
      sessionLapOffsets: { '2:0': 0.5 },
    })

    expect(result.selected).toEqual([0, 3])
    expect(result.manualExcluded).toEqual([5])
    expect(result.offsets).toEqual({ 0: 0.5 })
  })

  it('swap: folds the outgoing primary\'s state back in as a per-session facet under its own id', () => {
    const result = swapPrimaryLapState<number>({
      oldPrimaryId: 1,
      newPrimaryId: 2,
      selected: [1, 4],
      manualExcluded: [4],
      offsets: { 1: 0.2 },
      selectedAcrossSessions: [],
      manualExcludedBySession: {},
      sessionLapOffsets: {},
    })

    expect(result.selectedAcrossSessions).toEqual([{ fileId: 1, index: 1 }, { fileId: 1, index: 4 }])
    expect(result.manualExcludedBySession).toEqual({ 1: [4] })
    expect(result.sessionLapOffsets).toEqual({ '1:1': 0.2 })
  })

  it('swap: leaves an UNRELATED comparison recording\'s state untouched', () => {
    const result = swapPrimaryLapState<number>({
      oldPrimaryId: 1,
      newPrimaryId: 2,
      selected: [0],
      manualExcluded: [],
      offsets: {},
      selectedAcrossSessions: [{ fileId: 2, index: 0 }, { fileId: 3, index: 9 }],
      manualExcludedBySession: { 3: [1] },
      sessionLapOffsets: { '3:9': -0.4 },
    })

    expect(result.selectedAcrossSessions).toContainEqual({ fileId: 3, index: 9 })
    expect(result.manualExcludedBySession[3]).toEqual([1])
    expect(result.sessionLapOffsets['3:9']).toBe(-0.4)
  })

  it('swap: does not leave a stale empty manualExcludedBySession entry for the outgoing primary', () => {
    const result = swapPrimaryLapState<number>({
      oldPrimaryId: 1,
      newPrimaryId: 2,
      selected: [],
      manualExcluded: [], // outgoing primary had no manual exclusions
      offsets: {},
      selectedAcrossSessions: [],
      manualExcludedBySession: {},
      sessionLapOffsets: {},
    })

    expect(result.manualExcludedBySession).not.toHaveProperty('1')
  })

  it('promote-only (oldPrimaryId null): discards the outgoing primary\'s state instead of folding it', () => {
    const result = swapPrimaryLapState<number>({
      oldPrimaryId: null,
      newPrimaryId: 2,
      selected: [1, 2], // outgoing primary's own selection — should vanish, not reappear anywhere
      manualExcluded: [2],
      offsets: { 1: 0.3 },
      selectedAcrossSessions: [{ fileId: 2, index: 0 }],
      manualExcludedBySession: {},
      sessionLapOffsets: {},
    })

    expect(result.selected).toEqual([0]) // the NEW primary's own state, not the old one's
    expect(result.manualExcluded).toEqual([])
    expect(result.offsets).toEqual({})
    // The outgoing primary's [1,2]/[2]/{1:0.3} appear nowhere in the result.
    expect(result.selectedAcrossSessions).toEqual([])
    expect(result.manualExcludedBySession).toEqual({})
    expect(result.sessionLapOffsets).toEqual({})
  })

  it('promote-only: an unrelated comparison recording is untouched', () => {
    const result = swapPrimaryLapState<number>({
      oldPrimaryId: null,
      newPrimaryId: 2,
      selected: [],
      manualExcluded: [],
      offsets: {},
      selectedAcrossSessions: [{ fileId: 2, index: 0 }, { fileId: 5, index: 1 }],
      manualExcludedBySession: { 5: [2] },
      sessionLapOffsets: { '5:1': 1.1 },
    })

    expect(result.selectedAcrossSessions).toEqual([{ fileId: 5, index: 1 }])
    expect(result.manualExcludedBySession).toEqual({ 5: [2] })
    expect(result.sessionLapOffsets).toEqual({ '5:1': 1.1 })
  })

  it('round-trips: swapping A<->B then B<->A restores the original state', () => {
    const initial = {
      selected: [0, 1],
      manualExcluded: [1],
      offsets: { 0: 0.1 },
      selectedAcrossSessions: [{ fileId: 2, index: 2 }],
      manualExcludedBySession: { 2: [3] },
      sessionLapOffsets: { '2:2': 0.9 },
    }
    const swapped = swapPrimaryLapState<number>({ oldPrimaryId: 1, newPrimaryId: 2, ...initial })
    const back = swapPrimaryLapState<number>({ oldPrimaryId: 2, newPrimaryId: 1, ...swapped })

    expect(back.selected).toEqual(initial.selected)
    expect(back.manualExcluded).toEqual(initial.manualExcluded)
    expect(back.offsets).toEqual(initial.offsets)
    expect(back.selectedAcrossSessions).toEqual(initial.selectedAcrossSessions)
    expect(back.manualExcludedBySession).toEqual(initial.manualExcludedBySession)
    expect(back.sessionLapOffsets).toEqual(initial.sessionLapOffsets)
  })
})
