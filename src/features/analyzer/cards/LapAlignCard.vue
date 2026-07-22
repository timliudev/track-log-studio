<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import LapAlignPanel from '../LapAlignPanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { selectedLaps } = props.ctx
</script>

<template>
  <LapAlignPanel :selected-laps="selectedLaps" />
</template>
