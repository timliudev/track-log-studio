// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import TrackMap from '@/features/analyzer/TrackMap.vue'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * Mobile "maximize" overlay (手機賽道地圖最大化) — TrackMap.vue's own local
 * `maximized` ref toggles a fullscreen Teleport-to-body overlay. This is
 * deliberately self-contained (no analyzerStore / AnalyzerView involvement),
 * so the test only needs a bare TrackMap with a null track (draw() bails out
 * immediately on a null track, so no canvas 2D context mocking is required).
 *
 * `attachTo: document.body` is required so the real <Teleport to="body">
 * target resolves inside happy-dom and the teleported content is queryable
 * via `document.body.querySelector`.
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
    attachTo: document.body,
  })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.style.overflow = ''
})

describe('TrackMap mobile maximize overlay', () => {
  it('starts un-maximized: shows the maximize trigger with an i18n aria-label, no close button, no overlay class', () => {
    const w = mountMap()
    const trigger = document.body.querySelector('.maximize-toggle:not(.maximize-toggle--close)')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-label')).toBe('放大賽道地圖')
    expect(document.body.querySelector('.maximize-toggle--close')).toBeNull()
    expect(document.body.querySelector('.track-wrap.maximized')).toBeNull()
    void w
  })

  it('clicking the trigger flips to the fullscreen overlay: adds .maximized, swaps in the close button, hides the trigger', async () => {
    mountMap()
    const trigger = document.body.querySelector<HTMLButtonElement>('.maximize-toggle')!
    trigger.click()
    await wrapper!.vm.$nextTick()

    expect(document.body.querySelector('.track-wrap.maximized')).not.toBeNull()
    const closeBtn = document.body.querySelector('.maximize-toggle--close')
    expect(closeBtn).not.toBeNull()
    expect(closeBtn?.getAttribute('aria-label')).toBe('還原賽道地圖')
    expect(document.body.querySelector('.maximize-toggle:not(.maximize-toggle--close)')).toBeNull()
  })

  it('clicking the close button restores the normal (in-place) layout', async () => {
    mountMap()
    document.body.querySelector<HTMLButtonElement>('.maximize-toggle')!.click()
    await wrapper!.vm.$nextTick()
    document.body.querySelector<HTMLButtonElement>('.maximize-toggle--close')!.click()
    await wrapper!.vm.$nextTick()

    expect(document.body.querySelector('.track-wrap.maximized')).toBeNull()
    expect(document.body.querySelector('.maximize-toggle--close')).toBeNull()
    expect(document.body.querySelector('.maximize-toggle')).not.toBeNull()
  })

  it('locks page scroll (body overflow: hidden) while maximized and restores it on close', async () => {
    mountMap()
    expect(document.body.style.overflow).toBe('')
    document.body.querySelector<HTMLButtonElement>('.maximize-toggle')!.click()
    await wrapper!.vm.$nextTick()
    expect(document.body.style.overflow).toBe('hidden')

    document.body.querySelector<HTMLButtonElement>('.maximize-toggle--close')!.click()
    await wrapper!.vm.$nextTick()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores body scroll on unmount even if still maximized (no permanently-locked page)', async () => {
    const w = mountMap()
    document.body.querySelector<HTMLButtonElement>('.maximize-toggle')!.click()
    await w.vm.$nextTick()
    expect(document.body.style.overflow).toBe('hidden')

    w.unmount()
    wrapper = null
    expect(document.body.style.overflow).toBe('')
  })

  it('pressing Escape while maximized closes the overlay', async () => {
    mountMap()
    document.body.querySelector<HTMLButtonElement>('.maximize-toggle')!.click()
    await wrapper!.vm.$nextTick()
    expect(document.body.querySelector('.track-wrap.maximized')).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper!.vm.$nextTick()
    expect(document.body.querySelector('.track-wrap.maximized')).toBeNull()
  })
})
