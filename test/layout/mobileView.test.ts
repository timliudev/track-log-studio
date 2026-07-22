import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  defaultMobileView,
  DEFAULT_MOBILE_VIEW,
  sanitizeMobileView,
  loadMobileView,
  saveMobileView,
  reconcileMobileView,
  setMode,
  setFocusOrder,
  resolveFocusStackOrder,
  weightFor,
  setSplitWeight,
  type MobileViewState,
} from '@/domain/layout/mobileView'

/** Node's test environment has no real localStorage (Vitest runs with
 *  `environment: 'node'`), so stub an in-memory implementation — same
 *  approach panelState.test.ts / cardVisibility.test.ts use. */
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

describe('defaultMobileView / DEFAULT_MOBILE_VIEW', () => {
  it('is focus mode, no explicit order, no split weights', () => {
    expect(defaultMobileView()).toEqual({ mode: 'focus', focusOrder: [], splitWeights: {} })
  })

  it('the exported constant matches the factory default', () => {
    expect(DEFAULT_MOBILE_VIEW).toEqual(defaultMobileView())
  })
})

describe('sanitizeMobileView', () => {
  it('returns the default for null/undefined/non-object input', () => {
    expect(sanitizeMobileView(null)).toEqual(defaultMobileView())
    expect(sanitizeMobileView(undefined)).toEqual(defaultMobileView())
    expect(sanitizeMobileView('nope')).toEqual(defaultMobileView())
    expect(sanitizeMobileView(42)).toEqual(defaultMobileView())
  })

  it('returns the default for an array', () => {
    expect(sanitizeMobileView([1, 2, 3])).toEqual(defaultMobileView())
  })

  it('passes through a well-formed state', () => {
    const state = { mode: 'full', focusOrder: ['map', 'gear'], splitWeights: { map: 2 } }
    expect(sanitizeMobileView(state)).toEqual(state)
  })

  it('defaults an invalid mode to focus', () => {
    expect(sanitizeMobileView({ mode: 'bogus' }).mode).toBe('focus')
    expect(sanitizeMobileView({ mode: 123 }).mode).toBe('focus')
    expect(sanitizeMobileView({}).mode).toBe('focus')
  })

  it('accepts mode full verbatim', () => {
    expect(sanitizeMobileView({ mode: 'full' }).mode).toBe('full')
  })

  it('defaults a non-array focusOrder to []', () => {
    expect(sanitizeMobileView({ focusOrder: 'nope' }).focusOrder).toEqual([])
    expect(sanitizeMobileView({ focusOrder: { a: 1 } }).focusOrder).toEqual([])
  })

  it('drops non-string / empty-string entries from focusOrder', () => {
    expect(
      sanitizeMobileView({ focusOrder: ['map', 42, null, '', 'gear', undefined] }).focusOrder,
    ).toEqual(['map', 'gear'])
  })

  it('de-dups focusOrder preserving first occurrence', () => {
    expect(sanitizeMobileView({ focusOrder: ['map', 'gear', 'map', 'gear'] }).focusOrder).toEqual([
      'map',
      'gear',
    ])
  })

  it('defaults a non-object splitWeights to {}', () => {
    expect(sanitizeMobileView({ splitWeights: 'nope' }).splitWeights).toEqual({})
    expect(sanitizeMobileView({ splitWeights: [1, 2] }).splitWeights).toEqual({})
    expect(sanitizeMobileView({ splitWeights: null }).splitWeights).toEqual({})
  })

  it('drops non-finite / zero / negative splitWeights entries', () => {
    expect(
      sanitizeMobileView({
        splitWeights: {
          map: 2,
          gear: 0,
          chart1: -1,
          chart2: Infinity,
          chart3: NaN,
          chart4: 'nope',
          chart5: null,
        },
      }).splitWeights,
    ).toEqual({ map: 2 })
  })

  it('returns a fresh object (not aliasing the input)', () => {
    const raw = { mode: 'full', focusOrder: ['map'], splitWeights: { map: 2 } }
    const sanitized = sanitizeMobileView(raw)
    expect(sanitized).not.toBe(raw)
    sanitized.focusOrder.push('mutated')
    expect(raw.focusOrder).toEqual(['map'])
  })
})

