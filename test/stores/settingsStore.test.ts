import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  useSettingsStore,
  mergeAppearanceSettings,
  defaultAppearanceSettings,
} from '@/stores/settingsStore'

const STORAGE_KEY = 'aracer-loga.settings.v1'

/** Node's test environment has no real localStorage — same in-memory stub
 *  pattern other persistence tests in this repo use. */
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

describe('mergeAppearanceSettings (B19 shared sanitizer)', () => {
  it('falls back to the default for an empty/undefined payload', () => {
    expect(mergeAppearanceSettings(undefined)).toEqual(defaultAppearanceSettings())
    expect(mergeAppearanceSettings(null)).toEqual(defaultAppearanceSettings())
  })

  it('accepts every valid field', () => {
    expect(
      mergeAppearanceSettings({
        themePref: 'dark',
        localePref: 'en',
        tzOverride: 480,
        inputModePref: 'touch',
        centreCursorMode: true,
      }),
    ).toEqual({
      themePref: 'dark',
      localePref: 'en',
      tzOverride: 480,
      inputModePref: 'touch',
      centreCursorMode: true,
    })
  })

  it('sanitizes an invalid field to its default without rejecting the others', () => {
    expect(
      mergeAppearanceSettings({
        themePref: 'not-a-theme' as never,
        localePref: 'en',
        tzOverride: 60,
        inputModePref: 'not-a-mode' as never,
        centreCursorMode: 'not-a-bool' as never,
      }),
    ).toEqual({ themePref: 'auto', localePref: 'en', tzOverride: 60, inputModePref: 'auto', centreCursorMode: false })
  })

  it('accepts a boolean centreCursorMode and rejects non-boolean garbage to its default', () => {
    expect(mergeAppearanceSettings({ centreCursorMode: true }).centreCursorMode).toBe(true)
    expect(mergeAppearanceSettings({ centreCursorMode: false }).centreCursorMode).toBe(false)
    expect(mergeAppearanceSettings({ centreCursorMode: 'yes' as never }).centreCursorMode).toBe(false)
  })

  it('accepts tzOverride: "auto" as well as a number', () => {
    expect(mergeAppearanceSettings({ tzOverride: 'auto' }).tzOverride).toBe('auto')
    expect(mergeAppearanceSettings({ tzOverride: -300 }).tzOverride).toBe(-300)
    expect(mergeAppearanceSettings({ tzOverride: 'nonsense' as never }).tzOverride).toBe('auto')
  })
})

describe('settingsStore persistence', () => {
  it('defaults to auto/auto/auto/auto/false when nothing is persisted', () => {
    const s = useSettingsStore()
    expect(s.themePref).toBe('auto')
    expect(s.localePref).toBe('auto')
    expect(s.tzOverride).toBe('auto')
    expect(s.inputModePref).toBe('auto')
    expect(s.centreCursorMode).toBe(false)
  })

  it('auto-saves changes to localStorage', async () => {
    const s = useSettingsStore()
    s.themePref = 'dark'
    s.tzOverride = 480
    await nextTick()
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw as string)
    expect(data.themePref).toBe('dark')
    expect(data.tzOverride).toBe(480)
  })

  it('restores persisted state on next store init (reload simulation)', async () => {
    const s1 = useSettingsStore()
    s1.themePref = 'light'
    s1.localePref = 'en'
    await nextTick()

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    expect(s2.themePref).toBe('light')
    expect(s2.localePref).toBe('en')
  })

  it('falls back to defaults when persisted JSON is corrupt', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json')
    const s = useSettingsStore()
    expect(s.themePref).toBe('auto')
  })

  it('applyAppearance (B19 import) replaces all five fields and persists once', async () => {
    const s = useSettingsStore()
    s.applyAppearance({
      themePref: 'dark',
      localePref: 'en',
      tzOverride: 60,
      inputModePref: 'pointer',
      centreCursorMode: true,
    })
    expect(s.themePref).toBe('dark')
    expect(s.localePref).toBe('en')
    expect(s.tzOverride).toBe(60)
    expect(s.inputModePref).toBe('pointer')
    expect(s.centreCursorMode).toBe(true)

    await nextTick()
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(JSON.parse(raw as string)).toEqual({
      themePref: 'dark',
      localePref: 'en',
      tzOverride: 60,
      inputModePref: 'pointer',
      centreCursorMode: true,
    })
  })

  it('centreCursorMode auto-saves and round-trips through localStorage independently', async () => {
    const s = useSettingsStore()
    s.centreCursorMode = true
    await nextTick()
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(JSON.parse(raw as string).centreCursorMode).toBe(true)

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    expect(s2.centreCursorMode).toBe(true)
  })

  it('inputModePref auto-saves and round-trips through localStorage independently', async () => {
    const s = useSettingsStore()
    s.inputModePref = 'touch'
    await nextTick()
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(JSON.parse(raw as string).inputModePref).toBe('touch')

    setActivePinia(createPinia())
    const s2 = useSettingsStore()
    expect(s2.inputModePref).toBe('touch')
  })
})
