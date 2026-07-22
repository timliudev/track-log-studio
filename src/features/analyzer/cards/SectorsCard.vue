<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import SectorPanel from '../SectorPanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { laps, sectorFailureCount, sectorAllFailed, track, timeMs, cursorIdx } = props.ctx
</script>

<template>
  <SectorPanel
    :laps="laps"
    :failed-count="sectorFailureCount"
    :all-failed="sectorAllFailed"
    :track="track"
    :time-ms="timeMs"
    :cursor-idx="cursorIdx"
  />
</template>
