// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import SectorPanel from '@/features/analyzer/SectorPanel.vue'
import zhHant from '@/i18n/locales/zh-Hant'

beforeEach(() => setActivePinia(createPinia()))

describe('SectorPanel auto-detect hint', () => {
  it('explains why corner detection cannot run without an included lap', async () => {
    const wrapper = mount(SectorPanel, {
      props: { laps: [], invalidCount: 0, track: null, timeMs: null, cursorIdx: null },
      global: {
        plugins: [createPinia(), createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      },
    })

    await wrapper.get('.detect').trigger('click')
    expect(wrapper.text()).toContain('目前沒有可用的有效圈')
  })
})