describe('loadMobileView / saveMobileView', () => {
  it('loadMobileView falls back to the default when nothing is persisted', () => {
    expect(loadMobileView()).toEqual(defaultMobileView())
  })

  it('loadMobileView falls back to the default on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    expect(loadMobileView()).toEqual(defaultMobileView())
  })

  it('loadMobileView does not throw when localStorage access itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('access denied')
      },
    })
    expect(loadMobileView()).toEqual(defaultMobileView())
  })

  it('saveMobileView persists, and loadMobileView restores it verbatim', () => {
    const custom: MobileViewState = {
      mode: 'full',
      focusOrder: ['map', 'gear'],
      splitWeights: { map: 1.5 },
    }
    saveMobileView(custom)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(custom)
    expect(loadMobileView()).toEqual(custom)
  })

  it('saveMobileView does not throw when localStorage.setItem fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => saveMobileView(defaultMobileView())).not.toThrow()
  })
})

describe('reconcileMobileView', () => {
  it('drops focusOrder entries whose card no longer exists', () => {
    const state: MobileViewState = {
      mode: 'focus',
      focusOrder: ['map', 'chart-1'],
      splitWeights: {},
    }
    const next = reconcileMobileView(state, ['map'])
    expect(next.focusOrder).toEqual(['map'])
  })

  it('drops splitWeights keys whose card no longer exists', () => {
    const state: MobileViewState = {
      mode: 'focus',
      focusOrder: [],
      splitWeights: { map: 2, gone: 3 },
    }
    const next = reconcileMobileView(state, ['map'])
    expect(next.splitWeights).toEqual({ map: 2 })
  })

  it('keeps mode unchanged', () => {
    const state: MobileViewState = { mode: 'full', focusOrder: [], splitWeights: {} }
    expect(reconcileMobileView(state, []).mode).toBe('full')
  })

  it('never appends missing ids to focusOrder (unlike panelState.mobileOrder)', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: ['map'], splitWeights: {} }
    const next = reconcileMobileView(state, ['map', 'gear', 'chart-1'])
    expect(next.focusOrder).toEqual(['map'])
  })

  it('is stable (same reference) when nothing needs dropping', () => {
    const state: MobileViewState = {
      mode: 'focus',
      focusOrder: ['map', 'gear'],
      splitWeights: { map: 2 },
    }
    expect(reconcileMobileView(state, ['map', 'gear', 'chart-1'])).toBe(state)
  })

  it('handles an empty valid-id set by clearing focusOrder and splitWeights', () => {
    const state: MobileViewState = {
      mode: 'focus',
      focusOrder: ['map', 'gear'],
      splitWeights: { map: 2 },
    }
    const next = reconcileMobileView(state, [])
    expect(next).toEqual({ mode: 'focus', focusOrder: [], splitWeights: {} })
  })
})

describe('setMode', () => {
  it('sets a new mode', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    expect(setMode(state, 'full').mode).toBe('full')
  })

  it('does not mutate the input state', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    setMode(state, 'full')
    expect(state.mode).toBe('focus')
  })

  it('is a same-reference no-op when the mode is unchanged', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    expect(setMode(state, 'focus')).toBe(state)
  })
})

describe('setFocusOrder', () => {
  it('replaces the order, sanitizing non-string/empty/duplicate entries', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    const next = setFocusOrder(state, ['map', 42 as unknown as string, 'map', '', 'gear'])
    expect(next.focusOrder).toEqual(['map', 'gear'])
  })

  it('does not mutate the input state and leaves other fields intact', () => {
    const state: MobileViewState = { mode: 'full', focusOrder: ['a'], splitWeights: { a: 2 } }
    const next = setFocusOrder(state, ['a', 'b'])
    expect(state.focusOrder).toEqual(['a'])
    expect(next.mode).toBe('full')
    expect(next.splitWeights).toEqual({ a: 2 })
  })

  it('returns the SAME state reference when the (sanitized) order is unchanged', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: ['a', 'b'], splitWeights: {} }
    expect(setFocusOrder(state, ['a', 'b'])).toBe(state)
  })

  it('treats a de-dup that yields the current order as unchanged (same ref)', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: ['a', 'b'], splitWeights: {} }
    expect(setFocusOrder(state, ['a', 'b', 'a'])).toBe(state)
  })

  it('returns a NEW reference when the order actually changes', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: ['a', 'b'], splitWeights: {} }
    expect(setFocusOrder(state, ['b', 'a'])).not.toBe(state)
  })
})

