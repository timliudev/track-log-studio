// @vitest-environment happy-dom
//
// F4 phase 2 — "複合區段": combine 2+ sessions of an already-imported
// multi-session `.rcnx` into one new continuous record via a checkbox picker,
// without disturbing the source record or phase 1's "切換場次" switch.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import FileBar from '@/components/FileBar.vue'
import { useFileStore } from '@/stores/fileStore'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import type { RcnxSessionInfo } from '@/domain/import/rcnx/parseRcnx'
import zhHant from '@/i18n/locales/zh-Hant'

const { inspectRcnxFile, extractZipFile, parseFile } = vi.hoisted(() => ({
  inspectRcnxFile: vi.fn(),
  extractZipFile: vi.fn(),
  parseFile: vi.fn(),
}))

vi.mock('@/domain/import/lazyLoaders', () => ({ inspectRcnxFile, extractZipFile }))
vi.mock('@/composables/useLogImport', () => ({ useLogImport: () => ({ parseFile }) }))

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function sessionAt(n: number, createdMs: number, lapNumber?: number[]): LogSession {
  const timeMs = n === 0 ? [0, 1000, 2000] : [0, 1000]
  const speed = n === 0 ? [10, 20, 30] : [40, 50]
  const channels: Channel[] = [channel('Time', timeMs), channel('GPS_Speed', speed)]
  if (lapNumber) channels.push(channel('IR_LapNumber', lapNumber))
  return new LogSession(channels, { formatId: 'rcnx', createdDate: new Date(createdMs), headerInfo: { sessionIndex: String(n) } })
}

const twoSessions: RcnxSessionInfo[] = [
  { n: 0, waypointCount: 300, trackName: 'Track A', startTimeMs: 0, durationMs: 2000, hasLapData: true },
  { n: 1, waypointCount: 150, trackName: 'Track A', startTimeMs: 100_000, durationMs: 1000, hasLapData: false },
]

function mountFileBar() {
  return mount(FileBar, {
    props: { analyzerMode: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      directives: { tooltip: () => undefined },
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  inspectRcnxFile.mockReset()
  extractZipFile.mockReset()
  parseFile.mockReset()
})

describe('FileBar .rcnx composite segments (F4 phase 2)', () => {
  it('shows the composite button only for multi-session records', () => {
    const fileStore = useFileStore()
    const single = fileStore.beginImport(new File(['x'], 'single.rcnx'))
    fileStore.completeImport(single, sessionAt(0, 0), { sessions: [twoSessions[0]], sessionIndex: 0 })
    const multi = fileStore.beginImport(new File(['x'], 'multi.rcnx'))
    fileStore.completeImport(multi, sessionAt(0, 0), { sessions: twoSessions, sessionIndex: 0 })

    const wrapper = mountFileBar()
    expect(wrapper.findAll('.composite-btn')).toHaveLength(1)
  })

  it('combines 2 checked sessions into a new continuous record, leaving the source record untouched', async () => {
    const fileStore = useFileStore()
    const file = new File(['PK'], 'multi.rcnx')
    const id = fileStore.beginImport(file)
    const originalSession = sessionAt(0, 0)
    fileStore.completeImport(id, originalSession, { sessions: twoSessions, sessionIndex: 0 })

    parseFile.mockImplementation(async (_file: File, _importerId: string, _onProgress: unknown, sessionIndex: number) => {
      return sessionIndex === 0 ? sessionAt(0, 0, [0, 1, 2]) : sessionAt(1, 100_000, [0, 1])
    })

    const wrapper = mountFileBar()
    await wrapper.find('.composite-btn').trigger('click')

    const checkboxes = wrapper.findAll('.rcnx-session-check input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    // Session 0 is pre-checked (currently loaded); check session 1 too.
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(true)
    await checkboxes[1].setValue(true)

    const combineBtn = wrapper.find('.composite-confirm-btn')
    expect((combineBtn.element as HTMLButtonElement).disabled).toBe(false)
    await combineBtn.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('已建立複合記錄'))

    expect(parseFile).toHaveBeenCalledWith(file, 'rcnx', undefined, 0)
    expect(parseFile).toHaveBeenCalledWith(file, 'rcnx', undefined, 1)

    // Source record is untouched (still session index 0, same object).
    expect(fileStore.getSession(id)).toBe(originalSession)
    expect(fileStore.files.find((f) => f.id === id)?.rcnxSessionIndex).toBe(0)

    // A brand-new record was created (composite), not a replacement.
    const composite = fileStore.files.find((f) => f.name === 'multi_composite.rcnx')
    expect(composite).toBeDefined()
    const compositeSession = fileStore.getSession(composite!.id)!
    expect(compositeSession.rowCount).toBe(5) // 3 rows from session 0 + 2 from session 1
    expect([...compositeSession.get('Time')!.data]).toEqual([0, 1000, 2000, 100_000, 101_000])
    // Lap counter kept monotonic across the seam (session 1's own [0,1] offset by session 0's max=2).
    expect([...compositeSession.get('IR_LapNumber')!.data]).toEqual([0, 1, 2, 2, 3])
  })

  it('disables the combine button until at least 2 sessions are checked', async () => {
    const fileStore = useFileStore()
    const id = fileStore.beginImport(new File(['PK'], 'multi.rcnx'))
    fileStore.completeImport(id, sessionAt(0, 0), { sessions: twoSessions, sessionIndex: 0 })

    const wrapper = mountFileBar()
    await wrapper.find('.composite-btn').trigger('click')
    const combineBtn = wrapper.find('.composite-confirm-btn')
    // Only session 0 pre-checked (the currently-loaded one) — below the minimum of 2.
    expect((combineBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('cancelling the picker discards the pending selection without side effects', async () => {
    const fileStore = useFileStore()
    const id = fileStore.beginImport(new File(['PK'], 'multi.rcnx'))
    fileStore.completeImport(id, sessionAt(0, 0), { sessions: twoSessions, sessionIndex: 0 })

    const wrapper = mountFileBar()
    await wrapper.find('.composite-btn').trigger('click')
    expect(wrapper.find('.rcnx-session-check').exists()).toBe(true)

    await wrapper.find('.rcnx-picker-cancel').trigger('click')
    expect(wrapper.find('.rcnx-session-check').exists()).toBe(false)
    expect(parseFile).not.toHaveBeenCalled()
  })

  it('surfaces a failed combine without corrupting existing records', async () => {
    const fileStore = useFileStore()
    const file = new File(['PK'], 'multi.rcnx')
    const id = fileStore.beginImport(file)
    fileStore.completeImport(id, sessionAt(0, 0), { sessions: twoSessions, sessionIndex: 0 })

    parseFile.mockRejectedValue(new Error('sql.js: corrupt db'))

    const wrapper = mountFileBar()
    await wrapper.find('.composite-btn').trigger('click')
    const checkboxes = wrapper.findAll('.rcnx-session-check input[type="checkbox"]')
    await checkboxes[1].setValue(true)
    await wrapper.find('.composite-confirm-btn').trigger('click')

    await vi.waitFor(() => expect(wrapper.text()).toContain('sql.js: corrupt db'))
    expect(fileStore.files).toHaveLength(1)
  })
})
