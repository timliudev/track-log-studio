<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import MapAlignPanel from '../MapAlignPanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { selectedLaps, comparisonAlignLaps } = props.ctx
</script>

<template>
  <MapAlignPanel :selected-laps="selectedLaps" :comparison-laps="comparisonAlignLaps" />
</template>