describe('resolveFocusStackOrder', () => {
  it('puts explicit-order ids first, then the rest in default order', () => {
    expect(resolveFocusStackOrder(['map', 'gear', 'chart-1'], ['chart-1', 'map'])).toEqual([
      'chart-1',
      'map',
      'gear',
    ])
  })

  it('filters out non-visible focusOrder ids', () => {
    expect(resolveFocusStackOrder(['map', 'gear'], ['chart-9', 'gear'])).toEqual(['gear', 'map'])
  })

  it('falls back to default order entirely when focusOrder is empty', () => {
    expect(resolveFocusStackOrder(['map', 'gear', 'chart-1'], [])).toEqual([
      'map',
      'gear',
      'chart-1',
    ])
  })

  it('never includes an id absent from the visible set', () => {
    const result = resolveFocusStackOrder(['map'], ['map', 'gear', 'chart-1'])
    expect(result).toEqual(['map'])
  })

  it('returns an empty array when nothing is visible', () => {
    expect(resolveFocusStackOrder([], ['map', 'gear'])).toEqual([])
  })
})

describe('weightFor', () => {
  it('returns the persisted weight when finite and > 0', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: { map: 2.5 } }
    expect(weightFor(state, 'map')).toBe(2.5)
  })

  it('falls back to the default fallback (1) when no weight is recorded', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    expect(weightFor(state, 'map')).toBe(1)
  })

  it('accepts a custom fallback', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    expect(weightFor(state, 'map', 3)).toBe(3)
  })

  it('falls back when the stored weight is not finite/positive', () => {
    const state: MobileViewState = {
      mode: 'focus',
      focusOrder: [],
      splitWeights: { map: -1, gear: 0, chart1: Infinity },
    }
    expect(weightFor(state, 'map')).toBe(1)
    expect(weightFor(state, 'gear')).toBe(1)
    expect(weightFor(state, 'chart1')).toBe(1)
  })
})

describe('setSplitWeight', () => {
  it('sets a new weight for an id', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    const next = setSplitWeight(state, 'map', 62)
    expect(next.splitWeights).toEqual({ map: 62 })
  })

  it('does not mutate the input state', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: { map: 55 } }
    setSplitWeight(state, 'map', 70)
    expect(state.splitWeights).toEqual({ map: 55 })
  })

  it('overwrites an existing weight for the same id, leaving others intact', () => {
    const state: MobileViewState = {
      mode: 'focus',
      focusOrder: [],
      splitWeights: { map: 55, chart: 45 },
    }
    const next = setSplitWeight(state, 'map', 62)
    expect(next.splitWeights).toEqual({ map: 62, chart: 45 })
  })

  it('is a same-reference no-op when the weight is unchanged', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: { map: 55 } }
    expect(setSplitWeight(state, 'map', 55)).toBe(state)
  })

  it('ignores non-finite / zero / negative / non-numeric weights (same-reference no-op)', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: { map: 55 } }
    expect(setSplitWeight(state, 'map', NaN)).toBe(state)
    expect(setSplitWeight(state, 'map', Infinity)).toBe(state)
    expect(setSplitWeight(state, 'map', -Infinity)).toBe(state)
    expect(setSplitWeight(state, 'map', 0)).toBe(state)
    expect(setSplitWeight(state, 'map', -1)).toBe(state)
    expect(setSplitWeight(state, 'map', 'nope' as unknown as number)).toBe(state)
  })

  it('leaves mode and focusOrder intact', () => {
    const state: MobileViewState = { mode: 'full', focusOrder: ['map'], splitWeights: {} }
    const next = setSplitWeight(state, 'map', 62)
    expect(next.mode).toBe('full')
    expect(next.focusOrder).toEqual(['map'])
  })

  it('a newly set weight still gets dropped by reconcileMobileView once the id is gone', () => {
    const state: MobileViewState = { mode: 'focus', focusOrder: [], splitWeights: {} }
    const withWeight = setSplitWeight(state, 'chart-9', 30)
    const next = reconcileMobileView(withWeight, ['map'])
    expect(next.splitWeights).toEqual({})
  })
})
