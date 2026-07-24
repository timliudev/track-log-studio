// @vitest-environment happy-dom
//
// F4 phase 1 — switching which session of an already-imported multi-session
// `.rcnx` is loaded (`switchRcnxSession` in FileBar.vue), without re-importing
// the file. Covers: channels genuinely replaced, the switched record's own
// invalidated lap-selection state is cleared (primary vs. comparison paths
// differ — see lapStore.ts's `selected`/`manualExcluded`/`offsets` vs.
// `selectedAcrossSessions`/`manualExcludedBySession`), and a failed re-parse
// leaves the existing ready record untouched.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import FileBar from '@/components/FileBar.vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useFileStore } from '@/stores/fileStore'
import { useLapStore } from '@/stores/lapStore'
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

/** A session distinguishable from `otherSession()` by row count/values, so a
 *  test can tell whether the record's channels actually changed. */
function sessionA(): LogSession {
  return new LogSession(
    [channel('Time', [0, 1000, 2000]), channel('GPS_Speed', [10, 20, 30])],
    { formatId: 'rcnx', createdDate: null, headerInfo: { sessionIndex: '0' } },
  )
}

function sessionB(): LogSession {
  return new LogSession(
    [channel('Time', [0, 500]), channel('GPS_Speed', [99, 88])],
    { formatId: 'rcnx', createdDate: null, headerInfo: { sessionIndex: '1' } },
  )
}

const twoSessions: RcnxSessionInfo[] = [
  { n: 0, waypointCount: 300, trackName: 'Track A', startTimeMs: 1_700_000_000_000, durationMs: 600_000, hasLapData: true },
  { n: 1, waypointCount: 150, trackName: 'Track A', startTimeMs: 1_700_010_000_000, durationMs: 300_000, hasLapData: false },
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

describe('FileBar .rcnx session switch (F4 phase 1)', () => {
  it('shows no switcher for a single-session record, and one for a multi-session record', () => {
    const fileStore = useFileStore()
    const single = fileStore.beginImport(new File(['x'], 'single.rcnx'))
    fileStore.completeImport(single, sessionA(), { sessions: [twoSessions[0]], sessionIndex: 0 })
    const multi = fileStore.beginImport(new File(['x'], 'multi.rcnx'))
    fileStore.completeImport(multi, sessionA(), { sessions: twoSessions, sessionIndex: 0 })

    const wrapper = mountFileBar()
    expect(wrapper.findAll('.rcnx-switch-select')).toHaveLength(1)
  })

  it('switching the PRIMARY record re-parses in place, replaces channels, and clears its own lap selection but not the line', async () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()

    const file = new File(['PK'], 'session.rcnx')
    const id = fileStore.beginImport(file)
    fileStore.completeImport(id, sessionA(), { sessions: twoSessions, sessionIndex: 0 })
    analyzer.activeFileId = id

    // Seed per-lap state that only makes sense for sessionA's laps.
    lapStore.toggleLap(0)
    lapStore.toggleExcluded(1)
    lapStore.nudgeOffset(0, 'time', 5)
    lapStore.setLine({ a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } })

    const sb = sessionB()
    parseFile.mockResolvedValue(sb)

    const wrapper = mountFileBar()
    const select = wrapper.find<HTMLSelectElement>('.rcnx-switch-select')
    await select.setValue('1')
    await vi.waitFor(() => expect(fileStore.getSession(id)).toBe(sb))

    expect(parseFile).toHaveBeenCalledWith(file, 'rcnx', undefined, 1)
    expect(fileStore.getSession(id)?.rowCount).toBe(2)
    expect(fileStore.files[0].rcnxSessionIndex).toBe(1)

    // The switched record's own index-keyed state is gone (indices meaningless
    // against the new session's laps)...
    expect(lapStore.selected).toEqual([])
    expect(lapStore.manualExcluded).toEqual([])
    expect(lapStore.offsets).toEqual({})
    // ...but the shared start/finish line (track-level, not this record's) is
    // NOT force-cleared by the switch itself (FileBar never calls clearLine).
    expect(lapStore.line).toEqual({ a: { lat: 1, lon: 2 }, b: { lat: 3, lon: 4 } })
  })

  it('switching a COMPARISON record clears only its own cross-session selection, keyed by fileId', async () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const lapStore = useLapStore()

    const primary = fileStore.addMergedSession('primary.loga', sessionA())
    const file = new File(['PK'], 'comparison.rcnx')
    const comparisonId = fileStore.beginImport(file)
    fileStore.completeImport(comparisonId, sessionA(), { sessions: twoSessions, sessionIndex: 0 })

    analyzer.activeFileId = primary
    analyzer.selectedSessions = [comparisonId]

    lapStore.toggleSessionLap(comparisonId, 0)
    lapStore.toggleSessionExcluded(comparisonId, 1)
    // Unrelated primary-facing state must be untouched by a comparison switch.
    lapStore.toggleLap(0)

    const sb = sessionB()
    parseFile.mockResolvedValue(sb)

    const wrapper = mountFileBar()
    const select = wrapper.find<HTMLSelectElement>('.rcnx-switch-select')
    await select.setValue('1')
    await vi.waitFor(() => expect(fileStore.getSession(comparisonId)).toBe(sb))

    expect(lapStore.selectedAcrossSessions).toEqual([])
    expect(lapStore.manualExcludedBySession).toEqual({})
    // The primary's own selection survives — a comparison switch has no
    // business touching it.
    expect(lapStore.selected).toEqual([0])
  })

  it('a failed switch leaves the existing ready record untouched and surfaces an error', async () => {
    const fileStore = useFileStore()
    const analyzer = useAnalyzerStore()
    const original = sessionA()
    const file = new File(['PK'], 'session.rcnx')
    const id = fileStore.beginImport(file)
    fileStore.completeImport(id, original, { sessions: twoSessions, sessionIndex: 0 })
    analyzer.activeFileId = id

    parseFile.mockRejectedValue(new Error('sql.js: corrupt db'))

    const wrapper = mountFileBar()
    const select = wrapper.find<HTMLSelectElement>('.rcnx-switch-select')
    await select.setValue('1')
    await vi.waitFor(() => expect(wrapper.find('.rcnx-switch-err').exists()).toBe(true))

    expect(fileStore.getSession(id)).toBe(original)
    expect(fileStore.files[0].rcnxSessionIndex).toBe(0)
    expect(wrapper.text()).toContain('sql.js: corrupt db')
    // The switcher itself is usable again (not stuck disabled).
    expect(wrapper.find<HTMLSelectElement>('.rcnx-switch-select').element.disabled).toBe(false)
  })
})
