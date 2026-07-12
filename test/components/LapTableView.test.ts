// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import LapTableView from '@/features/analyzer/LapTableView.vue'
import type { LapTableRow } from '@/domain/analysis/sessionLapSummary'
import type { LapMetricColumn } from '@/stores/lapStore'
import zhHant from '@/i18n/locales/zh-Hant'

const row = (overrides: Partial<LapTableRow> = {}): LapTableRow => ({
  index: 0,
  lapTimeMs: 61_000,
  distanceM: 900,
  isFastest: false,
  isSlowest: false,
  isExcluded: false,
  cells: [],
  ...overrides,
})

function i18nPlugin() {
  return createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })
}

function mountView(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(LapTableView as any, {
    props: { rows: [row()], columns: [], ...props },
    slots,
    global: { plugins: [i18nPlugin()], directives: { tooltip: {} } },
  })
}

describe('LapTableView', () => {
  it('renders the built-in #/time/distance columns plus any configured columns, shared by primary + comparison', () => {
    const columns: LapMetricColumn[] = [{ id: 1, metric: { kind: 'delta' } }]
    const wrapper = mountView({
      rows: [row({ cells: [1500] })],
      columns,
    })
    const headers = wrapper.findAll('thead th').map((h) => h.text())
    expect(headers).toEqual(['#', '圈時', '距離', '差距'])

    const cells = wrapper.findAll('tbody td').map((c) => c.text())
    // lead cell defaults to plain "1" (index+1) when no `lead` slot is supplied.
    expect(cells[0]).toBe('1')
    expect(cells[1]).toContain('1:01.000')
    expect(cells[2]).toBe('0.900 km')
    // delta cell formatted signed-seconds via formatLapMetricCell.
    expect(cells[3]).toBe('+1.500')
  })

  it('shows the fastest/slowest markers and the empty-state message', () => {
    const wrapper = mountView({
      rows: [row({ index: 0, isFastest: true }), row({ index: 1, isSlowest: true, lapTimeMs: 65_000 })],
    })
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].text()).toContain('⚡')
    expect(rows[1].text()).toContain('🐢')

    const empty = mountView({ rows: [] })
    expect(empty.find('table').exists()).toBe(false)
    expect(empty.text()).toContain('尚未偵測到圈次')
  })

  it('applies selected/excluded row classes and emits row-click', async () => {
    const wrapper = mountView({
      rows: [row({ index: 0, isExcluded: true }), row({ index: 1 })],
      isRowSelected: (i: number) => i === 1,
    })
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].classes()).toContain('excluded')
    expect(rows[1].classes()).toContain('selected')

    await rows[1].trigger('click')
    expect(wrapper.emitted('row-click')?.[0]).toEqual([1])
  })

  it('renders optional lead/trail slot columns only when the caller supplies them', () => {
    const withSlots = mountView(
      { rows: [row()] },
      {
        lead: '<span class="lead-cell">lead</span>',
        'trail-header': '<span class="th">trail</span>',
        trail: '<input type="text" class="trail-input" />',
      },
    )
    expect(withSlots.find('.lead-cell').exists()).toBe(true)
    expect(withSlots.find('.offset-col').exists()).toBe(true)
    expect(withSlots.find('.trail-input').exists()).toBe(true)

    // No trail slot supplied ⇒ no offset-col rendered.
    const withoutTrail = mountView({ rows: [row()] })
    expect(withoutTrail.find('.offset-col').exists()).toBe(false)

    const readonly = mountView({ rows: [row()], readonly: true })
    expect(readonly.find('table').attributes('aria-readonly')).toBe('true')
  })
})
