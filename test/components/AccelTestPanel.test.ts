// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import AccelTestPanel from '@/features/analyzer/AccelTestPanel.vue'
import type { AccelSegment } from '@/domain/analysis/accelTest'
import zhHant from '@/i18n/locales/zh-Hant'

function seg(startIdx: number, endIdx: number, isFastest = false, timeMs = 1000): AccelSegment {
  return {
    startIdx,
    endIdx,
    timeMs,
    distanceM: 100,
    entrySpeedKmh: 0,
    exitSpeedKmh: 100,
    peakSpeedKmh: 100,
    isFastest,
  }
}

function mountPanel(results: AccelSegment[]) {
  return mount(AccelTestPanel, {
    props: { results, speedAvailable: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
    },
  })
}

beforeEach(() => setActivePinia(createPinia()))

// B26: a focused segment (zooms the chart/map to its span, via the `focus`
// emit) previously had no way back out. These tests cover the two new exits:
// re-clicking the already-focused row's button, and the panel-level "clear
// focus" button — both should emit `clear` (not another `focus`) and drop the
// `.focused` highlight/active button state.
describe('AccelTestPanel focus/unfocus (B26)', () => {
  it('emits focus on first click and highlights the row + button', async () => {
    const wrapper = mountPanel([seg(0, 10, true)])
    const btn = wrapper.find('.focus-btn')
    await btn.trigger('click')

    expect(wrapper.emitted('focus')).toHaveLength(1)
    expect(wrapper.emitted('focus')![0][0]).toMatchObject({ startIdx: 0, endIdx: 10 })
    expect(wrapper.find('.result').classes()).toContain('focused')
    expect(btn.classes()).toContain('active')
    expect(btn.text()).toBe('取消聚焦')
  })

  it('re-clicking the focused row emits clear instead of another focus', async () => {
    const wrapper = mountPanel([seg(0, 10, true)])
    const btn = wrapper.find('.focus-btn')
    await btn.trigger('click')
    await btn.trigger('click')

    expect(wrapper.emitted('focus')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect(wrapper.find('.result').classes()).not.toContain('focused')
    expect(btn.text()).toBe('聚焦此區段')
  })

  it('shows a panel-level clear-focus button only while something is focused', async () => {
    const wrapper = mountPanel([seg(0, 10, true), seg(20, 30)])
    expect(wrapper.find('.clear-focus-btn').exists()).toBe(false)

    await wrapper.findAll('.focus-btn')[0].trigger('click')
    expect(wrapper.find('.clear-focus-btn').exists()).toBe(true)

    await wrapper.find('.clear-focus-btn').trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect(wrapper.find('.clear-focus-btn').exists()).toBe(false)
  })

  it('focusing a second segment moves the highlight without an extra clear', async () => {
    const wrapper = mountPanel([seg(0, 10, true), seg(20, 30)])
    const buttons = wrapper.findAll('.focus-btn')
    await buttons[0].trigger('click')
    await buttons[1].trigger('click')

    expect(wrapper.emitted('focus')).toHaveLength(2)
    expect(wrapper.emitted('clear')).toBeUndefined()
    const results = wrapper.findAll('.result')
    expect(results[0].classes()).not.toContain('focused')
    expect(results[1].classes()).toContain('focused')
  })

  it('clears a stale focus when the results array changes (e.g. condition edited)', async () => {
    const wrapper = mountPanel([seg(0, 10, true)])
    await wrapper.find('.focus-btn').trigger('click')
    expect(wrapper.find('.result').classes()).toContain('focused')

    await wrapper.setProps({ results: [seg(0, 10, true)] })

    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect(wrapper.find('.result').classes()).not.toContain('focused')
  })
})

// B48: results render fastest-to-slowest regardless of the chronological
// order they arrive in via props (the search functions themselves stay
// chronological — see accelTest.test.ts).
describe('AccelTestPanel result ordering (B48)', () => {
  it('renders segments sorted by timeMs ascending, fastest on top', () => {
    // Chronological order (by startIdx): 8s, 4s(fastest), 6s.
    const wrapper = mountPanel([
      seg(0, 10, false, 8000),
      seg(20, 30, true, 4000),
      seg(40, 50, false, 6000),
    ])
    const times = wrapper.findAll('.result-time').map((n) => n.text())
    expect(times).toEqual(['0:04.000', '0:06.000', '0:08.000'])
    // The fastest badge stays on the (now first) fastest segment.
    expect(wrapper.findAll('.result')[0].classes()).toContain('fastest')
    expect(wrapper.find('.fastest-badge').exists()).toBe(true)
  })

  it('keeps focus mapped to the correct segment after sorting', async () => {
    const wrapper = mountPanel([
      seg(0, 10, false, 8000),
      seg(20, 30, true, 4000),
      seg(40, 50, false, 6000),
    ])
    // Focus the row now displayed second (the 6s segment, startIdx 40).
    const buttons = wrapper.findAll('.focus-btn')
    await buttons[1].trigger('click')

    expect(wrapper.emitted('focus')![0][0]).toMatchObject({ startIdx: 40, endIdx: 50 })
    const results = wrapper.findAll('.result')
    expect(results[1].classes()).toContain('focused')
    expect(results[0].classes()).not.toContain('focused')
    expect(results[2].classes()).not.toContain('focused')
  })
})
