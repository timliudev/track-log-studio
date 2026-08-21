// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import SectorPanel from '@/features/analyzer/SectorPanel.vue'
import { useSectorStore } from '@/stores/sectorStore'
import type { LapLine } from '@/domain/analysis/laps'
import zhHant from '@/i18n/locales/zh-Hant'

function mountPanel(props: { failedCount?: number; allFailed?: boolean } = {}) {
  return mount(SectorPanel, {
    props: {
      laps: [],
      failedCount: props.failedCount ?? 0,
      allFailed: props.allFailed ?? false,
      track: null,
      timeMs: null,
      cursorIdx: null,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      directives: { tooltip: {} },
    },
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('SectorPanel', () => {
  // B3: a comparison-recording lap table was wrongly duplicated into the
  // sector-gate card (it already renders once under the main lap-table card,
  // via LapTable.vue). SectorPanel no longer mounts SessionLapComparison at
  // all — comparison lap tables belong under the lap-table card only.
  it('does not render the comparison lap-table section', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.session-summary').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('比較記錄圈次')
  })

  it('shows the raw failure count and all-failed policy warning together', () => {
    const wrapper = mountPanel({ failedCount: 9, allFailed: true })
    expect(wrapper.text()).toContain('9 圈未通過 sector 檢查')
    expect(wrapper.text()).toContain('所有圈次皆未通過 sector 檢查')
    expect(wrapper.text()).toContain('目前不套用自動排除')
  })

  // B133 — regression guard: before the fix, a huge gate count (e.g. ~142 on
  // a large circuit) grew `.optimal-sectors` (in CardFillScroll's unbounded
  // `#header` slot) large enough to squeeze `.card-fill-scroll__content` — the
  // actual `.gate-list` + remove buttons — out of the layout entirely.
  // happy-dom doesn't run real layout (see `test/lint/cardFillScrollHeaderCap
  // .test.ts` for the CSS-source-text half of this guard), so what's
  // verifiable here is structural: with a large gate count, BOTH the
  // theoretical-best sector list (one `<li>` per gate) AND the gate list with
  // its remove buttons still exist in the rendered DOM tree — a naive fix
  // that hid or truncated the gate list outright would fail this.
  it('keeps the gate list and remove buttons in the DOM when gate count explodes (large-circuit auto-detect)', () => {
    const GATE_COUNT = 142
    const gates: LapLine[] = Array.from({ length: GATE_COUNT }, (_, i) => ({
      a: { lat: 24 + i * 0.0001, lon: 121 + i * 0.0001 },
      b: { lat: 24 + i * 0.0001, lon: 121.0001 + i * 0.0001 },
    }))
    setActivePinia(createPinia())
    useSectorStore().loadDetected(gates)

    const wrapper = mountPanel()

    // Theoretical-best summary (B47) still renders — just no data yet since
    // laps/track/timeMs are all empty/null, so it's the "no data" branch.
    expect(wrapper.find('.optimal').exists()).toBe(true)

    // The actual gate list (in CardFillScroll's content pane) is present
    // with every gate and every remove button reachable.
    const gateList = wrapper.find('.gate-list')
    expect(gateList.exists()).toBe(true)
    expect(gateList.findAll('li')).toHaveLength(GATE_COUNT)
    expect(wrapper.findAll('.gate-remove')).toHaveLength(GATE_COUNT)
  })
})
