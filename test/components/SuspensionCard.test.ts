// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import SuspensionCard from '@/features/analyzer/SuspensionCard.vue'
import { useSuspensionStore } from '@/stores/suspensionStore'
import { deriveSuspensionChannels } from '@/domain/units/suspension'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * Analyzer-side suspension edit entry: verifies (1) the card is usable with a
 * session from ANY imported format — here a made-up channel name that no
 * .loga file would ever produce, simulating a VBO/RCZ/XRK/RCNX/NMEA import —
 * and (2) editing the calibration through this card's form writes straight
 * into the shared `useSuspensionStore`, which is exactly what makes the
 * change reflect immediately in any chart reading the same store (no extra
 * plumbing between this card and the converter page's equivalent panel).
 */

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

/** A session shaped like a NON-.loga import: its analog channel is named
 *  arbitrarily (not `SuspensionAD1`/`SuspensionAD2`), proving calibration
 *  isn't tied to .loga's channel-naming convention. */
function nonLogaSession(): LogSession {
  return new LogSession(
    [channel('Analog_Channel_7', [0, 1000, 2500, 4000, 5000])],
    { formatId: 'vbo', createdDate: null, headerInfo: {} },
  )
}

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

function mountCard(session: LogSession | null) {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  return mount(SuspensionCard, {
    props: { session },
    global: { plugins: [i18n] },
  })
}

describe('SuspensionCard (analyzer edit entry)', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('shows a disabled status and a no-session hint when nothing is loaded', () => {
    const wrapper = mountCard(null)
    expect(wrapper.text()).toContain('未啟用')
    expect(wrapper.find('.hint').exists()).toBe(true)
  })

  it('the edit form is hidden until the toggle button is clicked', async () => {
    const wrapper = mountCard(nonLogaSession())
    expect(wrapper.find('.suspension').exists()).toBe(false)
    await wrapper.find('.edit-toggle').trigger('click')
    expect(wrapper.find('.suspension').exists()).toBe(true)
  })

  it('flags when the configured source channel is missing from the current (non-.loga) session', async () => {
    const susp = useSuspensionStore()
    susp.setChannel('front', { enabled: true, sourceChannel: 'SuspensionAD1' })
    const wrapper = mountCard(nonLogaSession())
    expect(wrapper.text()).toContain('目前記錄無此通道')
  })

  it('repointing sourceChannel at a non-.loga channel through the shared form clears the missing-channel warning', async () => {
    const susp = useSuspensionStore()
    susp.setChannel('front', { enabled: true, sourceChannel: 'SuspensionAD1' })
    const wrapper = mountCard(nonLogaSession())
    expect(wrapper.text()).toContain('目前記錄無此通道')

    await wrapper.find('.edit-toggle').trigger('click')
    // Open the source-channel SearchableSelect, search for the session's own
    // (non-.loga) channel name, and pick it.
    await wrapper.find('.source-field .ss-trigger').trigger('click')
    await wrapper.find('.ss-search').setValue('Analog_Channel_7')
    const option = wrapper.findAll('.ss-option').find((o) => o.text().includes('Analog_Channel_7'))
    expect(option).toBeDefined()
    await option!.trigger('click')

    expect(susp.config.front.sourceChannel).toBe('Analog_Channel_7')
    expect(wrapper.text()).not.toContain('目前記錄無此通道')
  })

  it('editing via the card writes into the SAME store the converter page reads — proving live cross-page sync', async () => {
    const susp = useSuspensionStore()
    const wrapper = mountCard(nonLogaSession())
    await wrapper.find('.edit-toggle').trigger('click')

    await wrapper.find('[name="front-enabled"]').setValue(true)
    await wrapper.find('[name="front-maxMm"]').setValue(120)

    expect(susp.config.front.enabled).toBe(true)
    expect(susp.config.front.maxMm).toBe(120)

    // And the domain-level derivation (what useActiveSession/converterStore
    // both call) picks up the change immediately, format-agnostically, off a
    // channel a .loga file would never contain.
    susp.setChannel('front', { sourceChannel: 'Analog_Channel_7' })
    const derived = deriveSuspensionChannels(nonLogaSession(), susp.config)
    expect(derived).toHaveLength(1)
    expect(derived[0].name).toBe('Front Suspension')
  })
})
