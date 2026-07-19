// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import FileBar from '@/components/FileBar.vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useFileStore } from '@/stores/fileStore'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'

const { inspectRcnxFile, extractZipFile, parseFile } = vi.hoisted(() => ({
  inspectRcnxFile: vi.fn(),
  extractZipFile: vi.fn(),
  parseFile: vi.fn(),
}))

vi.mock('@/domain/import/lazyLoaders', () => ({ inspectRcnxFile, extractZipFile }))
vi.mock('@/composables/useLogImport', () => ({ useLogImport: () => ({ parseFile }) }))

function session(): LogSession {
  const time: Channel = {
    name: 'Time',
    rawName: 'Time',
    description: undefined,
    data: new Float32Array([0, 1000]),
  }
  return new LogSession([time], { formatId: 'test', createdDate: null, headerInfo: {} })
}

beforeEach(() => {
  setActivePinia(createPinia())
  inspectRcnxFile.mockReset()
  extractZipFile.mockReset()
  parseFile.mockReset()
})

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

  // B55 — the pill-name click is a real trigger but its only discovery cue
  // was a hover tooltip; there must also be an explicit, always-visible
  // "make primary" button so touch users (and anyone who doesn't hover) can
  // find the action at all (DESIGN.md §8).
  it('shows an explicit make-primary button on every non-primary ready file, and it swaps the primary', async () => {
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

    // Only the non-primary file gets the explicit button.
    const buttons = wrapper.findAll<HTMLButtonElement>('.make-primary-btn')
    expect(buttons).toHaveLength(1)

    await buttons[0].trigger('click')
    expect(analyzer.activeFileId).toBe(second)
    expect(analyzer.selectedSessions).toEqual([first])
    // After the swap, the button moved to the now-non-primary first file.
    expect(wrapper.findAll('.make-primary-btn')).toHaveLength(1)
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

  it('derives the generic CSV picker accept value and support text from the importer registry', () => {
    const wrapper = mount(FileBar, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
        directives: { tooltip: () => undefined },
      },
    })
    expect(wrapper.find<HTMLInputElement>('input[name="logfile"]').attributes('accept')).toContain('.csv')
    expect(wrapper.text()).toContain('一般 CSV 遙測')
  })

  it('loads the RCNX inspector only after an RCNX file is chosen', async () => {
    inspectRcnxFile.mockResolvedValue([
      { n: 0, waypointCount: 10, trackName: 'Track A', startTimeMs: undefined, durationMs: 1000, hasLapData: false },
      { n: 1, waypointCount: 20, trackName: 'Track B', startTimeMs: undefined, durationMs: 2000, hasLapData: true },
    ])
    const wrapper = mount(FileBar, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
        directives: { tooltip: () => undefined },
      },
    })
    expect(inspectRcnxFile).not.toHaveBeenCalled()

    const file = new File(['PK'], 'sessions.rcnx')
    const input = wrapper.find<HTMLInputElement>('input[name="logfile"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(inspectRcnxFile).toHaveBeenCalledWith(file))
    expect(wrapper.findAll('.rcnx-session-btn')).toHaveLength(2)
    expect(parseFile).not.toHaveBeenCalled()
  })

  it('loads ZIP extraction only after a ZIP file is chosen', async () => {
    extractZipFile.mockResolvedValue([])
    const wrapper = mount(FileBar, {
      global: {
        plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
        directives: { tooltip: () => undefined },
      },
    })
    expect(extractZipFile).not.toHaveBeenCalled()

    const file = new File(['PK'], 'shared.zip')
    const input = wrapper.find<HTMLInputElement>('input[name="logfile"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(extractZipFile).toHaveBeenCalledWith(file))
  })
})
