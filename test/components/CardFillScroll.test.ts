// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CardFillScroll from '@/components/CardFillScroll.vue'

/**
 * B24 — shared "fill card height, scroll internally" container. These tests
 * are deliberately structural (slot presence / DOM shape) rather than
 * asserting computed CSS values: jsdom/happy-dom don't run a real layout
 * engine, so the actual fill/scroll behaviour is verified visually (see the
 * task's own acceptance note) — what's mechanically checkable here is that
 * the header slot is optional and that both slots render into their own
 * distinct wrapper.
 */
describe('CardFillScroll', () => {
  it('renders only the content wrapper when no header slot is provided', () => {
    const wrapper = mount(CardFillScroll, {
      slots: { default: '<p class="body-content">hello</p>' },
    })
    expect(wrapper.find('.card-fill-scroll__header').exists()).toBe(false)
    expect(wrapper.find('.card-fill-scroll__content').exists()).toBe(true)
    expect(wrapper.find('.body-content').exists()).toBe(true)
  })

  it('renders the header wrapper when a header slot is given, alongside the content wrapper', () => {
    const wrapper = mount(CardFillScroll, {
      slots: {
        header: '<div class="controls">controls</div>',
        default: '<ul class="list"><li>item</li></ul>',
      },
    })
    const header = wrapper.find('.card-fill-scroll__header')
    const content = wrapper.find('.card-fill-scroll__content')
    expect(header.exists()).toBe(true)
    expect(content.exists()).toBe(true)
    expect(header.find('.controls').exists()).toBe(true)
    expect(content.find('.list').exists()).toBe(true)
    // The header must come before the content in DOM order (fixed controls
    // above the scrolling list).
    expect(wrapper.element.children[0]).toBe(header.element)
    expect(wrapper.element.children[1]).toBe(content.element)
  })

  it('passes through a class on the root so callers can layer their own styling', () => {
    const wrapper = mount(CardFillScroll, {
      attrs: { class: 'accel-test-panel' },
      slots: { default: '<p>x</p>' },
    })
    expect(wrapper.classes()).toContain('card-fill-scroll')
    expect(wrapper.classes()).toContain('accel-test-panel')
  })
})
