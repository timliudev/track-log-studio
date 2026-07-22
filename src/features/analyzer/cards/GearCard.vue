<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import GearPanel from '../GearPanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
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
  <GearPanel
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
</template>
