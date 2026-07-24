// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { shallowMount } from '@vue/test-utils'
import AnalyzerCardBody from '@/features/analyzer/AnalyzerCardBody.vue'
import MapCard from '@/features/analyzer/cards/MapCard.vue'
import LapTableCard from '@/features/analyzer/cards/LapTableCard.vue'
import SectorsCard from '@/features/analyzer/cards/SectorsCard.vue'
import TrackChannelCard from '@/features/analyzer/cards/TrackChannelCard.vue'
import AccelTestCard from '@/features/analyzer/cards/AccelTestCard.vue'
import GearCard from '@/features/analyzer/cards/GearCard.vue'
import CvtDynamicsCard from '@/features/analyzer/cards/CvtDynamicsCard.vue'
import TrackFileCard from '@/features/analyzer/cards/TrackFileCard.vue'
import SessionMergeCard from '@/features/analyzer/cards/SessionMergeCard.vue'
import SuspensionCard from '@/features/analyzer/cards/SuspensionCard.vue'
import CurrentValuesCard from '@/features/analyzer/cards/CurrentValuesCard.vue'
import MapAlignCard from '@/features/analyzer/cards/MapAlignCard.vue'
import LapAlignCard from '@/features/analyzer/cards/LapAlignCard.vue'
import ChartCard from '@/features/analyzer/cards/ChartCard.vue'
import { STATIC_CARD_IDS, chartItemId } from '@/domain/layout/dashboardLayout'
import type { AnalyzerCardContext } from '@/features/analyzer/analyzerCardContext'
import type { ChartConfig } from '@/stores/analyzerStore'

/**
 * F1 — the card-body dispatcher is the single mapping from a stable card id to
 * the extracted card component that renders it (the same mapping the desktop
 * grid and the mobile Focus Stack both go through). Every id MUST resolve to
 * exactly its own card; a wrong branch would silently render the wrong panel
 * in both presentations. shallowMount stubs the (heavy) card children so this
 * asserts the routing only, not each card's internals.
 */
function makeCtx(charts: ChartConfig[]): AnalyzerCardContext {
  // Only `charts` is read by the dispatcher itself (to resolve a chart id) —
  // every other field is merely forwarded to a now-stubbed child, so a minimal
  // object is enough to exercise the routing.
  return { charts: ref(charts) } as unknown as AnalyzerCardContext
}

function mountBody(id: string, charts: ChartConfig[] = []) {
  return shallowMount(AnalyzerCardBody, { props: { id, ctx: makeCtx(charts) } })
}

describe('AnalyzerCardBody (card dispatcher)', () => {
  const cases: [string, unknown][] = [
    [STATIC_CARD_IDS.map, MapCard],
    [STATIC_CARD_IDS.lapTable, LapTableCard],
    [STATIC_CARD_IDS.sectors, SectorsCard],
    [STATIC_CARD_IDS.trackChannel, TrackChannelCard],
    [STATIC_CARD_IDS.accelTest, AccelTestCard],
    [STATIC_CARD_IDS.gear, GearCard],
    [STATIC_CARD_IDS.cvtDynamics, CvtDynamicsCard],
    [STATIC_CARD_IDS.trackFile, TrackFileCard],
    [STATIC_CARD_IDS.sessionMerge, SessionMergeCard],
    [STATIC_CARD_IDS.suspension, SuspensionCard],
    [STATIC_CARD_IDS.currentValues, CurrentValuesCard],
    [STATIC_CARD_IDS.mapAlign, MapAlignCard],
    [STATIC_CARD_IDS.lapAlign, LapAlignCard],
  ]

  it.each(cases)('resolves static id %s to its own card', (id, component) => {
    const wrapper = mountBody(id)
    expect(wrapper.findComponent(component as never).exists()).toBe(true)
    // And to NOTHING else: exactly one extracted card renders.
    for (const [, other] of cases) {
      if (other !== component) {
        expect(wrapper.findComponent(other as never).exists()).toBe(false)
      }
    }
    expect(wrapper.findComponent(ChartCard).exists()).toBe(false)
  })

  it('resolves a chart-<id> id to ChartCard with the matching ChartConfig', () => {
    const chart: ChartConfig = { kind: 'timeseries', id: 7, channels: [] }
    const wrapper = mountBody(chartItemId(7), [chart])
    const chartCard = wrapper.findComponent(ChartCard)
    expect(chartCard.exists()).toBe(true)
    expect(chartCard.props('chart')).toEqual(chart)
    expect(wrapper.findComponent(MapCard).exists()).toBe(false)
  })

  it('renders nothing for a chart id whose chart no longer exists', () => {
    const wrapper = mountBody(chartItemId(99), [{ kind: 'timeseries', id: 7, channels: [] }])
    expect(wrapper.findComponent(ChartCard).exists()).toBe(false)
  })
})
