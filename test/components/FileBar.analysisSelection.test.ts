// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import FileBar from '@/components/FileBar.vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useFileStore } from '@/stores/fileStore'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'

function session(): LogSession {
  const time: Channel = {
    name: 'Time',
    rawName: 'Time',
    description: undefined,
    data: new Float32Array([0, 1000]),
  }
  return new LogSession([time], { formatId: 'test', createdDate: null, headerInfo: {} })
}

beforeEach(() => setActivePinia(createPinia()))

describe('FileBar analyzer selection', () => {
  it('uses ready-file checkboxes for the primary and comparison set', async () => {
    const files = useFileStore()
    const analyzer = useAnalyzerStore()
    const first = files.addMergedSession('first.loga', session())
    const second = files.addMergedSession('second.loga', session())
    analyzer.activeFileId = first

    const wrapper = mount(FileBar, {
      props: { analyzerMode: true },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
        directives: { tooltip: () => undefined },
      },
    })

    const checks = wrapper.findAll<HTMLInputElement>('.analysis-check')
    expect(checks).toHaveLength(2)
    expect(checks[0].element.checked).toBe(true)
    expect(checks[1].element.checked).toBe(false)

    await checks[1].setValue(true)
    expect(analyzer.selectedSessions).toEqual([second])
    expect(wrapper.text()).toContain('主要')

    await wrapper.findAll<HTMLButtonElement>('.primary-picker')[1].trigger('click')
    expect(analyzer.activeFileId).toBe(second)
    expect(analyzer.selectedSessions).toEqual([first])
  })

  it('does not show analysis checkboxes in converter mode', () => {
    useFileStore().addMergedSession('one.loga', session())
    const wrapper = mount(FileBar, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
        directives: { tooltip: () => undefined },
      },
    })
    expect(wrapper.find('.analysis-check').exists()).toBe(false)
  })
})
