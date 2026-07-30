// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CssGridGrid from '@/features/analyzer/CssGridGrid.vue'
import type { DashboardLayoutItem } from '@/domain/layout/dashboardLayout'

/**
 * F6 stage 1 — CssGridGrid.vue is the new CSS-Grid-based dashboard renderer
 * (see that component's own module doc for the full "why" — replacing
 * grid-layout-plus's `position:absolute` items, which `position:sticky`
 * cannot apply to, with ordinary in-flow CSS Grid items so a pinned card can
 * genuinely stick in place). These tests cover: per-item grid placement, the
 * container's own geometry style, and — the actual payoff — that a pinned
 * id renders with `position:sticky` IN ITS OWN GRID SLOT rather than via any
 * Teleport/separate-anchor mechanism (there is none in this component at
 * all, so "no Teleport target used" is structurally guaranteed, not just
 * asserted).
 */
function mountGrid(props: {
  layout: DashboardLayoutItem[]
  cols?: number
  rowHeight?: number
  marginX?: number
  marginY?: number
  pinnedIds?: string[]
}) {
  return mount(CssGridGrid, {
    props: {
      cols: 12,
      rowHeight: 24,
      marginX: 12,
      marginY: 12,
      ...props,
    },
    slots: {
      item: '<div class="stub-card">{{ params.item.i }}</div>',
    },
  })
}

describe('CssGridGrid', () => {
  const layout: DashboardLayoutItem[] = [
    { i: 'map', x: 0, y: 0, w: 4, h: 12 },
    { i: 'sectors', x: 4, y: 0, w: 4, h: 8 },
    { i: 'chart-1', x: 8, y: 10, w: 4, h: 14 },
  ]

  it('renders one wrapper item per layout entry, in order, via the #item slot', () => {
    const wrapper = mountGrid({ layout })
    const items = wrapper.findAll('.css-grid-item')
    expect(items).toHaveLength(3)
    expect(items.map((el) => el.text())).toEqual(['map', 'sectors', 'chart-1'])
  })

  it('applies grid-column/grid-row placement matching itemGridPlacement', () => {
    const wrapper = mountGrid({ layout })
    const items = wrapper.findAll('.css-grid-item')
    expect(items[0]!.attributes('style')).toContain('grid-column: 1 / span 4')
    expect(items[0]!.attributes('style')).toContain('grid-row: 1 / span 12')
    expect(items[1]!.attributes('style')).toContain('grid-column: 5 / span 4')
    expect(items[2]!.attributes('style')).toContain('grid-column: 9 / span 4')
    expect(items[2]!.attributes('style')).toContain('grid-row: 11 / span 14')
  })

  it('sets the container grid-template-columns/auto-rows/gap/padding from the given metrics', () => {
    const wrapper = mountGrid({ layout, cols: 12, rowHeight: 24, marginX: 12, marginY: 12 })
    const style = wrapper.find('.css-grid-dashboard').attributes('style')
    expect(style).toContain('grid-template-columns: repeat(12, 1fr)')
    expect(style).toContain('grid-auto-rows: 24px')
    expect(style).toContain('gap: 12px 12px')
    // happy-dom's CSSOM normalizes an equal-value shorthand (`12px 12px`) down
    // to the single-value form (`12px`) when serializing `cssText` — this is
    // a browser-engine style-string quirk, not something gridContainerStyle
    // itself controls (the object it returns genuinely has `'12px 12px'`,
    // see cssGridPlacement.test.ts's own direct object-equality assertion).
    expect(style).toContain('padding: 12px')
  })

  it('reflects the mobile single-column metrics (cols:1, marginX:0)', () => {
    const mobileLayout: DashboardLayoutItem[] = [
      { i: 'map', x: 0, y: 0, w: 1, h: 12 },
      { i: 'sectors', x: 0, y: 12, w: 1, h: 8 },
    ]
    const wrapper = mountGrid({ layout: mobileLayout, cols: 1, rowHeight: 24, marginX: 0, marginY: 12 })
    const style = wrapper.find('.css-grid-dashboard').attributes('style')
    expect(style).toContain('grid-template-columns: repeat(1, 1fr)')
    const items = wrapper.findAll('.css-grid-item')
    expect(items[0]!.attributes('style')).toContain('grid-column: 1 / span 1')
    expect(items[1]!.attributes('style')).toContain('grid-row: 13 / span 8')
  })

  describe('pinning — the payoff: sticky in place, no Teleport', () => {
    it('a non-pinned item gets no position/sticky styling and no "pinned" class', () => {
      const wrapper = mountGrid({ layout, pinnedIds: [] })
      const mapItem = wrapper.findAll('.css-grid-item')[0]!
      expect(mapItem.classes()).not.toContain('pinned')
      expect(mapItem.attributes('style')).not.toContain('position: sticky')
    })

    it('a pinned item stays in its OWN grid slot (grid-column/row unchanged) AND becomes position:sticky;top:0', () => {
      const wrapper = mountGrid({ layout, pinnedIds: ['sectors'] })
      const sectorsItem = wrapper.findAll('.css-grid-item')[1]!
      expect(sectorsItem.classes()).toContain('pinned')
      const style = sectorsItem.attributes('style')!
      expect(style).toContain('grid-column: 5 / span 4')
      expect(style).toContain('grid-row: 1 / span 8')
      expect(style).toContain('position: sticky')
      expect(style).toContain('top: 0px')
    })

    it('never renders a Teleport target/anchor element — the sticky item IS the grid item, nothing is relocated', () => {
      const wrapper = mountGrid({ layout, pinnedIds: ['map', 'chart-1'] })
      // The old renderer's Teleport target was `#dashboard-pinned-anchor`;
      // this component has no such element at all, pinned or not.
      expect(wrapper.find('#dashboard-pinned-anchor').exists()).toBe(false)
      expect(wrapper.find('.pinned-anchor').exists()).toBe(false)
      // Exactly 3 grid items still render (none moved to a separate list).
      expect(wrapper.findAll('.css-grid-item')).toHaveLength(3)
    })

    it('multiple pinned ids each independently get sticky styling', () => {
      const wrapper = mountGrid({ layout, pinnedIds: ['map', 'chart-1'] })
      const items = wrapper.findAll('.css-grid-item')
      expect(items[0]!.classes()).toContain('pinned') // map
      expect(items[1]!.classes()).not.toContain('pinned') // sectors
      expect(items[2]!.classes()).toContain('pinned') // chart-1
      expect(items[0]!.attributes('style')).toContain('position: sticky')
      expect(items[2]!.attributes('style')).toContain('position: sticky')
    })
  })
})
