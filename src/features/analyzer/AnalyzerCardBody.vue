<script setup lang="ts">
/**
 * F1 — the dashboard-card dispatcher. Given a stable card id (a
 * `STATIC_CARD_IDS` value or a `chart-<id>` dynamic id) plus the shared
 * AnalyzerCardContext, it renders the ONE matching extracted card body — the
 * same content that used to live inline in AnalyzerView's `#item`
 * v-if/else-if chain. Both presentation shells reuse it: the desktop/mobile-
 * full grid wraps `<AnalyzerCardBody>` in a `<DashboardCard>`, and the mobile
 * Focus Stack (MobileFocusStack.vue) wraps it in its own slim header — so the
 * card content is written exactly once and mounted in whichever container is
 * active.
 */
import { computed } from 'vue'
import { STATIC_CARD_IDS, chartItemId } from '@/domain/layout/dashboardLayout'
import type { AnalyzerCardContext } from './analyzerCardContext'
import MapCard from './cards/MapCard.vue'
import LapTableCard from './cards/LapTableCard.vue'
import SectorsCard from './cards/SectorsCard.vue'
import TrackChannelCard from './cards/TrackChannelCard.vue'
import AccelTestCard from './cards/AccelTestCard.vue'
import GearCard from './cards/GearCard.vue'
import CvtDynamicsCard from './cards/CvtDynamicsCard.vue'
import TrackFileCard from './cards/TrackFileCard.vue'
import SessionMergeCard from './cards/SessionMergeCard.vue'
import SuspensionCard from './cards/SuspensionCard.vue'
import CurrentValuesCard from './cards/CurrentValuesCard.vue'
import MapAlignCard from './cards/MapAlignCard.vue'
import LapAlignCard from './cards/LapAlignCard.vue'
import ChartCard from './cards/ChartCard.vue'

const props = defineProps<{ id: string; ctx: AnalyzerCardContext }>()

// A dynamic chart card: resolve the `chart-<id>` item id to its ChartConfig so
// ChartCard can render the right chart kind (see chartItemId — the id is keyed
// by the chart's own store id, stable across add/remove/reorder).
const chart = computed(() => props.ctx.charts.value.find((c) => chartItemId(c.id) === props.id) ?? null)
</script>

<template>
  <MapCard v-if="id === STATIC_CARD_IDS.map" :ctx="ctx" />
  <LapTableCard v-else-if="id === STATIC_CARD_IDS.lapTable" :ctx="ctx" />
  <SectorsCard v-else-if="id === STATIC_CARD_IDS.sectors" :ctx="ctx" />
  <TrackChannelCard v-else-if="id === STATIC_CARD_IDS.trackChannel" :ctx="ctx" />
  <AccelTestCard v-else-if="id === STATIC_CARD_IDS.accelTest" :ctx="ctx" />
  <GearCard v-else-if="id === STATIC_CARD_IDS.gear" :ctx="ctx" />
  <CvtDynamicsCard v-else-if="id === STATIC_CARD_IDS.cvtDynamics" :ctx="ctx" />
  <TrackFileCard v-else-if="id === STATIC_CARD_IDS.trackFile" :ctx="ctx" />
  <SessionMergeCard v-else-if="id === STATIC_CARD_IDS.sessionMerge" :ctx="ctx" />
  <SuspensionCard v-else-if="id === STATIC_CARD_IDS.suspension" :ctx="ctx" />
  <CurrentValuesCard v-else-if="id === STATIC_CARD_IDS.currentValues" :ctx="ctx" />
  <MapAlignCard v-else-if="id === STATIC_CARD_IDS.mapAlign" :ctx="ctx" />
  <LapAlignCard v-else-if="id === STATIC_CARD_IDS.lapAlign" :ctx="ctx" />
  <ChartCard v-else-if="chart" :ctx="ctx" :chart="chart" />
</template>
