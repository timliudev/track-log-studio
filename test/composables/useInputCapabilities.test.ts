// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useInputCapabilities } from '@/composables/useInputCapabilities'
import { useSettingsStore } from '@/stores/settingsStore'

/** Node's default test environment has no real localStorage; settingsStore
 *  reads/writes it on construction (same stub other persistence tests use). */
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

/**
 * A `matchMedia` stub that (unlike happy-dom's own, non-live default) keeps a
 * per-query listener registry so tests can simulate a live capability change
 * (mouse plugged in/unplugged) via `fire(query, matches)` — the exact thing
 * §8 layer 3 requires useInputCapabilities() to react to, not just read once.
 */
function installMatchMediaMock(initial: Record<string, boolean> = {}) {
  const state = new Map<string, boolean>(Object.entries(initial))
  const listeners = new Map<string, Set<(e: MediaQueryListEvent) => void>>()

  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return state.get(query) ?? false
    },
    media: query,
    addEventListener(_type: string, cb: (e: MediaQueryListEvent) => void) {
      if (!listeners.has(query)) listeners.set(query, new Set())
      listeners.get(query)!.add(cb)
    },
    removeEventListener(_type: string, cb: (e: MediaQueryListEvent) => void) {
      listeners.get(query)?.delete(cb)
    },
  }))

  return {
    fire(query: string, matches: boolean): void {
      state.set(query, matches)
      const event = { matches } as MediaQueryListEvent
      listeners.get(query)?.forEach((cb) => cb(event))
    },
  }
}

/** Mounts a throwaway host component so onMounted/onBeforeUnmount (the
 *  matchMedia 'change' listeners) run inside a real component instance —
 *  same idiom useDashboardLayout.test.ts uses. */
function mountHarness() {
  let result!: ReturnType<typeof useInputCapabilities>
  const Harness = defineComponent({
    setup() {
      result = useInputCapabilities()
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)
  return { wrapper, caps: result }
}

beforeEach(() => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
  document.documentElement.removeAttribute('data-any-pointer-coarse')
  document.documentElement.removeAttribute('data-pointer-coarse')
  document.documentElement.removeAttribute('data-any-hover-none')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useInputCapabilities — layer 3 (live capability query)', () => {
  it('reflects matchMedia results at mount time', () => {
    installMatchMediaMock({
      '(any-pointer: coarse)': true,
      '(pointer: coarse)': false,
      '(any-hover: none)': false,
    })
    const { caps } = mountHarness()
    expect(caps.anyPointerCoarse.value).toBe(true)
    expect(caps.pointerCoarse.value).toBe(false)
    expect(caps.anyHoverNone.value).toBe(false)
  })

  it('re-evaluates live on a matchMedia "change" event — plugging in a mouse', async () => {
    const mm = installMatchMediaMock({ '(any-pointer: coarse)': true })
    const { caps } = mountHarness()
    expect(caps.anyPointerCoarse.value).toBe(true)

    // Simulate a Bluetooth mouse being connected to an otherwise touch-only
    // tablet: any-pointer:coarse STAYS true (the touchscreen is still there),
    // but pointer:coarse (the PRIMARY pointer) flips to false.
    mm.fire('(pointer: coarse)', false)
    await nextTick()
    expect(caps.pointerCoarse.value).toBe(false)

    // And unplugging it again flips back — this must never get "stuck" at
    // whatever it read once on load.
    mm.fire('(pointer: coarse)', true)
    await nextTick()
    expect(caps.pointerCoarse.value).toBe(true)
  })

  it('sets/clears the <html> data-attributes CSS keys off', async () => {
    const mm = installMatchMediaMock({ '(any-pointer: coarse)': false })
    mountHarness()
    await nextTick()
    expect(document.documentElement.hasAttribute('data-any-pointer-coarse')).toBe(false)

    mm.fire('(any-pointer: coarse)', true)
    await nextTick()
    expect(document.documentElement.hasAttribute('data-any-pointer-coarse')).toBe(true)
  })
})

describe('useInputCapabilities — layer 4 (settings override fuse)', () => {
  it('"touch" override pins every capability true regardless of the actual media query', () => {
    installMatchMediaMock({
      '(any-pointer: coarse)': false,
      '(pointer: coarse)': false,
      '(any-hover: none)': false,
    })
    useSettingsStore().inputModePref = 'touch'
    const { caps } = mountHarness()
    expect(caps.anyPointerCoarse.value).toBe(true)
    expect(caps.pointerCoarse.value).toBe(true)
    expect(caps.anyHoverNone.value).toBe(true)
  })

  it('"pointer" override pins every capability false regardless of the actual media query', () => {
    installMatchMediaMock({
      '(any-pointer: coarse)': true,
      '(pointer: coarse)': true,
      '(any-hover: none)': true,
    })
    useSettingsStore().inputModePref = 'pointer'
    const { caps } = mountHarness()
    expect(caps.anyPointerCoarse.value).toBe(false)
    expect(caps.pointerCoarse.value).toBe(false)
    expect(caps.anyHoverNone.value).toBe(false)
  })

  it('"auto" (default) passes the live media-query reads through unchanged', () => {
    installMatchMediaMock({ '(any-pointer: coarse)': true })
    expect(useSettingsStore().inputModePref).toBe('auto')
    const { caps } = mountHarness()
    expect(caps.anyPointerCoarse.value).toBe(true)
  })
})
