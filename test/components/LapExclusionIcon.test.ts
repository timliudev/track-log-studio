// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import LapExclusionIcon from '@/features/analyzer/LapExclusionIcon.vue'

describe('LapExclusionIcon sector label', () => {
  it('centres a readable two-digit sector label inside the icon', () => {
    const wrapper = mount(LapExclusionIcon, { props: { reason: 'sector', sectorNumber: 12 } })
    const label = wrapper.get('.sector-label')
    expect(label.text()).toBe('S12')
    expect(label.attributes('x')).toBe('12')
    expect(label.attributes('y')).toBe('12')
    expect(label.attributes('dominant-baseline')).toBe('central')
    expect(Number(label.attributes('font-size'))).toBeLessThan(7)
    expect(Number(label.attributes('letter-spacing'))).toBeLessThan(0)
  })

  it('uses a flag for a sector legend without a specific gate number', () => {
    const wrapper = mount(LapExclusionIcon, { props: { reason: 'sector' } })
    expect(wrapper.find('.sector-label').exists()).toBe(false)
    expect(wrapper.find('.sector-flag').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('S?')
  })
})
