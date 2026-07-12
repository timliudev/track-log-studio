// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import CurrentValuesPanel from '@/features/analyzer/CurrentValuesPanel.vue'
import { LogSession } from '@/domain/model/LogSession'
import type { Channel } from '@/domain/model/types'
import zhHant from '@/i18n/locales/zh-Hant'

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
    // Session channels: Time, RPM -> fields: [synthetic time, Time channel, RPM channel].
    const s = session([channel('Time', [0, 1000, 2000]), channel('RPM', [1000, 2000, 3000])])
    const wrapper = mountPanel({ session: s, cursorIdx: 0 })
    const cells = wrapper.findAll('.value-cell')
    expect(cells).toHaveLength(3)
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
})
