// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import AccelTestPanel from '@/features/analyzer/AccelTestPanel.vue'
import type { AccelSegment } from '@/domain/analysis/accelTest'
import zhHant from '@/i18n/locales/zh-Hant'

function seg(
  startIdx: number,
  endIdx: number,
  isFastest = false,
  timeMs = 1000,
  peakSpeedKmh = 100,
  autoExcludedReason: AccelSegment['autoExcludedReason'] = null,
): AccelSegment {
  return {
    startIdx,
    endIdx,
    timeMs,
    distanceM: 100,
    entrySpeedKmh: 0,
    exitSpeedKmh: 100,
    peakSpeedKmh,
    speedIntegratedDistanceM: 100,
    movingTimeRatio: 1,
    autoExcludedReason,
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

// B53: entry/exit speed alone can misread as a bug when a run peaks
// mid-window and brakes off before the mark resolves (real-log case:
// faster time, lower end speed than another segment) — the panel now
// shows the peak speed for exactly that shape, and stays quiet otherwise.
describe('AccelTestPanel peak speed affordance (B53)', () => {
  it('shows the peak speed when the run peaked well above its exit speed', () => {
    // exitSpeedKmh defaults to 100 in the seg() helper; peakSpeedKmh=150
    // here means the run braked off from 150 down to 100 before the mark.
    const wrapper = mountPanel([seg(0, 10, true, 1000, 150)])
    const peak = wrapper.find('.result-peak')
    expect(peak.exists()).toBe(true)
    expect(peak.text()).toContain('150.0 km/h')
  })

  it('stays quiet for a monotonic run whose peak equals its exit speed', () => {
    const wrapper = mountPanel([seg(0, 10, true, 1000, 100)])
    expect(wrapper.find('.result-peak').exists()).toBe(false)
  })
})

describe('AccelTestPanel result exclusion', () => {
  it('shows automatic quality exclusions without allowing them to own the fastest badge', () => {
    const wrapper = mountPanel([
      seg(0, 1, false, 1000, 2, 'gpsJump'),
      seg(10, 20, true, 4000),
    ])
    const rows = wrapper.findAll('.result')
    expect(rows[0].classes()).toContain('excluded')
    expect(rows[0].find('.exclusion-reason').text()).toContain('GPS 重新定位')
    expect(rows[0].find('.fastest-badge').exists()).toBe(false)
    expect(rows[1].classes()).toContain('fastest')
    expect(wrapper.find('.result-count').text()).toContain('可用 1，已排除 1')
  })

  it('can restore an automatically excluded result and recomputes the fastest row', async () => {
    const wrapper = mountPanel([
      seg(0, 1, false, 1000, 2, 'gpsJump'),
      seg(10, 20, true, 4000),
    ])
    await wrapper.findAll('.exclude-btn')[0].trigger('click')
    const rows = wrapper.findAll('.result')
    expect(rows[0].classes()).not.toContain('excluded')
    expect(rows[0].classes()).toContain('fastest')
    expect(rows[0].find('.exclude-btn').text()).toBe('排除此區段')
    expect(rows[1].classes()).not.toContain('fastest')
  })

  it('can manually exclude and restore an otherwise valid result', async () => {
    const wrapper = mountPanel([seg(0, 10, true, 1000), seg(20, 30, false, 2000)])
    const firstButton = wrapper.findAll('.exclude-btn')[0]
    await firstButton.trigger('click')
    expect(wrapper.findAll('.result')[0].classes()).toContain('excluded')
    expect(firstButton.text()).toBe('恢復此區段')
    expect(wrapper.findAll('.result')[1].classes()).toContain('fastest')

    await firstButton.trigger('click')
    expect(wrapper.findAll('.result')[0].classes()).not.toContain('excluded')
    expect(wrapper.findAll('.result')[0].classes()).toContain('fastest')
  })
})
