import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  parsePanelState,
  loadPanelState,
  savePanelState,
  isCollapsed,
  toggleCollapsed,
  isPinned,
  togglePinned,
  reconcilePanelState,
  reconcileMobileOrder,
  setMobileOrder,
  mergeMobileOrder,
  type PanelState,
} from '@/domain/layout/panelState'

/** Node's test environment has no real localStorage (Vitest runs with
 *  `environment: 'node'`), so stub an in-memory implementation — same
 *  approach dashboardLayout.test.ts uses. */
function installMemoryLocalStorage(): void {
  let store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store = new Map<string, string>()
    },
  })
}

beforeEach(() => {
  installMemoryLocalStorage()
  localStorage.clear()
})

describe('parsePanelState', () => {
  it('returns null for null/missing input', () => {
    expect(parsePanelState(null)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parsePanelState('{not valid json')).toBeNull()
  })

  it('returns null for valid JSON that is not an object', () => {
    expect(parsePanelState('[1,2,3]')).toBeNull()
    expect(parsePanelState('"just a string"')).toBeNull()
  })

  it('parses a valid state', () => {
    const state = { collapsed: ['map', 'chart-1'], pinnedIds: ['map'], mobileOrder: ['map', 'gear'] }
    expect(parsePanelState(JSON.stringify(state))).toEqual(state)
  })

  it('parses multiple pinned ids, preserving order', () => {
    const raw = JSON.stringify({ collapsed: [], pinnedIds: ['map', 'gear', 'chart-1'], mobileOrder: [] })
    expect(parsePanelState(raw)).toEqual({
      collapsed: [],
      pinnedIds: ['map', 'gear', 'chart-1'],
      mobileOrder: [],
    })
  })

  it('defaults missing/malformed collapsed to an empty array', () => {
    expect(parsePanelState(JSON.stringify({ pinnedIds: [], mobileOrder: [] }))).toEqual({
      collapsed: [],
      pinnedIds: [],
      mobileOrder: [],
    })
    expect(parsePanelState(JSON.stringify({ collapsed: 'not-an-array', pinnedIds: [], mobileOrder: [] }))).toEqual(
      { collapsed: [], pinnedIds: [], mobileOrder: [] },
    )
  })

  it('filters non-string entries out of collapsed', () => {
    const raw = JSON.stringify({ collapsed: ['map', 42, null, 'chart-2'], pinnedIds: [], mobileOrder: [] })
    expect(parsePanelState(raw)).toEqual({
      collapsed: ['map', 'chart-2'],
      pinnedIds: [],
      mobileOrder: [],
    })
  })

  it('defaults a missing/malformed pinnedIds to an empty array', () => {
    expect(parsePanelState(JSON.stringify({ collapsed: [], mobileOrder: [] }))).toEqual({
      collapsed: [],
      pinnedIds: [],
      mobileOrder: [],
    })
    expect(
      parsePanelState(JSON.stringify({ collapsed: [], pinnedIds: 'not-an-array', mobileOrder: [] })),
    ).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
  })

  it('filters non-string entries and de-dups pinnedIds', () => {
    const raw = JSON.stringify({
      collapsed: [],
      pinnedIds: ['map', 42, 'map', null, 'gear'],
      mobileOrder: [],
    })
    expect(parsePanelState(raw)).toEqual({
      collapsed: [],
      pinnedIds: ['map', 'gear'],
      mobileOrder: [],
    })
  })

  describe('B111 — legacy single-pin `pinnedId` migration', () => {
    it('migrates an older blob\'s string pinnedId into a one-element pinnedIds list', () => {
      const raw = JSON.stringify({ collapsed: ['map'], pinnedId: 'map', mobileOrder: [] })
      expect(parsePanelState(raw)).toEqual({
        collapsed: ['map'],
        pinnedIds: ['map'],
        mobileOrder: [],
      })
    })

    it('migrates a legacy null pinnedId to an empty pinnedIds list (nothing pinned)', () => {
      const raw = JSON.stringify({ collapsed: [], pinnedId: null, mobileOrder: [] })
      expect(parsePanelState(raw)).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
    })

    it('ignores a garbage (non-string) legacy pinnedId rather than migrating it', () => {
      const raw = JSON.stringify({ collapsed: [], pinnedId: 123, mobileOrder: [] })
      expect(parsePanelState(raw)).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
    })

    it('prefers a present pinnedIds array over a legacy pinnedId field', () => {
      const raw = JSON.stringify({ collapsed: [], pinnedId: 'gear', pinnedIds: ['map'], mobileOrder: [] })
      expect(parsePanelState(raw)).toEqual({ collapsed: [], pinnedIds: ['map'], mobileOrder: [] })
    })
  })

  it('tolerates an older blob with no mobileOrder field (defaults to [])', () => {
    const raw = JSON.stringify({ collapsed: ['map'], pinnedIds: ['map'], mobileOrder: [] })
    expect(parsePanelState(raw)).toEqual({
      collapsed: ['map'],
      pinnedIds: ['map'],
      mobileOrder: [],
    })
  })

  it('filters non-string entries and de-dups mobileOrder', () => {
    const raw = JSON.stringify({
      collapsed: [],
      pinnedIds: [],
      mobileOrder: ['map', 42, 'map', null, 'gear'],
    })
    expect(parsePanelState(raw)).toEqual({
      collapsed: [],
      pinnedIds: [],
      mobileOrder: ['map', 'gear'],
    })
  })

  it('defaults a malformed (non-array) mobileOrder to []', () => {
    const raw = JSON.stringify({ collapsed: [], pinnedIds: [], mobileOrder: 'nope' })
    expect(parsePanelState(raw)).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
  })
})

