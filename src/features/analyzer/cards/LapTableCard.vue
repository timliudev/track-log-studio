<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import LapTable from '../LapTable.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const {
  laps,
  track,
  timeMs,
  session,
  hasEcuLaps,
  comparisonSessions,
  primaryFileId,
  primaryFileName,
  onLapSelect,
} = props.ctx
</script>

<template>
  <LapTable
    :laps="laps"
    :track="track"
    :time-ms="timeMs"
    :session="session"
    :has-ecu-laps="hasEcuLaps"
    :comparison-sessions="comparisonSessions"
    :primary-file-id="primaryFileId"
    :primary-file-name="primaryFileName"
    @select="onLapSelect"
  />
</template>
