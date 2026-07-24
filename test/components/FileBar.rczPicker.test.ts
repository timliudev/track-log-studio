// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import FileBar from '@/components/FileBar.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'

function fakeSession(): LogSession {
  const time: Channel = { name: 'Time', rawName: 'Time', description: undefined, data: new Float32Array([0, 100]) }
  return new LogSession([time], { formatId: 'rcz', createdDate: null, headerInfo: {} })
}

const { inspectRcnxFile, inspectRczFile, extractZipFile, parseFile } = vi.hoisted(() => ({
  inspectRcnxFile: vi.fn(),
  inspectRczFile: vi.fn(),
  extractZipFile: vi.fn(),
  parseFile: vi.fn(),
}))

vi.mock('@/domain/import/lazyLoaders', () => ({ inspectRcnxFile, inspectRczFile, extractZipFile }))
vi.mock('@/composables/useLogImport', () => ({ useLogImport: () => ({ parseFile }) }))

function mountFileBar() {
  return mount(FileBar, {
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      directives: { tooltip: () => undefined },
    },
  })
}

function chooseFile(wrapper: ReturnType<typeof mountFileBar>, file: File): Promise<void> {
  const input = wrapper.find<HTMLInputElement>('input[name="logfile"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  return input.trigger('change')
}

beforeEach(() => {
  setActivePinia(createPinia())
  inspectRcnxFile.mockReset()
  inspectRczFile.mockReset()
  extractZipFile.mockReset()
  parseFile.mockReset()
})

describe('FileBar — .rcz device-backup picker (F3 stage 1)', () => {
  it('shows an inline session picker for a multi-session backup, without calling parseFile until a session is chosen', async () => {
    inspectRczFile.mockResolvedValue([
      {
        key: 'session_A',
        date: new Date('2026-01-01T08:00:00Z'),
        durationMs: 60_000,
        distanceKm: 3.5,
        lapCount: 2,
        bestLaptimeMs: 52_000,
        deviceCount: 2,
        gpsDeviceId: 200,
      },
      {
        key: 'session_B',
        date: new Date('2026-01-02T08:00:00Z'),
        durationMs: 20_000,
        distanceKm: 0.9,
        lapCount: 0,
        bestLaptimeMs: null,
        deviceCount: 1,
        gpsDeviceId: 200,
      },
    ])
    parseFile.mockResolvedValue(fakeSession())

    const wrapper = mountFileBar()
    expect(inspectRczFile).not.toHaveBeenCalled()

    const file = new File(['PK'], 'backup.rcz')
    await chooseFile(wrapper, file)
    await vi.waitFor(() => expect(inspectRczFile).toHaveBeenCalledWith(file))

    const buttons = wrapper.findAll('.rcz-session-btn, .rcnx-session-btn')
    expect(buttons).toHaveLength(2)
    expect(parseFile).not.toHaveBeenCalled()

    await buttons[0].trigger('click')
    await vi.waitFor(() =>
      expect(parseFile).toHaveBeenCalledWith(file, 'rcz', expect.any(Function), undefined, 'session_A'),
    )
  })

  it('auto-selects the only session in a single-session backup, with no picker shown', async () => {
    inspectRczFile.mockResolvedValue([
      {
        key: 'session_only',
        date: null,
        durationMs: undefined,
        distanceKm: undefined,
        lapCount: undefined,
        bestLaptimeMs: null,
        deviceCount: 1,
        gpsDeviceId: 200,
      },
    ])
    parseFile.mockResolvedValue(fakeSession())

    const wrapper = mountFileBar()
    const file = new File(['PK'], 'backup-one.rcz')
    await chooseFile(wrapper, file)

    await vi.waitFor(() =>
      expect(parseFile).toHaveBeenCalledWith(file, 'rcz', expect.any(Function), undefined, 'session_only'),
    )
    expect(wrapper.findAll('.rcz-session-btn, .rcnx-session-btn')).toHaveLength(0)
  })

  it('leaves a plain single-session .rcz export path unchanged (no picker, parseFile called with no session key)', async () => {
    inspectRczFile.mockResolvedValue(null)
    parseFile.mockResolvedValue(fakeSession())

    const wrapper = mountFileBar()
    const file = new File(['PK'], 'session.rcz')
    await chooseFile(wrapper, file)

    await vi.waitFor(() => expect(inspectRczFile).toHaveBeenCalledWith(file))
    await vi.waitFor(() => expect(parseFile).toHaveBeenCalledWith(file, 'rcz', expect.any(Function)))
    expect(wrapper.findAll('.rcz-session-btn, .rcnx-session-btn')).toHaveLength(0)
  })
})