describe('loadPanelState / savePanelState', () => {
  it('loadPanelState falls back to an empty state when nothing is persisted', () => {
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
  })

  it('loadPanelState falls back to an empty state on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
  })

  it('savePanelState persists, and loadPanelState restores it verbatim', () => {
    const custom: PanelState = { collapsed: ['gear'], pinnedIds: ['map'], mobileOrder: ['map', 'gear'] }
    savePanelState(custom)
    expect(loadPanelState()).toEqual(custom)
  })

  it('loadPanelState migrates a legacy pinnedId blob written directly to storage', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ collapsed: [], pinnedId: 'map', mobileOrder: [] }),
    )
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedIds: ['map'], mobileOrder: [] })
  })

  it('savePanelState does not throw when localStorage.setItem fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => savePanelState({ collapsed: [], pinnedIds: [], mobileOrder: [] })).not.toThrow()
  })

  it('loadPanelState does not throw when localStorage access itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('access denied')
      },
    })
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
  })
})

describe('isCollapsed / toggleCollapsed', () => {
  it('isCollapsed is false for an id not in the collapsed list', () => {
    expect(isCollapsed({ collapsed: [], pinnedIds: [], mobileOrder: [] }, 'map')).toBe(false)
  })

  it('isCollapsed is true for an id in the collapsed list', () => {
    expect(isCollapsed({ collapsed: ['map'], pinnedIds: [], mobileOrder: [] }, 'map')).toBe(true)
  })

  it('toggleCollapsed collapses an expanded card', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: [] }
    const next = toggleCollapsed(state, 'map')
    expect(next.collapsed).toEqual(['map'])
  })

  it('toggleCollapsed expands a collapsed card', () => {
    const state: PanelState = { collapsed: ['map', 'gear'], pinnedIds: [], mobileOrder: [] }
    const next = toggleCollapsed(state, 'map')
    expect(next.collapsed).toEqual(['gear'])
  })

  it('toggleCollapsed with an explicit force sets the state directly', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: [] }
    expect(toggleCollapsed(state, 'map', true).collapsed).toEqual(['map'])
    expect(toggleCollapsed(state, 'map', false).collapsed).toEqual([])
  })

  it('toggleCollapsed does not mutate the input state', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: [] }
    toggleCollapsed(state, 'map')
    expect(state.collapsed).toEqual([])
  })

  it('is a no-op (same reference semantics not required, but same value) when force matches current state', () => {
    const state: PanelState = { collapsed: ['map'], pinnedIds: [], mobileOrder: [] }
    const next = toggleCollapsed(state, 'map', true)
    expect(next).toBe(state)
  })
})

