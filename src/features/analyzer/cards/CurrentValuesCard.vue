<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import CurrentValuesPanel from '../CurrentValuesPanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { session, cursorIdx } = props.ctx
</script>

<template>
  <CurrentValuesPanel :session="session" :cursor-idx="cursorIdx" />
</template>
