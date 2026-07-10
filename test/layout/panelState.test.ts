import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  parsePanelState,
  loadPanelState,
  savePanelState,
  isCollapsed,
  toggleCollapsed,
  togglePinned,
  reconcilePanelState,
  reconcileMobileOrder,
  setMobileOrder,
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
    const state = { collapsed: ['map', 'chart-1'], pinnedId: 'map', mobileOrder: ['map', 'gear'] }
    expect(parsePanelState(JSON.stringify(state))).toEqual(state)
  })

  it('defaults missing/malformed collapsed to an empty array', () => {
    expect(parsePanelState(JSON.stringify({ pinnedId: null, mobileOrder: [] }))).toEqual({
      collapsed: [],
      pinnedId: null,
      mobileOrder: [],
    })
    expect(parsePanelState(JSON.stringify({ collapsed: 'not-an-array', pinnedId: null, mobileOrder: [] }))).toEqual(
      { collapsed: [], pinnedId: null, mobileOrder: [] },
    )
  })

  it('filters non-string entries out of collapsed', () => {
    const raw = JSON.stringify({ collapsed: ['map', 42, null, 'chart-2'], pinnedId: null, mobileOrder: [] })
    expect(parsePanelState(raw)).toEqual({
      collapsed: ['map', 'chart-2'],
      pinnedId: null,
      mobileOrder: [],
    })
  })

  it('defaults a non-string pinnedId to null', () => {
    const raw = JSON.stringify({ collapsed: [], pinnedId: 123, mobileOrder: [] })
    expect(parsePanelState(raw)).toEqual({ collapsed: [], pinnedId: null, mobileOrder: [] })
  })

  it('tolerates an older blob with no mobileOrder field (defaults to [])', () => {
    const raw = JSON.stringify({ collapsed: ['map'], pinnedId: 'map', mobileOrder: [] })
    expect(parsePanelState(raw)).toEqual({
      collapsed: ['map'],
      pinnedId: 'map',
      mobileOrder: [],
    })
  })

  it('filters non-string entries and de-dups mobileOrder', () => {
    const raw = JSON.stringify({
      collapsed: [],
      pinnedId: null,
      mobileOrder: ['map', 42, 'map', null, 'gear'],
    })
    expect(parsePanelState(raw)).toEqual({
      collapsed: [],
      pinnedId: null,
      mobileOrder: ['map', 'gear'],
    })
  })

  it('defaults a malformed (non-array) mobileOrder to []', () => {
    const raw = JSON.stringify({ collapsed: [], pinnedId: null, mobileOrder: 'nope' })
    expect(parsePanelState(raw)).toEqual({ collapsed: [], pinnedId: null, mobileOrder: [] })
  })
})

describe('loadPanelState / savePanelState', () => {
  it('loadPanelState falls back to an empty state when nothing is persisted', () => {
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedId: null, mobileOrder: [] })
  })

  it('loadPanelState falls back to an empty state on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedId: null, mobileOrder: [] })
  })

  it('savePanelState persists, and loadPanelState restores it verbatim', () => {
    const custom: PanelState = { collapsed: ['gear'], pinnedId: 'map', mobileOrder: ['map', 'gear'] }
    savePanelState(custom)
    expect(loadPanelState()).toEqual(custom)
  })

  it('savePanelState does not throw when localStorage.setItem fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => savePanelState({ collapsed: [], pinnedId: null, mobileOrder: [] })).not.toThrow()
  })

  it('loadPanelState does not throw when localStorage access itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('access denied')
      },
    })
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedId: null, mobileOrder: [] })
  })
})

describe('isCollapsed / toggleCollapsed', () => {
  it('isCollapsed is false for an id not in the collapsed list', () => {
    expect(isCollapsed({ collapsed: [], pinnedId: null, mobileOrder: [] }, 'map')).toBe(false)
  })

  it('isCollapsed is true for an id in the collapsed list', () => {
    expect(isCollapsed({ collapsed: ['map'], pinnedId: null, mobileOrder: [] }, 'map')).toBe(true)
  })

  it('toggleCollapsed collapses an expanded card', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: [] }
    const next = toggleCollapsed(state, 'map')
    expect(next.collapsed).toEqual(['map'])
  })

  it('toggleCollapsed expands a collapsed card', () => {
    const state: PanelState = { collapsed: ['map', 'gear'], pinnedId: null, mobileOrder: [] }
    const next = toggleCollapsed(state, 'map')
    expect(next.collapsed).toEqual(['gear'])
  })

  it('toggleCollapsed with an explicit force sets the state directly', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: [] }
    expect(toggleCollapsed(state, 'map', true).collapsed).toEqual(['map'])
    expect(toggleCollapsed(state, 'map', false).collapsed).toEqual([])
  })

  it('toggleCollapsed does not mutate the input state', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: [] }
    toggleCollapsed(state, 'map')
    expect(state.collapsed).toEqual([])
  })

  it('is a no-op (same reference semantics not required, but same value) when force matches current state', () => {
    const state: PanelState = { collapsed: ['map'], pinnedId: null, mobileOrder: [] }
    const next = toggleCollapsed(state, 'map', true)
    expect(next).toBe(state)
  })
})

