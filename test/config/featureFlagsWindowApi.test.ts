// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `window.__flags` (installed by featureFlags.ts's `installWindowFlagsApi`)
 * needs a real `window` global to attach to — this file opts into happy-dom
 * specifically for that, separate from featureFlags.test.ts's node-
 * environment coverage of the session/local storage layers.
 */
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
  vi.resetModules()
  installMemoryLocalStorage()
})

describe('window.__flags console API', () => {
  it('is installed on window as an object', async () => {
    await import('@/config/featureFlags')
    expect(typeof window.__flags).toBe('object')
  })

  it('setting a property overrides isFlagEnabled, beating every other layer', async () => {
    const { isFlagEnabled } = await import('@/config/featureFlags')
    expect(isFlagEnabled('cvtDynamics')).toBe(false)
    ;(window.__flags as Record<string, unknown>).cvtDynamics = true
    expect(isFlagEnabled('cvtDynamics')).toBe(true)
  })

  it('list() returns the fully-resolved snapshot', async () => {
    await import('@/config/featureFlags')
    const flags = window.__flags as { list: () => Record<string, boolean> }
    expect(flags.list()).toEqual({ cvtDynamics: false })
    ;(window.__flags as Record<string, unknown>).cvtDynamics = true
    expect(flags.list()).toEqual({ cvtDynamics: true })
  })

  it('reset(name) clears one in-memory override, falling back to the next layer', async () => {
    const { isFlagEnabled, setLocalFlagOverride } = await import('@/config/featureFlags')
    setLocalFlagOverride('cvtDynamics', true)
    const flags = window.__flags as { reset: (name?: string) => void }
    ;(window.__flags as Record<string, unknown>).cvtDynamics = false
    expect(isFlagEnabled('cvtDynamics')).toBe(false)
    flags.reset('cvtDynamics')
    // Falls back to the persisted local override (true), not the registry default.
    expect(isFlagEnabled('cvtDynamics')).toBe(true)
  })

  it('reset() with no argument clears every in-memory override', async () => {
    const { isFlagEnabled } = await import('@/config/featureFlags')
    ;(window.__flags as Record<string, unknown>).cvtDynamics = true
    expect(isFlagEnabled('cvtDynamics')).toBe(true)
    ;(window.__flags as { reset: () => void }).reset()
    expect(isFlagEnabled('cvtDynamics')).toBe(false)
  })
})
