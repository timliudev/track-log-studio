<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import TrackChannelPanel from '../TrackChannelPanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { channelOptions, trackExtrema, trackChannelChosen } = props.ctx
</script>

<template>
  <TrackChannelPanel :options="channelOptions" :extrema="trackExtrema" :channel-chosen="trackChannelChosen" />
</template>
