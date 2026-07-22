import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEY,
  REVEAL_TAP_COUNT,
  loadDevOptionsRevealed,
  saveDevOptionsRevealed,
} from '@/domain/settings/devOptionsReveal'

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

describe('devOptionsReveal', () => {
  it('defaults to not revealed', () => {
    expect(loadDevOptionsRevealed()).toBe(false)
  })

  it('persists true/false across load calls', () => {
    saveDevOptionsRevealed(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
    expect(loadDevOptionsRevealed()).toBe(true)
    saveDevOptionsRevealed(false)
    expect(loadDevOptionsRevealed()).toBe(false)
  })

  it('requires 7 taps by convention', () => {
    expect(REVEAL_TAP_COUNT).toBe(7)
  })
})
