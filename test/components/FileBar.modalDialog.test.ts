// @vitest-environment happy-dom
//
// B118(b) — FileBar's three `role="dialog" aria-modal="true"` pickers
// (rcnx import-time, rcz device-backup, composite-segment) gained
// Escape-to-close, a Tab focus trap, and focus restore-on-close via the new
// `useModalDialog` composable, plus an enter/exit animation. This suite
// exercises that behaviour through the composite-segment picker (chosen as
// the primary example — it's reachable via a plain, always-visible button
// click rather than a file-input `change` event, so "the element focus was
// on before the dialog opened" is a real, assertable DOM node) and confirms
// the SAME Escape/cancel wiring on the import-time rcnx picker too.
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

const { inspectRcnxFile, inspectRczFile, extractZipFile, parseFile } = vi.hoisted(() => ({
  inspectRcnxFile: vi.fn(),
  inspectRczFile: vi.fn(),
  extractZipFile: vi.fn(),
  parseFile: vi.fn(),
}))

vi.mock('@/domain/import/lazyLoaders', () => ({ inspectRcnxFile, inspectRczFile, extractZipFile }))
vi.mock('@/composables/useLogImport', () => ({ useLogImport: () => ({ parseFile }) }))

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function sessionAt(n: number, createdMs: number): LogSession {
  const timeMs = n === 0 ? [0, 1000, 2000] : [0, 1000]
  const speed = n === 0 ? [10, 20, 30] : [40, 50]
  return new LogSession([channel('Time', timeMs), channel('GPS_Speed', speed)], {
    formatId: 'rcnx',
    createdDate: new Date(createdMs),
    headerInfo: { sessionIndex: String(n) },
  })
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
    attachTo: document.body, // real DOM attachment — focus()/activeElement need this to behave
  })
}

function chooseFile(wrapper: ReturnType<typeof mountFileBar>, file: File): Promise<void> {
  const input = wrapper.find<HTMLInputElement>('input[name="logfile"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  return input.trigger('change')
}

/** Escape's leave animation removes the DOM node only once
 *  useOverlayMotion.ts's fallback timeout fires (happy-dom never dispatches
 *  `transitionend` — see useFlipAnimation.test.ts's own note). */
async function waitForDialogClose(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350))
}

beforeEach(() => {
  setActivePinia(createPinia())
  inspectRcnxFile.mockReset()
  inspectRczFile.mockReset()
  extractZipFile.mockReset()
  parseFile.mockReset()
})

describe('FileBar modal dialogs — Escape / focus trap / focus restore (B118b)', () => {
  it('composite picker: focus moves into the dialog on open, restores to the opening button on Escape', async () => {
    const fileStore = useFileStore()
    const id = fileStore.beginImport(new File(['PK'], 'multi.rcnx'))
    fileStore.completeImport(id, sessionAt(0, 0), { sessions: twoSessions, sessionIndex: 0 })

    const wrapper = mountFileBar()
    const openButton = wrapper.find('.composite-btn').element as HTMLElement
    openButton.focus()
    expect(document.activeElement).toBe(openButton)

    await wrapper.find('.composite-btn').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick() // useModalDialog's watcher awaits nextTick itself before focusing

    // First focusable inside `.rcnx-picker` — a checkbox `<label>` isn't
    // itself in FOCUSABLE_SELECTOR, its `<input>` is.
    const firstCheckbox = wrapper.find('.rcnx-session-check input').element
    expect(document.activeElement).toBe(firstCheckbox)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    await waitForDialogClose()

    expect(wrapper.find('.rcnx-picker').exists()).toBe(false)
    expect(document.activeElement).toBe(openButton)
    wrapper.unmount()
  })

  it('composite picker: Tab from the last focusable wraps to the first, Shift+Tab from the first wraps to the last', async () => {
    const fileStore = useFileStore()
    const id = fileStore.beginImport(new File(['PK'], 'multi.rcnx'))
    fileStore.completeImport(id, sessionAt(0, 0), { sessions: twoSessions, sessionIndex: 0 })

    const wrapper = mountFileBar()
    await wrapper.find('.composite-btn').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    // Focusables inside the composite picker, in DOM order: 2 session
    // checkboxes, "取消" (cancel), "組合" (confirm, disabled until 2
    // checked — disabled controls are excluded from the trap).
    const checkboxes = wrapper.findAll('.rcnx-session-check input').map((w) => w.element as HTMLElement)
    const cancelBtn = wrapper.find('.rcnx-picker-cancel').element as HTMLElement
    expect(document.activeElement).toBe(checkboxes[0])

    // Shift+Tab from the first focusable wraps to the last (cancel — the
    // combine button starts disabled, so it's excluded from the trap).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(cancelBtn)

    // Tab from the last wraps back to the first.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(checkboxes[0])

    wrapper.unmount()
  })

  it('import-time rcnx picker: Escape calls the SAME cancel path as the existing Cancel button (removes the in-progress import)', async () => {
    inspectRcnxFile.mockResolvedValue(twoSessions)
    const wrapper = mountFileBar()
    const fileStore = useFileStore()

    const file = new File(['PK'], 'multi.rcnx')
    await chooseFile(wrapper, file)
    await vi.waitFor(() => expect(inspectRcnxFile).toHaveBeenCalledWith(file))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rcnx-picker').exists()).toBe(true)
    expect(fileStore.files).toHaveLength(1) // the in-progress import pill

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    await waitForDialogClose()

    expect(wrapper.find('.rcnx-picker').exists()).toBe(false)
    // cancelPendingRcnx's existing semantics (removes the abandoned import)
    // are unchanged — Escape must trigger exactly that, not a bare close.
    expect(fileStore.files).toHaveLength(0)
    expect(parseFile).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('scrim click still cancels each picker (pre-existing @click.self, unchanged by this task)', async () => {
    const fileStore = useFileStore()
    const id = fileStore.beginImport(new File(['PK'], 'multi.rcnx'))
    fileStore.completeImport(id, sessionAt(0, 0), { sessions: twoSessions, sessionIndex: 0 })

    const wrapper = mountFileBar()
    await wrapper.find('.composite-btn').trigger('click')
    expect(wrapper.find('.rcnx-picker').exists()).toBe(true)

    await wrapper.find('.rcnx-picker-backdrop').trigger('click')
    await waitForDialogClose()
    expect(wrapper.find('.rcnx-picker').exists()).toBe(false)
    wrapper.unmount()
  })
})
