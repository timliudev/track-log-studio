// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import SectorPanel from '@/features/analyzer/SectorPanel.vue'
import zhHant from '@/i18n/locales/zh-Hant'

function mountPanel() {
  return mount(SectorPanel, {
    props: {
      laps: [],
      invalidCount: 0,
      track: null,
      timeMs: null,
      cursorIdx: null,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      directives: { tooltip: {} },
    },
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('SectorPanel', () => {
  // B3: a comparison-recording lap table was wrongly duplicated into the
  // sector-gate card (it already renders once under the main lap-table card,
  // via LapTable.vue). SectorPanel no longer mounts SessionLapComparison at
  // all — comparison lap tables belong under the lap-table card only.
  it('does not render the comparison lap-table section', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.session-summary').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('比較記錄圈次')
  })
})
