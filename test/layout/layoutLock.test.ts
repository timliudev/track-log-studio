import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  parseLayoutLocked,
  loadLayoutLocked,
  saveLayoutLocked,
} from '@/domain/layout/layoutLock'

/** Node's test environment has no real localStorage (Vitest runs with
 *  `environment: 'node'`), so stub an in-memory implementation — same
 *  approach dashboardLayout.test.ts/panelState.test.ts use. */
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

describe('parseLayoutLocked', () => {
  it('returns null for null/missing input', () => {
    expect(parseLayoutLocked(null)).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parseLayoutLocked('{not valid json')).toBeNull()
  })

  it('returns null for valid JSON that is not a boolean', () => {
    expect(parseLayoutLocked('"true"')).toBeNull()
    expect(parseLayoutLocked('1')).toBeNull()
    expect(parseLayoutLocked('{}')).toBeNull()
  })

  it('parses true and false', () => {
    expect(parseLayoutLocked('true')).toBe(true)
    expect(parseLayoutLocked('false')).toBe(false)
  })
})

describe('loadLayoutLocked / saveLayoutLocked', () => {
  it('defaults to unlocked when nothing is persisted', () => {
    expect(loadLayoutLocked()).toBe(false)
  })

  it('defaults to unlocked on corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    expect(loadLayoutLocked()).toBe(false)
  })

  it('saveLayoutLocked persists, and loadLayoutLocked restores it verbatim', () => {
    saveLayoutLocked(true)
    expect(loadLayoutLocked()).toBe(true)
    saveLayoutLocked(false)
    expect(loadLayoutLocked()).toBe(false)
  })

  it('saveLayoutLocked does not throw when localStorage.setItem fails', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })
    expect(() => saveLayoutLocked(true)).not.toThrow()
  })

  it('loadLayoutLocked does not throw when localStorage access itself throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('access denied')
      },
    })
    expect(loadLayoutLocked()).toBe(false)
  })
})
