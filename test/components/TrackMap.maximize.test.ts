// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import TrackMap from '@/features/analyzer/TrackMap.vue'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * B7 — in-card "maximize" (works identically on desktop and mobile, replacing
 * the old mobile-only fullscreen-Teleport-to-body design). TrackMap.vue's own
 * local `maximized` ref toggles a class hook and emits `update:maximized` so
 * a host card can hide its OTHER body content — the map itself never leaves
 * its place in the DOM, so no Teleport/attachTo-document.body plumbing is
 * needed to query it; `wrapper.find(...)` sees it directly.
 */
let wrapper: VueWrapper | null = null

function mountMap() {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  wrapper = mount(TrackMap, {
    props: { track: null, cursorIdx: null, line: null },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
  return wrapper
}

/** B30b — TrackMap now reads `useInputCapabilities()` (for the map-hover hit
 *  radius), which pulls in `useSettingsStore()` (a persisted-to-localStorage
 *  Pinia store); happy-dom doesn't provide a working `localStorage` unless
 *  something stubs it in, so every mount needs both an active Pinia AND this
 *  stub — same pattern used by GearPanel's tests. */
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
  setActivePinia(createPinia())
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('TrackMap in-card maximize (B7)', () => {
  it('starts un-maximized: shows the maximize trigger with an i18n aria-label, no close button, no maximized class', () => {
    const w = mountMap()
    const trigger = w.find('.maximize-toggle:not(.maximize-toggle--close)')
    expect(trigger.exists()).toBe(true)
    expect(trigger.attributes('aria-label')).toBe('放大賽道地圖')
    expect(trigger.find('svg.maximize-icon[viewBox="0 0 24 24"]').exists()).toBe(true)
    expect(w.find('.maximize-toggle--close').exists()).toBe(false)
    expect(w.find('.track-wrap.maximized').exists()).toBe(false)
  })

  it('clicking the trigger flips to the in-card maximized state: adds .maximized, swaps in the close button, hides the trigger', async () => {
    const w = mountMap()
    await w.find('.maximize-toggle').trigger('click')

    expect(w.find('.track-wrap.maximized').exists()).toBe(true)
    const closeBtn = w.find('.maximize-toggle--close')
    expect(closeBtn.exists()).toBe(true)
    expect(closeBtn.attributes('aria-label')).toBe('還原賽道地圖')
    expect(closeBtn.find('svg.maximize-icon[viewBox="0 0 24 24"]').exists()).toBe(true)
    expect(w.find('.maximize-toggle:not(.maximize-toggle--close)').exists()).toBe(false)
  })

  it('emits update:maximized(true/false) as the toggle flips, for a host card to hide its other content', async () => {
    const w = mountMap()
    await w.find('.maximize-toggle').trigger('click')
    expect(w.emitted('update:maximized')?.[0]).toEqual([true])

    await w.find('.maximize-toggle--close').trigger('click')
    expect(w.emitted('update:maximized')?.[1]).toEqual([false])
  })

  it('clicking the close button restores the normal (in-place) layout', async () => {
    const w = mountMap()
    await w.find('.maximize-toggle').trigger('click')
    await w.find('.maximize-toggle--close').trigger('click')

    expect(w.find('.track-wrap.maximized').exists()).toBe(false)
    expect(w.find('.maximize-toggle--close').exists()).toBe(false)
    expect(w.find('.maximize-toggle').exists()).toBe(true)
  })

  it('pressing Escape while maximized closes it (and emits update:maximized(false))', async () => {
    const w = mountMap()
    await w.find('.maximize-toggle').trigger('click')
    expect(w.find('.track-wrap.maximized').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.find('.track-wrap.maximized').exists()).toBe(false)
    expect(w.emitted('update:maximized')?.at(-1)).toEqual([false])
  })

  it('never leaves the DOM tree it was mounted in (no Teleport-to-body escape)', async () => {
    const w = mountMap()
    await w.find('.maximize-toggle').trigger('click')
    // The maximized markup is still findable through the component's own
    // wrapper — i.e. still a normal descendant, not relocated to <body>.
    expect(w.find('.track-wrap.maximized').exists()).toBe(true)
  })
})
