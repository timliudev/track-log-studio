<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LogSession } from '@/domain/model/LogSession'
import type { Lap } from '@/domain/model/Lap'
import type { ChartMode } from '@/stores/analyzerStore'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { buildGearRatioTrace } from '@/domain/analysis/gearRatioTrace'
import TimeSeriesChart from './TimeSeriesChart.vue'

const props = defineProps<{
  mode: ChartMode
  session: LogSession
  xValues: Float64Array
  xRange?: { min: number; max: number } | null
  externalCursor?: number | null
  selectedLaps?: Lap[]
  fillHeight?: boolean
}>()

const emit = defineEmits<{
  cursor: [number | null]
  xZoom: [{ min: number; max: number }]
  updateMode: [ChartMode]
}>()

const { t } = useI18n()
const drivetrain = useDrivetrainStore()
const circumferenceMm = computed(() =>
  drivetrain.kind === 'mt'
    ? drivetrain.inversionWheelCircumferenceMm
    : drivetrain.cvt.wheelCircumferenceMm,
)
const trace = computed(() => buildGearRatioTrace(props.session, circumferenceMm.value))
const hasFiniteData = computed(() => {
  const data = trace.value.data
  if (!data) return false
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) return true
  return false
})
const fixedSeries = computed(() =>
  hasFiniteData.value && trace.value.data
    ? [{ name: t('analyzer.gear.ratioSeriesLabel') as string, data: trace.value.data }]
    : [],
)
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
    :mode="mode"
    :session="session"
    :x-values="xValues"
    :x-range="xRange"
    :external-cursor="externalCursor"
    :selected-laps="selectedLaps"
    :fixed-series="fixedSeries"
    :empty-message="emptyMessage"
    :fill-height="fillHeight"
    @cursor="emit('cursor', $event)"
    @x-zoom="emit('xZoom', $event)"
    @update-mode="emit('updateMode', $event)"
  />
</template>
