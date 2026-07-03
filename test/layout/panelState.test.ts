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
    const state = { collapsed: ['map', 'chart-1'], pinnedId: 'map' }
    expect(parsePanelState(JSON.stringify(state))).toEqual(state)
  })

  it('defaults missing/malformed collapsed to an empty array', () => {
    expect(parsePanelState(JSON.stringify({ pinnedId: null }))).toEqual({
      collapsed: [],
      pinnedId: null,
    })
    expect(parsePanelState(JSON.stringify({ collapsed: 'not-an-array', pinnedId: null }))).toEqual(
      { collapsed: [], pinnedId: null },
    )
  })

  it('filters non-string entries out of collapsed', () => {
    const raw = JSON.stringify({ collapsed: ['map', 42, null, 'chart-2'], pinnedId: null })
    expect(parsePanelState(raw)).toEqual({ collapsed: ['map', 'chart-2'], pinnedId: null })
  })

  it('defaults a non-string pinnedId to null', () => {
    const raw = JSON.stringify({ collapsed: [], pinnedId: 123 })
    expect(parsePanelState(raw)).toEqual({ collapsed: [], pinnedId: null })
  })
})

describe('loadPanelState / savePanelState', () => {
  it('loadPanelState falls back to an empty state when nothing is persisted', () => {
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedId: null })
  })

  it('loadPanelState falls back to an empty state on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedId: null })
  })

  it('savePanelState persists, and loadPanelState restores it verbatim', () => {
    const custom: PanelState = { collapsed: ['gear'], pinnedId: 'map' }
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
    expect(() => savePanelState({ collapsed: [], pinnedId: null })).not.toThrow()
  })

  it('loadPanelState does not throw when localStorage access itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('access denied')
      },
    })
    expect(loadPanelState()).toEqual({ collapsed: [], pinnedId: null })
  })
})

describe('isCollapsed / toggleCollapsed', () => {
  it('isCollapsed is false for an id not in the collapsed list', () => {
    expect(isCollapsed({ collapsed: [], pinnedId: null }, 'map')).toBe(false)
  })

  it('isCollapsed is true for an id in the collapsed list', () => {
    expect(isCollapsed({ collapsed: ['map'], pinnedId: null }, 'map')).toBe(true)
  })

  it('toggleCollapsed collapses an expanded card', () => {
    const state: PanelState = { collapsed: [], pinnedId: null }
    const next = toggleCollapsed(state, 'map')
    expect(next.collapsed).toEqual(['map'])
  })

  it('toggleCollapsed expands a collapsed card', () => {
    const state: PanelState = { collapsed: ['map', 'gear'], pinnedId: null }
    const next = toggleCollapsed(state, 'map')
    expect(next.collapsed).toEqual(['gear'])
  })

  it('toggleCollapsed with an explicit force sets the state directly', () => {
    const state: PanelState = { collapsed: [], pinnedId: null }
    expect(toggleCollapsed(state, 'map', true).collapsed).toEqual(['map'])
    expect(toggleCollapsed(state, 'map', false).collapsed).toEqual([])
  })

  it('toggleCollapsed does not mutate the input state', () => {
    const state: PanelState = { collapsed: [], pinnedId: null }
    toggleCollapsed(state, 'map')
    expect(state.collapsed).toEqual([])
  })

  it('is a no-op (same reference semantics not required, but same value) when force matches current state', () => {
    const state: PanelState = { collapsed: ['map'], pinnedId: null }
    const next = toggleCollapsed(state, 'map', true)
    expect(next).toBe(state)
  })
})

describe('togglePinned (pin exclusivity)', () => {
  it('pins an unpinned card', () => {
    const state: PanelState = { collapsed: [], pinnedId: null }
    expect(togglePinned(state, 'map').pinnedId).toBe('map')
  })

  it('pinning a second card unpins the first (only one card may be pinned)', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'map' }
    const next = togglePinned(state, 'chart-1')
    expect(next.pinnedId).toBe('chart-1')
  })

  it('toggling the already-pinned card unpins it', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'map' }
    expect(togglePinned(state, 'map').pinnedId).toBeNull()
  })

  it('does not mutate the input state', () => {
    const state: PanelState = { collapsed: [], pinnedId: null }
    togglePinned(state, 'map')
    expect(state.pinnedId).toBeNull()
  })
})

describe('reconcilePanelState', () => {
  it('drops a collapsed entry whose card no longer exists', () => {
    const state: PanelState = { collapsed: ['map', 'chart-1'], pinnedId: null }
    const next = reconcilePanelState(state, ['map'])
    expect(next.collapsed).toEqual(['map'])
  })

  it('clears pinnedId when the pinned card no longer exists', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'chart-1' }
    const next = reconcilePanelState(state, ['map'])
    expect(next.pinnedId).toBeNull()
  })

  it('keeps pinnedId when the pinned card still exists', () => {
    const state: PanelState = { collapsed: [], pinnedId: 'map' }
    const next = reconcilePanelState(state, ['map', 'chart-1'])
    expect(next.pinnedId).toBe('map')
  })

  it('is stable (idempotent, same value) when nothing needs dropping', () => {
    const state: PanelState = { collapsed: ['map'], pinnedId: 'map' }
    const next = reconcilePanelState(state, ['map', 'chart-1'])
    expect(next).toEqual(state)
  })

  it('handles an empty valid-id set by clearing everything', () => {
    const state: PanelState = { collapsed: ['map', 'gear'], pinnedId: 'map' }
    const next = reconcilePanelState(state, [])
    expect(next).toEqual({ collapsed: [], pinnedId: null })
  })
})
