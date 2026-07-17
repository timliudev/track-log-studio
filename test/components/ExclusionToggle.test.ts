// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ExclusionToggle from '@/features/analyzer/ExclusionToggle.vue'

function mountToggle(props: Record<string, unknown> = {}) {
  return mount(ExclusionToggle, {
    props: { excluded: false, label: 'Exclude result', ...props },
    global: { directives: { tooltip: {} } },
  })
}

afterEach(() => document.documentElement.removeAttribute('data-any-pointer-coarse'))

describe('ExclusionToggle', () => {
  it('shares the exclusion click and pressed state', async () => {
    const wrapper = mountToggle({ excluded: true, label: 'Restore result' })
    const button = wrapper.get('.exclude')
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.attributes('aria-label')).toBe('Restore result')
    await button.trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([[]])
  })

  it('uses a real disabled button for locked automatic exclusions', async () => {
    const wrapper = mountToggle({ excluded: true, disabled: true, label: 'Automatically excluded' })
    const button = wrapper.get('.exclude')
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-disabled')).toBe('true')
    await button.trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('expands the shared target to 44px for a coarse pointer', () => {
    document.documentElement.setAttribute('data-any-pointer-coarse', '')
    const wrapper = mountToggle()
    // happy-dom does not apply scoped :root selectors, but the same CSS
    // variables drive the normal and coarse rules in ExclusionToggle.vue.
    const style = wrapper.get('.exclude').attributes('style')
    expect(style).toContain('--exclude-toggle-coarse-size: 44px')
  })
})