describe('isPinned / togglePinned (B111 — multi-pin stack, was single-pin exclusivity)', () => {
  it('isPinned is false for an id not in pinnedIds', () => {
    expect(isPinned({ collapsed: [], pinnedIds: [], mobileOrder: [] }, 'map')).toBe(false)
  })

  it('isPinned is true for an id in pinnedIds', () => {
    expect(isPinned({ collapsed: [], pinnedIds: ['map', 'gear'], mobileOrder: [] }, 'gear')).toBe(true)
  })

  it('pins an unpinned card (appends to an empty list)', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: [] }
    expect(togglePinned(state, 'map').pinnedIds).toEqual(['map'])
  })

  it('pinning a second card ADDS it rather than replacing the first — both stay pinned', () => {
    const state: PanelState = { collapsed: [], pinnedIds: ['map'], mobileOrder: [] }
    const next = togglePinned(state, 'chart-1')
    expect(next.pinnedIds).toEqual(['map', 'chart-1'])
  })

  it('a third pin appends after the first two, preserving pin order (first pinned stays topmost)', () => {
    const state: PanelState = { collapsed: [], pinnedIds: ['map', 'chart-1'], mobileOrder: [] }
    const next = togglePinned(state, 'gear')
    expect(next.pinnedIds).toEqual(['map', 'chart-1', 'gear'])
  })

  it('toggling an already-pinned card unpins ONLY that card, keeping the others in order', () => {
    const state: PanelState = { collapsed: [], pinnedIds: ['map', 'chart-1', 'gear'], mobileOrder: [] }
    const next = togglePinned(state, 'chart-1')
    expect(next.pinnedIds).toEqual(['map', 'gear'])
  })

  it('unpinning the last remaining pinned card empties pinnedIds', () => {
    const state: PanelState = { collapsed: [], pinnedIds: ['map'], mobileOrder: [] }
    expect(togglePinned(state, 'map').pinnedIds).toEqual([])
  })

  it('does not mutate the input state', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: [] }
    togglePinned(state, 'map')
    expect(state.pinnedIds).toEqual([])
  })
})

describe('reconcilePanelState', () => {
  it('drops a collapsed entry whose card no longer exists', () => {
    const state: PanelState = { collapsed: ['map', 'chart-1'], pinnedIds: [], mobileOrder: [] }
    const next = reconcilePanelState(state, ['map'])
    expect(next.collapsed).toEqual(['map'])
  })

  it('drops a pinned id whose card no longer exists', () => {
    const state: PanelState = { collapsed: [], pinnedIds: ['chart-1'], mobileOrder: [] }
    const next = reconcilePanelState(state, ['map'])
    expect(next.pinnedIds).toEqual([])
  })

  it('keeps a pinned id when its card still exists', () => {
    const state: PanelState = { collapsed: [], pinnedIds: ['map'], mobileOrder: [] }
    const next = reconcilePanelState(state, ['map', 'chart-1'])
    expect(next.pinnedIds).toEqual(['map'])
  })

  it('drops ONE stale pinned id out of several, keeping the rest AND their relative order', () => {
    const state: PanelState = { collapsed: [], pinnedIds: ['map', 'chart-9', 'gear'], mobileOrder: [] }
    const next = reconcilePanelState(state, ['map', 'gear', 'chart-1'])
    expect(next.pinnedIds).toEqual(['map', 'gear'])
  })

  it('is stable (idempotent, same value) when nothing needs dropping', () => {
    const state: PanelState = { collapsed: ['map'], pinnedIds: ['map'], mobileOrder: ['map', 'chart-1'] }
    const next = reconcilePanelState(state, ['map', 'chart-1'])
    expect(next).toEqual(state)
  })

  it('returns the SAME state reference when nothing needs dropping (ref-stable, like setMobileOrder)', () => {
    const state: PanelState = { collapsed: ['map'], pinnedIds: ['map', 'gear'], mobileOrder: ['map', 'gear'] }
    const next = reconcilePanelState(state, ['map', 'gear'])
    expect(next).toBe(state)
  })

  it('handles an empty valid-id set by clearing everything', () => {
    const state: PanelState = { collapsed: ['map', 'gear'], pinnedIds: ['map', 'gear'], mobileOrder: ['map'] }
    const next = reconcilePanelState(state, [])
    expect(next).toEqual({ collapsed: [], pinnedIds: [], mobileOrder: [] })
  })

  it('seeds mobileOrder from validIds when the stored order is empty', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: [] }
    const next = reconcilePanelState(state, ['map', 'gear', 'chart-1'])
    expect(next.mobileOrder).toEqual(['map', 'gear', 'chart-1'])
  })

  it('keeps the user mobile order, drops removed ids, appends new ids at the end', () => {
    const state: PanelState = {
      collapsed: [],
      pinnedIds: [],
      // user reordered: gear before map; chart-9 has since been removed
      mobileOrder: ['gear', 'chart-9', 'map'],
    }
    const next = reconcilePanelState(state, ['map', 'gear', 'chart-1'])
    // gear/map kept in the user's order, chart-9 dropped, chart-1 appended
    expect(next.mobileOrder).toEqual(['gear', 'map', 'chart-1'])
  })
})

