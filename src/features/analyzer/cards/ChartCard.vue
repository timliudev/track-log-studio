<script setup lang="ts">
import type { ChartConfig } from '@/stores/analyzerStore'
import type { AnalyzerCardContext } from '../analyzerCardContext'
import TimeSeriesChart from '../TimeSeriesChart.vue'
import ScatterChart from '../ScatterChart.vue'

// The dispatcher (AnalyzerCardBody) resolves the `chart-<id>` item id to the
// concrete ChartConfig and hands it in — this card just renders the right
// chart kind, byte-for-byte the same bindings the inline chart branch used.
const props = defineProps<{ ctx: AnalyzerCardContext; chart: ChartConfig }>()
const {
  session,
  xValues,
  xRange,
  cursorIdx,
  selectedLaps,
  comparisonSessions,
  primaryFileId,
  primaryFileName,
  setCursor,
  onXZoom,
} = props.ctx
</script>

<template>
  <TimeSeriesChart
    v-if="chart.kind === 'timeseries' && session && xValues"
    fill-height
    :chart="chart"
    :session="session"
    :x-values="xValues"
    :x-range="xRange"
    :external-cursor="cursorIdx"
    :selected-laps="selectedLaps"
    :comparison-sessions="comparisonSessions"
    :primary-file-id="primaryFileId"
    :primary-file-name="primaryFileName"
    @cursor="setCursor"
    @x-zoom="onXZoom"
  />
  <ScatterChart
    v-else-if="chart.kind === 'scatter'"
    fill-height
    :chart="chart"
    :session="session"
    :selected-laps="selectedLaps"
    :comparison-sessions="comparisonSessions"
    :primary-file-id="primaryFileId"
    :primary-file-name="primaryFileName"
  />
</template>