describe('togglePinned (pin exclusivity)', () => {
  it('pins an unpinned card', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: [] }
    expect(togglePinned(state, 'map').pinnedId).toBe('map')
  })

  it('pinning a second card unpins the first (only one card may be pinned)', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'map', mobileOrder: [] }
    const next = togglePinned(state, 'chart-1')
    expect(next.pinnedId).toBe('chart-1')
  })

  it('toggling the already-pinned card unpins it', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'map', mobileOrder: [] }
    expect(togglePinned(state, 'map').pinnedId).toBeNull()
  })

  it('does not mutate the input state', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: [] }
    togglePinned(state, 'map')
    expect(state.pinnedId).toBeNull()
  })
})

describe('reconcilePanelState', () => {
  it('drops a collapsed entry whose card no longer exists', () => {
    const state: PanelState = { collapsed: ['map', 'chart-1'], pinnedId: null, mobileOrder: [] }
    const next = reconcilePanelState(state, ['map'])
    expect(next.collapsed).toEqual(['map'])
  })

  it('clears pinnedId when the pinned card no longer exists', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'chart-1', mobileOrder: [] }
    const next = reconcilePanelState(state, ['map'])
    expect(next.pinnedId).toBeNull()
  })

  it('keeps pinnedId when the pinned card still exists', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'map', mobileOrder: [] }
    const next = reconcilePanelState(state, ['map', 'chart-1'])
    expect(next.pinnedId).toBe('map')
  })

  it('is stable (idempotent, same value) when nothing needs dropping', () => {
    const state: PanelState = { collapsed: ['map'], pinnedId: 'map', mobileOrder: ['map', 'chart-1'] }
    const next = reconcilePanelState(state, ['map', 'chart-1'])
    expect(next).toEqual(state)
  })

  it('handles an empty valid-id set by clearing everything', () => {
    const state: PanelState = { collapsed: ['map', 'gear'], pinnedId: 'map', mobileOrder: ['map'] }
    const next = reconcilePanelState(state, [])
    expect(next).toEqual({ collapsed: [], pinnedId: null, mobileOrder: [] })
  })

  it('seeds mobileOrder from validIds when the stored order is empty', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: [] }
    const next = reconcilePanelState(state, ['map', 'gear', 'chart-1'])
    expect(next.mobileOrder).toEqual(['map', 'gear', 'chart-1'])
  })

  it('keeps the user mobile order, drops removed ids, appends new ids at the end', () => {
    const state: PanelState = {
      collapsed: [],
      pinnedId: null,
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
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: ['a'] }
    expect(setMobileOrder(state, ['b', 'a', 'b']).mobileOrder).toEqual(['b', 'a'])
  })

  it('does not mutate the input state and leaves other fields intact', () => {
    const state: PanelState = { collapsed: ['x'], pinnedId: 'x', mobileOrder: ['a'] }
    const next = setMobileOrder(state, ['a', 'b'])
    expect(state.mobileOrder).toEqual(['a'])
    expect(next.collapsed).toEqual(['x'])
    expect(next.pinnedId).toBe('x')
  })

  // #11 — same-reference guard breaks the breakpoint-switch recursion loop.
  it('returns the SAME state reference when the order is unchanged', () => {
    const state: PanelState = { collapsed: ['x'], pinnedId: 'x', mobileOrder: ['a', 'b'] }
    expect(setMobileOrder(state, ['a', 'b'])).toBe(state)
  })

  it('treats a de-dup that yields the current order as unchanged (same ref)', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: ['a', 'b'] }
    expect(setMobileOrder(state, ['a', 'b', 'a'])).toBe(state)
  })

  it('returns a NEW reference when the order actually changes', () => {
    const state: PanelState = { collapsed: [], pinnedId: null, mobileOrder: ['a', 'b'] }
    expect(setMobileOrder(state, ['b', 'a'])).not.toBe(state)
  })
})