describe('reconcileMobileOrder', () => {
  it('seeds from the canonical order when nothing is stored', () => {
    expect(reconcileMobileOrder([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('keeps stored order for surviving ids, drops removed, appends new at end', () => {
    expect(reconcileMobileOrder(['c', 'a'], ['a', 'b', 'c'])).toEqual(['c', 'a', 'b'])
  })

  it('drops ids no longer present', () => {
    expect(reconcileMobileOrder(['a', 'gone', 'b'], ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('setMobileOrder', () => {
  it('replaces the order and de-dups defensively', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: ['a'] }
    expect(setMobileOrder(state, ['b', 'a', 'b']).mobileOrder).toEqual(['b', 'a'])
  })

  it('does not mutate the input state and leaves other fields intact', () => {
    const state: PanelState = { collapsed: ['x'], pinnedIds: ['x'], mobileOrder: ['a'] }
    const next = setMobileOrder(state, ['a', 'b'])
    expect(state.mobileOrder).toEqual(['a'])
    expect(next.collapsed).toEqual(['x'])
    expect(next.pinnedIds).toEqual(['x'])
  })

  // #11 — same-reference guard breaks the breakpoint-switch recursion loop.
  it('returns the SAME state reference when the order is unchanged', () => {
    const state: PanelState = { collapsed: ['x'], pinnedIds: ['x'], mobileOrder: ['a', 'b'] }
    expect(setMobileOrder(state, ['a', 'b'])).toBe(state)
  })

  it('treats a de-dup that yields the current order as unchanged (same ref)', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: ['a', 'b'] }
    expect(setMobileOrder(state, ['a', 'b', 'a'])).toBe(state)
  })

  it('returns a NEW reference when the order actually changes', () => {
    const state: PanelState = { collapsed: [], pinnedIds: [], mobileOrder: ['a', 'b'] }
    expect(setMobileOrder(state, ['b', 'a'])).not.toBe(state)
  })
})

describe('mergeMobileOrder (B112 — a pinned/hidden id keeps its exact array slot)', () => {
  it('substitutes the re-ordered ids in place, leaving an excluded id at its own slot', () => {
    // b is pinned (excluded from `next`, the grid's re-ordered emission of
    // just a and c) — it must stay exactly between a and c, not get bumped
    // to the end.
    const base = ['a', 'b', 'c']
    const next = ['c', 'a'] // a and c swapped
    expect(mergeMobileOrder(base, next)).toEqual(['c', 'b', 'a'])
  })

  it('is a no-op when next is already in the same relative order', () => {
    const base = ['a', 'b', 'c']
    expect(mergeMobileOrder(base, ['a', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('supports more than one excluded id, each keeping its own slot', () => {
    const base = ['a', 'b', 'c', 'd', 'e']
    // b and d are pinned/hidden; a, c, e get reordered to [e, c, a].
    const next = ['e', 'c', 'a']
    expect(mergeMobileOrder(base, next)).toEqual(['e', 'b', 'c', 'd', 'a'])
  })

  it('appends an id from next that is not present in base at all (defensive — should not normally happen)', () => {
    const base = ['a', 'b']
    const next = ['a', 'b', 'new']
    expect(mergeMobileOrder(base, next)).toEqual(['a', 'b', 'new'])
  })

  it('handles every id being excluded (next empty) as a full no-op', () => {
    const base = ['a', 'b', 'c']
    expect(mergeMobileOrder(base, [])).toEqual(['a', 'b', 'c'])
  })
})
