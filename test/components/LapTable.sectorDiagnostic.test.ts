// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import LapTable from '@/features/analyzer/LapTable.vue'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import zhHant from '@/i18n/locales/zh-Hant'
import type { Lap } from '@/domain/model/Lap'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'

const laps: Lap[] = [
  { index: 0, startIdx: 0, endIdx: 10, lapTimeMs: 50_000 },
  { index: 1, startIdx: 0, endIdx: 5, lapTimeMs: 25_000 },
]

const track: GpsTrack = {
  lat: new Float64Array(11),
  lon: Float64Array.from({ length: 11 }, (_, index) => index),
  valid: new Uint8Array(11).fill(1),
}

function gateAt(lon: number): LapLine {
  return { a: { lat: -1, lon }, b: { lat: 1, lon } }
}

let pinia: ReturnType<typeof createPinia>

function mountTable() {
  return mount(LapTable, {
    props: { laps, track, timeMs: null, session: null, hasEcuLaps: false },
    global: {
      plugins: [pinia, createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      directives: { tooltip: {} },
      stubs: { SessionLapComparison: true },
    },
  })
}

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})

describe('LapTable all-failed sector diagnostics', () => {
  it('shows a non-exclusion S<n> diagnostic beside every failed lap when B67 preserves all laps', () => {
    const lapStore = useLapStore()
    lapStore.setTrack(track)
    lapStore.setLaps(laps)
    useSectorStore().setGates([gateAt(3.5), gateAt(20)])
    expect(lapStore.sectorAllFailed).toBe(true)

    const wrapper = mountTable()
    const diagnostics = wrapper.findAll('.sector-failure-diagnostic')
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics.map((marker) => marker.text())).toEqual(['S2', 'S2'])
    expect(diagnostics[0].attributes('aria-label')).toBe('未通過 S2 sector 檢查；因所有圈皆失敗，未套用自動排除。')
    expect(wrapper.findAll('.exclude').every((toggle) => toggle.attributes('disabled') == null)).toBe(true)
    expect(wrapper.findAll('.exclude').every((toggle) => toggle.attributes('aria-pressed') === 'false')).toBe(true)
  })

  it('shows no sector marker after gates are truly removed', () => {
    const lapStore = useLapStore()
    lapStore.setTrack(track)
    lapStore.setLaps(laps)
    useSectorStore().clearGates()

    const wrapper = mountTable()
    expect(lapStore.excluded).toEqual([])
    expect(wrapper.find('.sector-failure-diagnostic').exists()).toBe(false)
  })

  it('keeps a partial failure as the existing disabled S<n> exclusion toggle', () => {
    const lapStore = useLapStore()
    lapStore.setTrack(track)
    lapStore.setLaps(laps)
    useSectorStore().setGates([gateAt(3.5), gateAt(7.5)])
    expect(lapStore.sectorAllFailed).toBe(false)
    expect(lapStore.exclusionReason(1)).toBe('sector')

    const wrapper = mountTable()
    expect(wrapper.find('.sector-failure-diagnostic').exists()).toBe(false)
    const toggles = wrapper.findAll('.exclude')
    expect(toggles[1].attributes('disabled')).toBeDefined()
    expect(toggles[1].classes()).toContain('auto-disabled')
    expect(toggles[1].find('text').text()).toBe('S2')
  })
})
