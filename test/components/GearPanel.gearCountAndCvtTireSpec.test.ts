// @vitest-environment happy-dom
import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import GearPanel from '@/features/analyzer/GearPanel.vue'
import { useDrivetrainStore, MAX_GEARS } from '@/stores/drivetrainStore'
import { vTooltip } from '@/directives/tooltip'
import zhHant from '@/i18n/locales/zh-Hant'
import en from '@/i18n/locales/en'

/**
 * #7/#12 — two user-reported gaps in GearPanel:
 * 1. Gear count was hardcoded to a fixed 6-option <select> (MAX_GEARS=6) —
 *    off-road/CUB bikes aren't necessarily 6-speed. MAX_GEARS is now 8, and
 *    the <select>'s options must track it (both up AND down: 1-gear bikes
 *    exist too).
 * 2. The CVT tab had no tire-spec converter (only a MT tab, plus a bare mm
 *    number for CVT with no way to compute it from a tire size) even though
 *    "無論 MT 還是 CVT,輪徑都是一樣的" (same physical wheel either way). The
 *    CVT tab must now expose the same tire-spec input MT has, live-applying
 *    into `store.cvt.wheelCircumferenceMm` — but must NOT get a "由記錄反推"
 *    button (CVT has no discrete gears to solve for — #4/existing behaviour).
 */

function mountPanel() {
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-Hant',
    fallbackLocale: 'en',
    messages: { 'zh-Hant': zhHant, en },
  })
  // session: null — both tabs' spec/tire-spec forms render regardless of a
  // loaded log (only the measured-overlay chart sections need a session).
  return mount(GearPanel, {
    props: { session: null },
    global: { plugins: [i18n], directives: { tooltip: vTooltip } },
  })
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

beforeEach(() => {
  installMemoryLocalStorage()
  localStorage.clear()
  setActivePinia(createPinia())
})

describe('GearPanel — MT gear-count select tracks the raised MAX_GEARS (#7/#12)', () => {
  it('offers exactly 1..MAX_GEARS as options', () => {
    const wrapper = mountPanel()
    const select = wrapper.find('select')
    expect(select.exists()).toBe(true)
    const values = select.findAll('option').map((o) => o.element.value)
    expect(values).toEqual(Array.from({ length: MAX_GEARS }, (_, i) => String(i + 1)))
    expect(MAX_GEARS).toBe(8)
  })

  it('choosing 8 in the select resizes the store gear list to 8', async () => {
    const wrapper = mountPanel()
    const store = useDrivetrainStore()
    const select = wrapper.find('select')
    await select.setValue('8')
    expect(store.mt.gearRatios).toHaveLength(8)
  })

  it('choosing 1 (e.g. a single-speed off-road bike) shrinks to a single gear', async () => {
    const wrapper = mountPanel()
    const store = useDrivetrainStore()
    const select = wrapper.find('select')
    await select.setValue('1')
    expect(store.mt.gearRatios).toHaveLength(1)
  })
})

describe('GearPanel — CVT tab gets a tire-spec converter (#7/#12)', () => {
  // MT and CVT's tire-spec/circumference blocks share the SAME classes
  // (tire-spec-input / circumference-input) — a query issued right after
  // `setKind('cvt')` without waiting a tick can still see the stale MT-branch
  // DOM (Vue's re-render is async), so this must await before returning.
  async function switchToCvt(wrapper: ReturnType<typeof mountPanel>) {
    const store = useDrivetrainStore()
    store.setKind('cvt')
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('renders a tire-spec text input in CVT mode (previously only MT had one)', async () => {
    const wrapper = await switchToCvt(mountPanel())
    const specInput = wrapper.find('input.tire-spec-input')
    expect(specInput.exists()).toBe(true)
  })

  it('renders the direct-mm circumference field alongside the spec input', async () => {
    const wrapper = await switchToCvt(mountPanel())
    const mmInput = wrapper.find('input.circumference-input')
    expect(mmInput.exists()).toBe(true)
    expect((mmInput.element as HTMLInputElement).type).toBe('number')
  })

  it('typing a valid spec auto-applies into the store and shows the applied hint', async () => {
    const wrapper = await switchToCvt(mountPanel())
    const store = useDrivetrainStore()
    const specInput = wrapper.find('input.tire-spec-input')
    await specInput.setValue('100/90-10')

    expect(store.cvt.tireSpec).toBe('100/90-10')
    expect(store.cvt.wheelCircumferenceMm).toBe(Math.round(Math.PI * 434))
    expect(wrapper.find('.tire-spec-applied').exists()).toBe(true)
  })

  it('does NOT render a "由記錄反推" (back-estimate from log) button for CVT — physically unsolvable, MT-only', async () => {
    const wrapper = await switchToCvt(mountPanel())
    // The disabled placeholder button (with explanatory hint) still exists —
    // this is not testing its absence, only that no WORKING estimate button
    // appeared alongside the new tire-spec converter.
    const btn = wrapper.find('.apply-btn')
    expect(btn.exists()).toBe(true)
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('MT tab is unaffected: still has its own independent tire-spec input', () => {
    const wrapper = mountPanel() // defaults to MT
    const specInput = wrapper.find('input.tire-spec-input')
    expect(specInput.exists()).toBe(true)
    expect((specInput.element as HTMLInputElement).value).toBe('120/70-17') // MT default, not CVT's blank
  })
})
