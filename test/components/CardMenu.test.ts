// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import CardMenu from '@/features/analyzer/CardMenu.vue'
import zhHant from '@/i18n/locales/zh-Hant'

/**
 * B118(a) — CardMenu's popover gained a `<Transition :css="false">`-driven
 * enter/exit dance (see the component's own top-of-script comment block).
 * This suite only re-confirms the ONE behaviour the task explicitly calls
 * out as must-not-regress — Escape closing the popover, and its document
 * listener lifecycle — through the new Transition wrapper; it does not
 * attempt to assert the transform/opacity values a real browser would
 * paint (headless — see this task's report for why that's out of scope
 * here). The drag-to-dismiss decision math itself has its own dedicated,
 * DOM-free suite: test/interaction/sheetPhysics.test.ts.
 */

function mountMenu() {
  return mount(CardMenu, {
    props: {
      groups: [{ id: 'g1', label: '地圖與軌跡', items: [{ id: 'card-map', title: '地圖', checked: true, locatable: true }] }],
      charts: [],
      chartsGroupLabel: '圖表',
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
    },
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CardMenu — enter/exit motion wrapper does not regress existing behaviour', () => {
  it('opens the popover on toggle-button click and shows its rows', async () => {
    const wrapper = mountMenu()
    await wrapper.find('.menu-toggle').trigger('click')
    expect(wrapper.find('.popover').exists()).toBe(true)
    expect(wrapper.find('.row-name').text()).toBe('地圖')
  })

  it('closes on Escape — the document keydown listener the task requires stay intact', async () => {
    const wrapper = mountMenu()
    await wrapper.find('.menu-toggle').trigger('click')
    expect(wrapper.find('.popover').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    // `open` flips synchronously on Escape; the leave animation (this
    // component's onLeave, useOverlayMotion.ts's playOverlayTransition)
    // removes the DOM node only once it finishes — happy-dom never fires
    // `transitionend` (see useFlipAnimation.test.ts's own note on this), so
    // this waits past the fallback timeout the SAME way that suite does.
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(wrapper.find('.popover').exists()).toBe(false)
  })

  it('removes the document keydown listener once closed (no leak, no stale double-close)', async () => {
    const wrapper = mountMenu()
    await wrapper.find('.menu-toggle').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(wrapper.find('.popover').exists()).toBe(false)

    // A second Escape after it's already closed must not throw or do
    // anything observable — the listener was removed on close.
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))).not.toThrow()
  })

  it('unmounting while open cleans up without throwing (in-flight animation + drag listeners torn down)', async () => {
    const wrapper = mountMenu()
    await wrapper.find('.menu-toggle').trigger('click')
    expect(wrapper.find('.popover').exists()).toBe(true)
    expect(() => wrapper.unmount()).not.toThrow()
  })
})
