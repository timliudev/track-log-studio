// @vitest-environment happy-dom
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import CurrentValuesPanel from '@/features/analyzer/CurrentValuesPanel.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'

// B49 persists field-arrangement prefs to localStorage — happy-dom doesn't
// reliably expose a native `localStorage` global, so stub an in-memory one,
// same convention as SuspensionCard.test.ts / dashboardLayout.test.ts.
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
})

function channel(name: string, data: number[]): Channel {
  return { name, rawName: name, description: undefined, data: new Float32Array(data) }
}

function session(channels: Channel[]): LogSession {
  return new LogSession(channels, { formatId: 'test', createdDate: null, headerInfo: {} })
}

function mountPanel(props: { session: LogSession | null; cursorIdx: number | null }) {
  return mount(CurrentValuesPanel, {
    props,
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
    },
  })
}

describe('CurrentValuesPanel (B15/B16 — 目前數值 dashboard card)', () => {
  it('shows a "no session" hint when nothing is loaded', () => {
    const wrapper = mountPanel({ session: null, cursorIdx: null })
    expect(wrapper.find('.hint').exists()).toBe(true)
    expect(wrapper.find('.values-grid').exists()).toBe(false)
  })

  it('renders the synthetic time cell first, then one cell per session channel', () => {
    // Session channels: Time, RPM plus the two synthetic group-rate fields.
    const s = session([channel('Time', [0, 1000, 2000]), channel('RPM', [1000, 2000, 3000])])
    const wrapper = mountPanel({ session: s, cursorIdx: 0 })
    const cells = wrapper.findAll('.value-cell')
    expect(cells).toHaveLength(5)
    expect(cells[0].classes()).toContain('value-cell--time')
    expect(cells[0].find('.value-label').text()).toBe('目前時間')
  })

  it('reads values at the given cursor index', () => {
    const s = session([channel('Time', [0, 1000, 2000]), channel('RPM', [1000, 2000, 3000])])
    const wrapper = mountPanel({ session: s, cursorIdx: 1 })
    const rpmCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('RPM'))!
    expect(rpmCell.find('.value-number').text()).toBe('2000.0')
  })

  it('falls back to the LAST row when there is no cursor', () => {
    const s = session([channel('Time', [0, 1000, 2000]), channel('RPM', [1000, 2000, 3000])])
    const wrapper = mountPanel({ session: s, cursorIdx: null })
    const rpmCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('RPM'))!
    expect(rpmCell.find('.value-number').text()).toBe('3000.0')
  })

  it('formats the synthetic time field as m:ss.mmm using elapsed session time', () => {
    const s = session([channel('Time', [0, 1500, 3000]), channel('RPM', [1000, 2000, 3000])])
    const wrapper = mountPanel({ session: s, cursorIdx: 1 })
    const timeCell = wrapper.find('.value-cell--time')
    expect(timeCell.exists()).toBe(true)
    expect(timeCell.find('.value-number').text()).toBe('0:01.500')
  })

  it('shows an em dash for a value at an index beyond a shorter channel', () => {
    const s = session([channel('Time', [0, 1000, 2000]), channel('Short', [42])])
    const wrapper = mountPanel({ session: s, cursorIdx: 2 })
    const shortCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('Short'))!
    expect(shortCell.find('.value-number').text()).toBe('—')
  })

  // B44 — low-contrast pulse when a cell's DISPLAYED value actually changes.
  describe('B44 — value-change pulse', () => {
    function rpmCellOf(wrapper: ReturnType<typeof mountPanel>) {
      return wrapper.findAll('.value-cell').find((c) => c.text().includes('RPM'))!
    }

    it('does not pulse any cell on the initial render', () => {
      const s = session([channel('Time', [0, 1000, 2000]), channel('RPM', [1000, 2000, 3000])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      expect(wrapper.find('.value-cell--pulse').exists()).toBe(false)
    })

    it('adds the pulse class to a cell whose formatted value changed', async () => {
      const s = session([channel('Time', [0, 1000, 2000]), channel('RPM', [1000, 2000, 3000])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.setProps({ cursorIdx: 1 })
      expect(rpmCellOf(wrapper).classes()).toContain('value-cell--pulse')
    })

    it('does not pulse a cell whose formatted value stayed the same', async () => {
      // "Steady" holds the same value at every sample index, so its
      // displayed text is identical before/after the cursor move — only RPM
      // (which genuinely changes) should pulse.
      const s = session([
        channel('Time', [0, 1000, 2000]),
        channel('RPM', [1000, 2000, 3000]),
        channel('Steady', [7, 7, 7]),
      ])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.setProps({ cursorIdx: 1 })
      const steadyCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('Steady'))!
      expect(steadyCell.classes()).not.toContain('value-cell--pulse')
      // Sanity: RPM (which DID change) still pulses in this same render pass.
      expect(rpmCellOf(wrapper).classes()).toContain('value-cell--pulse')
    })

    it('never pulses the synthetic time cell even though it changes every render', async () => {
      const s = session([channel('Time', [0, 1000, 2000]), channel('RPM', [1000, 2000, 3000])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.setProps({ cursorIdx: 1 })
      const timeCell = wrapper.find('.value-cell--time')
      expect(timeCell.classes()).not.toContain('value-cell--pulse')
    })
  })

  // B49 — field arrangement: sort mode, per-field hide, edit-mode custom
  // reorder. Time field ('目前時間') must stay first, unhideable, unmovable
  // throughout.
  describe('B49 — field arrangement', () => {
    function cellLabels(wrapper: ReturnType<typeof mountPanel>): string[] {
      return wrapper.findAll('.value-label').map((n) => n.attributes('title')!)
    }

    it('defaults to the original channel order with no edit controls shown', () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2]), channel('Throttle', [3])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      expect(cellLabels(wrapper)).toEqual(['目前時間', 'GPS 更新率', 'ECU 更新率', 'RPM', 'GPS_Speed', 'Throttle'])
      expect(wrapper.find('.edit-controls').exists()).toBe(false)
      expect(wrapper.find('.sort-mode-group').exists()).toBe(false)
    })

    it('switches to alphabetical order via the sort-mode control', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2]), channel('Throttle', [3])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      const buttons = wrapper.findAll('.sort-mode-group button')
      await buttons[1].trigger('click') // alphabetical
      expect(cellLabels(wrapper)).toEqual(['目前時間', 'ECU 更新率', 'GPS 更新率', 'GPS_Speed', 'RPM', 'Throttle'])
    })

    it('hides a field via its edit-mode checkbox, and it disappears outside edit mode', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')

      const rpmCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('RPM'))!
      await rpmCell.find('input[type="checkbox"]').setValue(false)
      expect(rpmCell.classes()).toContain('value-cell--hidden')

      // Leave edit mode: the hidden field is gone from the grid entirely.
      await wrapper.find('.edit-toggle-btn').trigger('click')
      expect(cellLabels(wrapper)).toEqual(['目前時間', 'GPS 更新率', 'ECU 更新率', 'GPS_Speed'])
    })

    it('re-shows a hidden field by checking its box again', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      const rpmCell = () => wrapper.findAll('.value-cell').find((c) => c.text().includes('RPM'))!
      await rpmCell().find('input[type="checkbox"]').setValue(false)
      await rpmCell().find('input[type="checkbox"]').setValue(true)
      expect(rpmCell().classes()).not.toContain('value-cell--hidden')
    })

    it('shows hidden fields (dimmed, still checkable) while in edit mode', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      await wrapper
        .findAll('.value-cell')
        .find((c) => c.text().includes('RPM'))!
        .find('input[type="checkbox"]')
        .setValue(false)
      // Still in edit mode: RPM stays listed (dimmed), not removed.
      expect(cellLabels(wrapper)).toEqual(['目前時間', 'GPS 更新率', 'ECU 更新率', 'RPM', 'GPS_Speed'])
    })

    it('only shows up/down move buttons once sortMode is custom', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      expect(wrapper.find('.move-buttons').exists()).toBe(false)

      await wrapper.findAll('.sort-mode-group button')[2].trigger('click') // custom
      expect(wrapper.findAll('.move-buttons').length).toBeGreaterThan(0)
    })

    it('reorders fields with the up/down buttons in custom mode', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2]), channel('Throttle', [3])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      await wrapper.findAll('.sort-mode-group button')[2].trigger('click') // custom

      // Move GPS_Speed up one place within the editable field order.
      const gpsCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('GPS_Speed'))!
      await gpsCell.find('.move-btn:first-child').trigger('click')
      expect(cellLabels(wrapper)).toEqual(['目前時間', 'GPS 更新率', 'ECU 更新率', 'GPS_Speed', 'RPM', 'Throttle'])
    })

    it('disables the up button for the first field and the down button for the last', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      await wrapper.findAll('.sort-mode-group button')[2].trigger('click') // custom

      const firstCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('GPS 更新率'))!
      const gpsCell = wrapper.findAll('.value-cell').find((c) => c.text().includes('GPS_Speed'))!
      expect(firstCell.find('.move-btn:first-child').attributes('disabled')).toBeDefined()
      expect(gpsCell.findAll('.move-btn')[1].attributes('disabled')).toBeDefined()
    })

    it('shows a hint when every field is hidden (outside edit mode)', async () => {
      const s = session([channel('RPM', [1])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      for (const checkbox of wrapper.findAll('input[type="checkbox"]')) await checkbox.setValue(false)
      await wrapper.find('.edit-toggle-btn').trigger('click') // leave edit mode
      expect(wrapper.text()).toContain('所有欄位皆已隱藏')
      // Time cell is still shown even though every channel is hidden.
      expect(cellLabels(wrapper)).toEqual(['目前時間'])
    })

    it('never renders edit controls for the time field', async () => {
      const s = session([channel('RPM', [1])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      const timeCell = wrapper.find('.value-cell--time')
      expect(timeCell.find('.edit-controls').exists()).toBe(false)
    })

    it('persists prefs across remounts (localStorage)', async () => {
      const s = session([channel('RPM', [1]), channel('GPS_Speed', [2])])
      const wrapper1 = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper1.find('.edit-toggle-btn').trigger('click')
      await wrapper1.findAll('.sort-mode-group button')[1].trigger('click') // alphabetical

      const wrapper2 = mountPanel({ session: s, cursorIdx: 0 })
      expect(cellLabels(wrapper2)).toEqual(['目前時間', 'ECU 更新率', 'GPS 更新率', 'GPS_Speed', 'RPM'])
    })

    it('lets the GPS and ECU update-rate fields be hidden like channel fields', async () => {
      const s = session([channel('Time', [0, 100, 200]), channel('RPM', [1, 2, 3])])
      const wrapper = mountPanel({ session: s, cursorIdx: 0 })
      await wrapper.find('.edit-toggle-btn').trigger('click')
      const gpsRate = wrapper.findAll('.value-cell').find((c) => c.text().includes('GPS 更新率'))!
      await gpsRate.find('input[type="checkbox"]').setValue(false)
      await wrapper.find('.edit-toggle-btn').trigger('click')
      expect(cellLabels(wrapper)).not.toContain('GPS 更新率')
      expect(cellLabels(wrapper)[0]).toBe('目前時間')
    })
  })

  it('shows a cached update-rate badge on each raw channel cell', () => {
    const s = session([
      channel('Time', [0, 100, 200, 300]),
      channel('RPM', [1000, 2000, 3000, 4000]),
      channel('Steady', [7, 7, 7, 7]),
    ])
    const wrapper = mountPanel({ session: s, cursorIdx: 0 })
    const rpm = wrapper.findAll('.value-cell').find((c) => c.text().includes('RPM'))!
    const steady = wrapper.findAll('.value-cell').find((c) => c.text().includes('Steady'))!
    expect(rpm.find('.rate-badge').text()).toBe('10.0 Hz')
    expect(steady.find('.rate-badge').text()).toBe('— Hz')
  })

  it('anchors update-rate badges at the lower right without reserving label space', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/analyzer/CurrentValuesPanel.vue'), 'utf8')
    const rateBadgeCss = source.slice(source.indexOf('.rate-badge {'), source.indexOf('.value-cell--time {'))
    expect(rateBadgeCss).toContain('bottom: 7px')
    expect(rateBadgeCss).not.toContain('top: 7px')
    expect(source).not.toContain('.value-cell--with-rate .value-label')
    expect(source).toContain('.value-cell--with-rate {\n  padding-bottom: 20px')
  })
})
