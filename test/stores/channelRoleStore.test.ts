import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { useChannelRoleStore, sanitizeChannelRoleOverrides } from '@/stores/channelRoleStore'

const STORAGE_KEY = 'tracklogstudio.channelRoles.v1'

/** Same in-memory localStorage stub `settingsStore.test.ts` uses. */
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
  setActivePinia(createPinia())
})

describe('sanitizeChannelRoleOverrides — malformed input rejection', () => {
  it('rejects non-object input', () => {
    expect(sanitizeChannelRoleOverrides(null)).toEqual({})
    expect(sanitizeChannelRoleOverrides(undefined)).toEqual({})
    expect(sanitizeChannelRoleOverrides('EngineRPM_rpm')).toEqual({})
    expect(sanitizeChannelRoleOverrides(42)).toEqual({})
    expect(sanitizeChannelRoleOverrides(['rpm'])).toEqual({})
  })

  it('accepts a well-formed payload', () => {
    expect(sanitizeChannelRoleOverrides({ EngineRPM_rpm: 'rpm', GearPRND: 'gear' })).toEqual({
      EngineRPM_rpm: 'rpm',
      GearPRND: 'gear',
    })
  })

  it('drops entries with an unrecognised role value', () => {
    expect(sanitizeChannelRoleOverrides({ EngineRPM_rpm: 'not-a-role' })).toEqual({})
    expect(sanitizeChannelRoleOverrides({ EngineRPM_rpm: 123 })).toEqual({})
    expect(sanitizeChannelRoleOverrides({ EngineRPM_rpm: null })).toEqual({})
    expect(sanitizeChannelRoleOverrides({ EngineRPM_rpm: { role: 'rpm' } })).toEqual({})
  })

  it('drops an oversized channel-name key rather than throwing', () => {
    const longName = 'x'.repeat(300)
    expect(sanitizeChannelRoleOverrides({ [longName]: 'rpm' })).toEqual({})
  })

  it('drops an empty-string key', () => {
    expect(sanitizeChannelRoleOverrides({ '': 'rpm' })).toEqual({})
  })

  it('caps the total entry count rather than accepting an unbounded payload', () => {
    const huge: Record<string, string> = {}
    for (let i = 0; i < 1000; i++) huge[`channel_${i}`] = 'rpm'
    const result = sanitizeChannelRoleOverrides(huge)
    expect(Object.keys(result).length).toBeLessThanOrEqual(512)
  })

  it('keeps well-formed entries even when some sibling entries are malformed', () => {
    expect(
      sanitizeChannelRoleOverrides({
        EngineRPM_rpm: 'rpm',
        bogus: 'not-a-role',
        [123 as unknown as string]: 'speed', // numeric key coerces to string '123' by JS object literal
      }),
    ).toEqual({ EngineRPM_rpm: 'rpm', '123': 'speed' })
  })
})

describe('useChannelRoleStore', () => {
  it('starts empty when nothing is persisted', () => {
    const store = useChannelRoleStore()
    expect(store.overrides).toEqual({})
  })

  it('loads a sanitized persisted payload on init', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ EngineRPM_rpm: 'rpm', bogus: 'nope' }))
    const store = useChannelRoleStore()
    expect(store.overrides).toEqual({ EngineRPM_rpm: 'rpm' })
  })

  it('falls back to empty on corrupt JSON rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(() => useChannelRoleStore()).not.toThrow()
    expect(useChannelRoleStore().overrides).toEqual({})
  })

  it('setOverride adds/replaces a mapping and persists it', async () => {
    const store = useChannelRoleStore()
    store.setOverride('EngineRPM_rpm', 'rpm')
    expect(store.overrides).toEqual({ EngineRPM_rpm: 'rpm' })
    store.setOverride('EngineRPM_rpm', 'speed')
    expect(store.overrides).toEqual({ EngineRPM_rpm: 'speed' })
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ EngineRPM_rpm: 'speed' })
  })

  it('setOverride ignores a blank/whitespace-only channel name', () => {
    const store = useChannelRoleStore()
    store.setOverride('   ', 'rpm')
    expect(store.overrides).toEqual({})
  })

  it('clearOverride removes a mapping', () => {
    const store = useChannelRoleStore()
    store.setOverride('EngineRPM_rpm', 'rpm')
    store.clearOverride('EngineRPM_rpm')
    expect(store.overrides).toEqual({})
  })

  it('setOverride assigns a fresh object reference each time (cache-key friendliness)', () => {
    const store = useChannelRoleStore()
    const before = store.overrides
    store.setOverride('EngineRPM_rpm', 'rpm')
    expect(store.overrides).not.toBe(before)
  })

  it('roleFor reflects the current mapping, or null when unmapped', () => {
    const store = useChannelRoleStore()
    expect(store.roleFor('EngineRPM_rpm')).toBeNull()
    store.setOverride('EngineRPM_rpm', 'rpm')
    expect(store.roleFor('EngineRPM_rpm')).toBe('rpm')
  })
})
