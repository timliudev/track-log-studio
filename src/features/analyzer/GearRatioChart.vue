<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { useChannelRoleStore } from '@/stores/channelRoleStore'
import { cachedGearRatioTrace } from '@/domain/analysis/gearRatioTrace'
import { MEASURED_TOTAL_RATIO_CHANNEL } from '@/domain/analysis/analyzerChannels'
import type { ComparisonSession } from '@/composables/useSessionComparison'
import TimeSeriesChart from './TimeSeriesChart.vue'

const props = defineProps<{
  session: LogSession
  xValues: Float64Array
  xRange?: { min: number; max: number } | null
  externalCursor?: number | null
  selectedLaps?: Lap[]
  comparisonSessions?: ComparisonSession[]
  primaryFileId?: number | null
  primaryFileName?: string
  fillHeight?: boolean
}>()

const emit = defineEmits<{
  cursor: [number | null]
  xZoom: [{ min: number; max: number } | null]
}>()

const { t } = useI18n()
const drivetrain = useDrivetrainStore()
const channelRoleStore = useChannelRoleStore()
const circumferenceMm = computed(() =>
  drivetrain.kind === 'mt'
    ? drivetrain.inversionWheelCircumferenceMm
    : drivetrain.cvt.wheelCircumferenceMm,
)
// B134 — overrides threaded through so a mapping set elsewhere (e.g. via
// GearPanel's ChannelRolePicker) reactively unblocks this chart too, even
// though this component doesn't host its own picker — see the module's B134
// note in TimeSeriesChart.vue for why the picker itself isn't wired HERE.
const trace = computed(() => cachedGearRatioTrace(props.session, circumferenceMm.value, channelRoleStore.overrides))
const STORAGE_KEY = 'tracklogstudio.gearChartChannels.v1'
function loadExtraChannels(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && id !== MEASURED_TOTAL_RATIO_CHANNEL)
      : []
  } catch {
    return []
  }
}
const extraChannels = ref<string[]>(loadExtraChannels())
watch(extraChannels, (value) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* optional UI persistence */ }
}, { deep: true })
const channelIds = computed(() => [MEASURED_TOTAL_RATIO_CHANNEL, ...extraChannels.value])
function updateChannels(ids: string[]): void {
  extraChannels.value = ids.filter((id) => id !== MEASURED_TOTAL_RATIO_CHANNEL)
}
const emptyMessage = computed(() => {
  switch (trace.value.error) {
    case 'rpm':
      return t('analyzer.gear.noRpmChannel') as string
    case 'speed':
      return t('analyzer.gear.noSpeedChannel') as string
    case 'circumference':
      return t('analyzer.gear.invalidCircumference') as string
    default:
      return t('analyzer.gear.noRatioSamples') as string
  }
})
</script>

<template>
  <TimeSeriesChart
    :session="session"
    :x-values="xValues"
    :x-range="xRange"
    :external-cursor="externalCursor"
    :selected-laps="selectedLaps"
    :comparison-sessions="comparisonSessions"
    :primary-file-id="primaryFileId"
    :primary-file-name="primaryFileName"
    :channel-ids="channelIds"
    :locked-channels="[MEASURED_TOTAL_RATIO_CHANNEL]"
    :empty-message="emptyMessage"
    :fill-height="fillHeight"
    @cursor="emit('cursor', $event)"
    @x-zoom="emit('xZoom', $event)"
    @update-channels="updateChannels"
  />
</template>
