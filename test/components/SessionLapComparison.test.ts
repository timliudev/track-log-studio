// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import SessionLapComparison from '@/features/analyzer/SessionLapComparison.vue'
import { useAnalyzerStore } from '@/stores/analyzerStore'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { LogSession } from '@/domain/model/LogSession'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import type { LapLine } from '@/domain/analysis/laps'
import type { Lap } from '@/domain/model/Lap'
import zhHant from '@/i18n/locales/zh-Hant'

const lap = (index: number, lapTimeMs: number, startIdx = index * 2, endIdx = index * 2 + 2): Lap => ({
  index,
  lapTimeMs,
  startIdx,
  endIdx,
})

/** Build a GpsTrack from lat/lon arrays, marking every sample valid. */
function makeTrack(lat: number[], lon: number[]): GpsTrack {
  return { lat: new Float64Array(lat), lon: new Float64Array(lon), valid: new Uint8Array(lat.length).fill(1) }
}

/** A vertical gate line at lon = x, spanning lat [-1, 1] (same idiom as sectorTiming.test.ts). */
function gateAt(lon: number): LapLine {
  return { a: { lat: -1, lon }, b: { lat: 1, lon } }
}

function comparison(
  session = new LogSession([], { formatId: 'test', createdDate: null, headerInfo: {} }),
  overrides: Partial<ComparisonSession> = {},
): ComparisonSession {
  return {
    id: 2,
    name: 'comparison.loga',
    color: '#ff0000',
    session,
    xValues: new Float64Array(),
    track: { lat: new Float64Array(), lon: new Float64Array(), valid: new Uint8Array() },
    timeMs: new Float64Array(),
    laps: [lap(0, 61_000), lap(1, 62_000)],
    ...overrides,
  }
}

function mountWith(comparisons: ComparisonSession[] = [comparison()]) {
  return mount(SessionLapComparison, {
    props: {
      primaryLaps: [lap(0, 60_000)],
      primaryExcluded: [],
      comparisons,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'zh-Hant', messages: { 'zh-Hant': zhHant } })],
      directives: { tooltip: {} },
    },
  })
}

beforeEach(() => setActivePinia(createPinia()))

