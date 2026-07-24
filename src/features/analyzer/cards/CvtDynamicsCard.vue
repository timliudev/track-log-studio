<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import CvtDynamicsPanel from '../CvtDynamicsCard.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { session, primaryFileId, cursorIdx, xValues, xRange } = props.ctx
</script>

<template>
  <CvtDynamicsPanel
    :session="session"
    :file-id="primaryFileId"
    :cursor-idx="cursorIdx"
    :x-values="xValues"
    :x-range="xRange"
  />
</template>
