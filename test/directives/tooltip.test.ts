// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, withDirectives, resolveDirective } from 'vue'
import { vTooltip } from '@/directives/tooltip'

/**
 * v-tooltip (src/directives/tooltip.ts) replaces the native `title` attribute
 * with a single shared, CSS-themed bubble — the fix for "cards are rounded
 * but the tooltip is a square black OS box" (native `title` can't be styled).
 * These tests cover the directive's own contract: showing/hiding the shared
 * `.app-tooltip` bubble on hover, and the aria-label fallback that keeps
 * icon-only buttons accessible without a visible title attribute.
 *
 * h() doesn't run custom directives the way template compilation does, so
 * each test mounts a small component whose render function applies the
 * directive explicitly via withDirectives — the same runtime path Vue's
 * compiled `v-tooltip="..."` template syntax lowers to.
 */
function mountTooltipButton(text: string | null | undefined, extraAttrs: Record<string, string> = {}) {
  const Comp = defineComponent({
    directives: { tooltip: vTooltip },
    setup() {
      return () =>
        withDirectives(h('button', { type: 'button', ...extraAttrs }, 'x'), [
          [resolveDirective('tooltip') ?? vTooltip, text],
        ])
    },
  })
  return mount(Comp, { attachTo: document.body })
}

describe('v-tooltip directive', () => {
  it('sets aria-label from the tooltip text when the element has none', () => {
    const wrapper = mountTooltipButton('移除欄位')
    expect(wrapper.find('button').attributes('aria-label')).toBe('移除欄位')
    wrapper.unmount()
  })

  it('does not override an explicitly-set aria-label', () => {
    const wrapper = mountTooltipButton('移除欄位', { 'aria-label': '自訂標籤' })
    expect(wrapper.find('button').attributes('aria-label')).toBe('自訂標籤')
    wrapper.unmount()
  })

  it('shows the shared rounded/themed bubble with the tooltip text on hover', async () => {
    const wrapper = mountTooltipButton('移除欄位')
    await wrapper.find('button').trigger('mouseenter')

    const bubble = document.querySelector('.app-tooltip')
    expect(bubble).not.toBeNull()
    expect(bubble!.textContent).toBe('移除欄位')
    expect((bubble as HTMLElement).style.display).toBe('block')
    wrapper.unmount()
  })

  it('hides the bubble again after mouseleave', async () => {
    vi.useFakeTimers()
    const wrapper = mountTooltipButton('移除欄位')
    await wrapper.find('button').trigger('mouseenter')
    await wrapper.find('button').trigger('mouseleave')
    vi.advanceTimersByTime(200)

    const bubble = document.querySelector('.app-tooltip') as HTMLElement
    expect(bubble.style.display).toBe('none')
    wrapper.unmount()
    vi.useRealTimers()
  })

  it('shows nothing for a falsy value (mirrors omitting `title`)', async () => {
    const wrapper = mountTooltipButton(undefined)
    await wrapper.find('button').trigger('mouseenter')
    expect(wrapper.find('button').attributes('aria-label')).toBeUndefined()
    wrapper.unmount()
  })
})
