import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseFfParam, resolveFlagValue, FEATURE_FLAGS, isFeatureFlagName } from '@/config/featureFlags'

/** Node's default test environment has no real storage/location globals —
 *  stub bare (not `window.`-prefixed) globals, same convention every other
 *  persistence test in this repo uses (see panelState.test.ts). */
function installMemoryStorage(): { store: Map<string, string> } {
  let store = new Map<string, string>()
  const impl = {
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
  }
  vi.stubGlobal('localStorage', impl)
  vi.stubGlobal('sessionStorage', { ...impl })
  return { store }
}

describe('FEATURE_FLAGS registry', () => {
  it('registers cvtDynamics, off by default', () => {
    expect(FEATURE_FLAGS.cvtDynamics.default).toBe(false)
    expect(FEATURE_FLAGS.cvtDynamics.labelKey).toBeTruthy()
  })
})

describe('isFeatureFlagName', () => {
  it('accepts a registered flag name', () => {
    expect(isFeatureFlagName('cvtDynamics')).toBe(true)
  })
  it('rejects an unknown name', () => {
    expect(isFeatureFlagName('notARealFlag')).toBe(false)
  })
})

describe('parseFfParam', () => {
  it('returns {} for null/undefined/empty', () => {
    expect(parseFfParam(null)).toEqual({})
    expect(parseFfParam(undefined)).toEqual({})
    expect(parseFfParam('')).toEqual({})
  })

  it('enables a bare flag name', () => {
    expect(parseFfParam('cvtDynamics')).toEqual({ cvtDynamics: true })
  })

  it('disables a flag name prefixed with -', () => {
    expect(parseFfParam('-cvtDynamics')).toEqual({ cvtDynamics: false })
  })

  it('ignores unknown flag names', () => {
    expect(parseFfParam('notARealFlag,cvtDynamics,-alsoNotReal')).toEqual({ cvtDynamics: true })
  })

  it('trims whitespace around comma-separated tokens', () => {
    expect(parseFfParam('  cvtDynamics  ')).toEqual({ cvtDynamics: true })
  })

  it('a later token for the same flag overwrites an earlier one', () => {
    expect(parseFfParam('cvtDynamics,-cvtDynamics')).toEqual({ cvtDynamics: false })
  })
})

describe('resolveFlagValue precedence', () => {
  it('falls back to the registry default when nothing overrides', () => {
    expect(resolveFlagValue({}, false)).toBe(false)
    expect(resolveFlagValue({}, true)).toBe(true)
  })

  it('a persisted local override beats the default', () => {
    expect(resolveFlagValue({ localOverride: true }, false)).toBe(true)
    expect(resolveFlagValue({ localOverride: false }, true)).toBe(false)
  })

  it('a session (?ff=) override beats a persisted local override', () => {
    expect(resolveFlagValue({ localOverride: false, sessionOverride: true }, false)).toBe(true)
    expect(resolveFlagValue({ localOverride: true, sessionOverride: false }, false)).toBe(false)
  })

  it('a window (console) override beats every other layer', () => {
    expect(
      resolveFlagValue({ localOverride: true, sessionOverride: false, windowOverride: false }, true),
    ).toBe(false)
    expect(
      resolveFlagValue({ localOverride: false, sessionOverride: false, windowOverride: true }, false),
    ).toBe(true)
  })
})

/**
 * Integration coverage for the real module's layering (local/session storage
 * + registry default). The module reads its storage/URL layers ONCE at
 * import time, so each scenario needs a fresh module instance — set up the
 * stubbed globals BEFORE the dynamic import, then `vi.resetModules()` before
 * the next one. `window.__flags` itself needs a real `window` global (not
 * available under this file's default `node` environment) — that layer's
 * Proxy behaviour is covered separately in featureFlagsWindowApi.test.ts.
 */
describe('isFlagEnabled — module integration', () => {
  beforeEach(() => {
    vi.resetModules()
    installMemoryStorage()
    vi.stubGlobal('location', { search: '' })
  })

  it('resolves to the registry default with no overrides', async () => {
    const { isFlagEnabled } = await import('@/config/featureFlags')
    expect(isFlagEnabled('cvtDynamics')).toBe(false)
  })

  it('a persisted localStorage override wins over the default', async () => {
    localStorage.setItem('tracklogstudio.featureFlags.v1', JSON.stringify({ cvtDynamics: true }))
    const { isFlagEnabled } = await import('@/config/featureFlags')
    expect(isFlagEnabled('cvtDynamics')).toBe(true)
  })

  it('a ?ff= query override wins over a persisted localStorage override', async () => {
    localStorage.setItem('tracklogstudio.featureFlags.v1', JSON.stringify({ cvtDynamics: true }))
    vi.stubGlobal('location', { search: '?ff=-cvtDynamics' })
    const { isFlagEnabled } = await import('@/config/featureFlags')
    expect(isFlagEnabled('cvtDynamics')).toBe(false)
  })

  it('a ?ff= override survives a later import with the query string gone (per-tab sessionStorage)', async () => {
    vi.stubGlobal('location', { search: '?ff=cvtDynamics' })
    const first = await import('@/config/featureFlags')
    expect(first.isFlagEnabled('cvtDynamics')).toBe(true)

    vi.resetModules()
    vi.stubGlobal('location', { search: '' }) // in-app nav dropped the query string
    const second = await import('@/config/featureFlags')
    expect(second.isFlagEnabled('cvtDynamics')).toBe(true)
  })

  it('setLocalFlagOverride persists and getLocalFlagOverride reflects it', async () => {
    const { setLocalFlagOverride, getLocalFlagOverride, isFlagEnabled } = await import(
      '@/config/featureFlags'
    )
    expect(getLocalFlagOverride('cvtDynamics')).toBeUndefined()
    setLocalFlagOverride('cvtDynamics', true)
    expect(getLocalFlagOverride('cvtDynamics')).toBe(true)
    expect(isFlagEnabled('cvtDynamics')).toBe(true)
    expect(JSON.parse(localStorage.getItem('tracklogstudio.featureFlags.v1')!)).toEqual({
      cvtDynamics: true,
    })

    setLocalFlagOverride('cvtDynamics', null)
    expect(getLocalFlagOverride('cvtDynamics')).toBeUndefined()
    expect(isFlagEnabled('cvtDynamics')).toBe(false)
  })
})
