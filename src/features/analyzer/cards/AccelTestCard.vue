<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import AccelTestPanel from '../AccelTestPanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { accelResults, speedAvailable, onAccelFocus, onAccelClear } = props.ctx
</script>

<template>
  <AccelTestPanel
    :results="accelResults"
    :speed-available="speedAvailable"
    @focus="onAccelFocus"
    @clear="onAccelClear"
  />
</template>
