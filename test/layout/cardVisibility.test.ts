import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  defaultCardVisibilityPrefs,
  parseCardVisibilityPrefs,
  loadCardVisibilityPrefs,
  saveCardVisibilityPrefs,
  isCardVisible,
  setCardVisible,
  reconcileCardVisibilityPrefs,
  type CardVisibilityPrefs,
} from '@/domain/layout/cardVisibility'

/** Node's test environment has no real localStorage — same stub every other
 *  persistence test in this repo uses (see panelState.test.ts). */
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

describe('parseCardVisibilityPrefs', () => {
  it('returns null for null/missing input', () => {
    expect(parseCardVisibilityPrefs(null)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parseCardVisibilityPrefs('{not valid')).toBeNull()
  })

  it('returns null for valid JSON that is not an object', () => {
    expect(parseCardVisibilityPrefs('[1,2,3]')).toBeNull()
  })

  it('parses a valid prefs blob', () => {
    const prefs = { shown: ['cvtdynamics'], hidden: ['sectors'] }
    expect(parseCardVisibilityPrefs(JSON.stringify(prefs))).toEqual(prefs)
  })

  it('defaults missing/malformed fields to empty arrays', () => {
    expect(parseCardVisibilityPrefs(JSON.stringify({}))).toEqual({ shown: [], hidden: [] })
    expect(parseCardVisibilityPrefs(JSON.stringify({ shown: 'nope', hidden: 5 }))).toEqual({
      shown: [],
      hidden: [],
    })
  })

  it('de-dups and drops non-string entries', () => {
    expect(
      parseCardVisibilityPrefs(JSON.stringify({ shown: ['a', 'a', 1, null], hidden: [] })),
    ).toEqual({ shown: ['a'], hidden: [] })
  })
})

describe('loadCardVisibilityPrefs / saveCardVisibilityPrefs', () => {
  it('loads the default when nothing is persisted', () => {
    expect(loadCardVisibilityPrefs()).toEqual(defaultCardVisibilityPrefs())
  })

  it('round-trips through localStorage', () => {
    const prefs: CardVisibilityPrefs = { shown: ['map'], hidden: ['sectors'] }
    saveCardVisibilityPrefs(prefs)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(prefs)
    expect(loadCardVisibilityPrefs()).toEqual(prefs)
  })
})

describe('isCardVisible', () => {
  const prefs: CardVisibilityPrefs = { shown: ['cvtdynamics'], hidden: ['sectors'] }

  it('an explicit hide always wins, regardless of hasData', () => {
    expect(isCardVisible(prefs, 'sectors', true)).toBe(false)
  })

  it('an explicit show always wins, regardless of hasData', () => {
    expect(isCardVisible(prefs, 'cvtdynamics', false)).toBe(true)
  })

  it('falls back to hasData when no explicit choice exists', () => {
    expect(isCardVisible(prefs, 'map', true)).toBe(true)
    expect(isCardVisible(prefs, 'map', false)).toBe(false)
  })
})

describe('setCardVisible', () => {
  it('records an explicit show, removing any prior hide', () => {
    const prefs: CardVisibilityPrefs = { shown: [], hidden: ['map'] }
    const next = setCardVisible(prefs, 'map', true)
    expect(next).toEqual({ shown: ['map'], hidden: [] })
  })

  it('records an explicit hide, removing any prior show', () => {
    const prefs: CardVisibilityPrefs = { shown: ['map'], hidden: [] }
    const next = setCardVisible(prefs, 'map', false)
    expect(next).toEqual({ shown: [], hidden: ['map'] })
  })

  it('is a same-reference no-op when already explicitly that value', () => {
    const prefs: CardVisibilityPrefs = { shown: ['map'], hidden: [] }
    expect(setCardVisible(prefs, 'map', true)).toBe(prefs)
  })
})

describe('reconcileCardVisibilityPrefs', () => {
  it('drops entries for ids no longer present', () => {
    const prefs: CardVisibilityPrefs = { shown: ['chart-1'], hidden: ['chart-2'] }
    expect(reconcileCardVisibilityPrefs(prefs, ['chart-1'])).toEqual({
      shown: ['chart-1'],
      hidden: [],
    })
  })

  it('returns the same reference when nothing changes', () => {
    const prefs: CardVisibilityPrefs = { shown: ['map'], hidden: [] }
    expect(reconcileCardVisibilityPrefs(prefs, ['map', 'sectors'])).toBe(prefs)
  })
})
