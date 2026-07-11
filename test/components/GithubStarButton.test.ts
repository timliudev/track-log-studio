// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GithubStarButton from '@/components/GithubStarButton.vue'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * Regression test for the "GitHub button can't be clicked" bug: the app is
 * installed as a `display: 'standalone'` PWA (vite.config.ts manifest), and
 * in that display mode iOS Safari's home-screen WebView (and some Android
 * TWA/WebView shells) silently swallow a plain `<a target="_blank">` click
 * for an external link — no new tab opens, nothing happens, no error either.
 * The fix drives navigation explicitly via `window.open` (with a same-tab
 * `location.href` fallback if that's blocked) instead of relying solely on
 * the anchor's default action.
 */
function mountButton() {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })

  return mount(GithubStarButton, {
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
}

describe('GithubStarButton', () => {
  beforeEach(() => {
    // useGithubStars() reads localStorage on mount; stub it out like the
    // other component tests do (see SettingsView.test.ts).
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
    // useGithubStars() also fires a background fetch() on mount; stub it so
    // it resolves to nothing rather than hitting the network in tests.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network disabled in test'))),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders a real anchor pointing at the repo, opened in a new tab', () => {
    const wrapper = mountButton()
    const link = wrapper.get('a')
    expect(link.attributes('href')).toBe('https://github.com/timliudev/track-log-studio')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('opens a new tab via window.open WITHOUT noopener in the features string (which would force a null return) and never navigates the current tab away', async () => {
    // A real window reference so opener-severing runs; features must NOT
    // contain noopener/noreferrer (that is exactly what makes window.open
    // return null and would wrongly trigger the same-tab fallback).
    const fakeWindow = { opener: {} } as unknown as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow)
    const location = { href: 'http://localhost/' }
    vi.stubGlobal('location', location)

    const wrapper = mountButton()
    await wrapper.get('a').trigger('click')

    // Called with just URL + '_blank' — no noopener/noreferrer features arg.
    expect(openSpy).toHaveBeenCalledTimes(1)
    const args = openSpy.mock.calls[0]
    expect(args[0]).toBe('https://github.com/timliudev/track-log-studio')
    expect(args[1]).toBe('_blank')
    expect(args[2]).toBeUndefined()
    // Reverse-tabnabbing protection applied manually (equivalent to noopener).
    expect(fakeWindow.opener).toBeNull()
    // The whole point of the regression: the current tab (the app) must NOT
    // be navigated away when the new tab opened successfully.
    expect(location.href).toBe('http://localhost/')
  })

  it('falls back to same-tab navigation ONLY when window.open genuinely returns null (popup blocked)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    // happy-dom throws "Not implemented: navigation" if we actually assign
    // location.href; stub a plain object so we can just assert the intent.
    const location = { href: 'http://localhost/' }
    vi.stubGlobal('location', location)

    const wrapper = mountButton()
    await wrapper.get('a').trigger('click')

    expect(location.href).toBe('https://github.com/timliudev/track-log-studio')
  })
})
