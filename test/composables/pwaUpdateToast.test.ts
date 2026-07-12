import { describe, it, expect } from 'vitest'
import { activePwaToast, type PwaToastFlags } from '@/composables/pwaUpdateToast'

function flags(overrides: Partial<PwaToastFlags> = {}): PwaToastFlags {
  return {
    needRefresh: false,
    offlineReady: false,
    needRefreshDismissed: false,
    offlineReadyDismissed: false,
    ...overrides,
  }
}

describe('activePwaToast', () => {
  it('shows nothing when neither signal is pending', () => {
    expect(activePwaToast(flags())).toBeNull()
  })

  it('shows "update" when a new service worker is waiting', () => {
    expect(activePwaToast(flags({ needRefresh: true }))).toBe('update')
  })

  it('shows "offline-ready" once the first install finishes precaching', () => {
    expect(activePwaToast(flags({ offlineReady: true }))).toBe('offline-ready')
  })

  it('prioritises "update" over "offline-ready" when both are pending — the actionable one wins', () => {
    expect(activePwaToast(flags({ needRefresh: true, offlineReady: true }))).toBe('update')
  })

  it('hides "update" once dismissed, independently of offlineReady', () => {
    expect(
      activePwaToast(flags({ needRefresh: true, needRefreshDismissed: true })),
    ).toBeNull()
  })

  it('hides "offline-ready" once dismissed', () => {
    expect(
      activePwaToast(flags({ offlineReady: true, offlineReadyDismissed: true })),
    ).toBeNull()
  })

  it('dismissing offline-ready does not suppress a later update toast', () => {
    const dismissedOfflineReady = flags({
      offlineReady: true,
      offlineReadyDismissed: true,
    })
    expect(activePwaToast(dismissedOfflineReady)).toBeNull()

    // A new deploy arrives afterwards — needRefresh flips true independently.
    const thenUpdateArrives = { ...dismissedOfflineReady, needRefresh: true }
    expect(activePwaToast(thenUpdateArrives)).toBe('update')
  })

  it('dismissing update does not suppress a still-pending offline-ready toast underneath it', () => {
    const result = activePwaToast(
      flags({ needRefresh: true, needRefreshDismissed: true, offlineReady: true }),
    )
    expect(result).toBe('offline-ready')
  })
})
