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

  it('drives navigation via window.open on click instead of relying on the anchor default action', async () => {
    const fakeWindow = {} as Window
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow)

    const wrapper = mountButton()
    await wrapper.get('a').trigger('click')

    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/timliudev/track-log-studio',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('falls back to same-tab navigation when window.open is blocked (e.g. a standalone PWA swallowing it)', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    // happy-dom throws "Not implemented: navigation" if we actually assign
    // location.href; stub a plain object so we can just assert the intent.
    const location = { href: '' }
    vi.stubGlobal('location', location)

    const wrapper = mountButton()
    await wrapper.get('a').trigger('click')

    expect(location.href).toBe('https://github.com/timliudev/track-log-studio')
  })
})