describe('SessionLapComparison', () => {
  it('renders every compared lap as a per-lap table row with markers', async () => {
    const analyzer = useAnalyzerStore()
    const wrapper = mountWith()

    // No collapsed disclosure — the laps are always visible as a table.
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.text()).toContain('comparison.loga')
    // Unified count wording with the primary table ("圈數：{n}").
    expect(wrapper.text()).toContain('圈數：2')

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    // Row 1 is the fastest lap (⚡), row 2 the slowest (🐢).
    expect(rows[0].text()).toContain('1:01.000')
    expect(rows[0].text()).toContain('⚡')
    expect(rows[1].text()).toContain('1:02.000')
    expect(rows[1].text()).toContain('🐢')

    await wrapper.find('.chart-align button').trigger('click')
    expect(analyzer.sessionOffsetOf(2).timeSec).toBeCloseTo(-0.1)
  })

  // B1b: no independent checkbox column — clicking the row itself (same
  // interaction as the primary table) toggles the cross-recording overlay
  // selection, and a selected row shows a color swatch in its lead cell
  // (matching the primary table's lead-column rhythm), using the SAME
  // per-session identity color the cross-file highlight on the map draws
  // with (`table.color` === `categoricalColor(fileId)`, see
  // useSessionComparison.ts / crossSessionLapHighlight.ts).
  it('toggles a lap into the cross-recording overlay by clicking its row, with a matching-color swatch', async () => {
    const lapStore = useLapStore()
    const wrapper = mountWith()

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)

    const firstRow = wrapper.findAll('tbody tr')[0]
    expect(lapStore.isSessionLapSelected(2, 0)).toBe(false)
    expect(firstRow.find('.swatch').exists()).toBe(false)

    await firstRow.trigger('click')
    expect(lapStore.isSessionLapSelected(2, 0)).toBe(true)
    const swatch = firstRow.find('.swatch')
    expect(swatch.exists()).toBe(true)
    expect(swatch.attributes('style')).toContain('#ff0000')

    await firstRow.trigger('click')
    expect(lapStore.isSessionLapSelected(2, 0)).toBe(false)
    expect(firstRow.find('.swatch').exists()).toBe(false)
  })

  it('renders the SAME configured columns as the primary table, read-only', async () => {
    const lapStore = useLapStore()
    // A channel column present in the comparison session's own data.
    lapStore.addColumn({ kind: 'channel', channel: 'RPM', agg: 'max' })
    // A sector column: no gates are confirmed in this test (sectorStore.gates
    // is empty), so the sector column must degrade to '—' rather than throw
    // or show a stale value (see the dedicated B17 test below for the case
    // where gates ARE confirmed and actually cross the comparison's track).
    lapStore.addColumn({ kind: 'sectorTime', sector: 0 })
    // A delta column: computed against the comparison's OWN fastest lap.
    lapStore.addColumn({ kind: 'delta' })

    const rpmChannel = { name: 'RPM', rawName: 'RPM', description: undefined, data: Float32Array.from([1000, 2000, 3000, 9000]) }
    const session = new LogSession([rpmChannel], { formatId: 'test', createdDate: null, headerInfo: {} })
    const wrapper = mountWith([comparison(session)])

    const headers = wrapper.findAll('thead th').map((h) => h.text())
    // channel · agg / sector-1 / delta headers appended after #/圈時/距離, same
    // wording as the primary table's columnHeader.
    expect(headers.some((h) => h.includes('RPM'))).toBe(true)
    expect(headers.some((h) => h.includes('1'))).toBe(true) // sector 1 (1-based)

    // Read-only: no column editor controls (channel picker / remove button /
    // add-column buttons) leak into the comparison table.
    expect(wrapper.find('.channel-select').exists()).toBe(false)
    expect(wrapper.find('.remove').exists()).toBe(false)
    expect(wrapper.find('.add-column').exists()).toBe(false)

    const rows = wrapper.findAll('tbody tr')
    // Lap 0 spans samples [0,2] ⇒ RPM max = 3000 ⇒ formatMetricValue(3000) = '3000.0'.
    expect(rows[0].text()).toContain('3000.0')
    // sectorTime degrades to '—' (no sector gates on a comparison track).
    expect(rows[0].text()).toContain('—')
    // delta for lap 0 (61000ms) vs. the comparison's own fastest lap (61000ms) = 0.
    expect(rows[0].text()).toContain('0.000')
  })

  // B17: the shared sector gates apply to the comparison's OWN track too —
  // when they actually cross it, the sector column should populate with real
  // per-lap sector times (computeSectorTimes), not a blanket '—'.
  it('populates the sector column when the shared gates actually cross the comparison track', async () => {
    const lapStore = useLapStore()
    const sectorStore = useSectorStore()
    lapStore.addColumn({ kind: 'sectorTime', sector: 0 })

    // Straight track along lat=0, lon marching 0..10 (same idiom as
    // sectorTiming.test.ts), one gate at lon=3.5. Lap 0 spans the whole
    // track (indices 0..10), time 0..10000ms, so it crosses the gate.
    const track = makeTrack(Array.from({ length: 11 }, () => 0), Array.from({ length: 11 }, (_v, i) => i))
    const timeMs = new Float64Array(Array.from({ length: 11 }, (_v, i) => i * 1000))
    sectorStore.loadDetected([gateAt(3.5)])

    const comparisonWithGates = comparison(undefined, {
      track,
      timeMs,
      laps: [lap(0, 10_000, 0, 10)],
    })
    const wrapper = mountWith([comparisonWithGates])

    const rows = wrapper.findAll('tbody tr')
    // Sector 1 (start -> gate@3.5) crosses between sample 3 (t=3000) and 4
    // (t=4000), interpolated at 3500ms ⇒ formatMsColumn(3500, false) = '3.500'.
    expect(rows[0].text()).toContain('3.500')
    expect(rows[0].text()).not.toContain('—')
  })

  // B2: the valid-lap-time band configured for the primary recording also
  // applies to a comparison recording's OWN laps — read-only (no toggle),
  // just the same dimmed/struck-through mark the primary table uses.
  it('marks a comparison lap outside the configured valid-lap-time band as excluded', async () => {
    const lapStore = useLapStore()
    // Lap 1 (62s) falls outside a 55-61.5s band; lap 0 (61s) stays included.
    lapStore.setLapTimeBand({ minSec: 55, maxSec: 61.5 })

    const wrapper = mountWith()
    const rows = wrapper.findAll('tbody tr')
    expect(rows[0].classes()).not.toContain('excluded')
    expect(rows[1].classes()).toContain('excluded')

    // The band-excluded lap is also removed from the fastest/slowest search:
    // with lap 1 excluded, lap 0 is now BOTH the fastest and (only) included
    // lap, so no slowest marker should render on it.
    expect(rows[0].text()).toContain('⚡')
    expect(rows[0].text()).not.toContain('🐢')
  })
})
