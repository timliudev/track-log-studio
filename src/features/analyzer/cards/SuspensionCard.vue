<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import SuspensionPanel from '../SuspensionCard.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { session } = props.ctx
</script>

<template>
  <SuspensionPanel :session="session" />
</template>
