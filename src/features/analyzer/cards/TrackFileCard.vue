<script setup lang="ts">
import type { AnalyzerCardContext } from '../analyzerCardContext'
import TrackFilePanel from '../TrackFilePanel.vue'

const props = defineProps<{ ctx: AnalyzerCardContext }>()
const { track, ambiguousMatches, appliedSharedTrack, chooseTrack, dismissAmbiguous, detachFromSharedTrack } =
  props.ctx
</script>

<template>
  <TrackFilePanel
    :track="track"
    :ambiguous-matches="ambiguousMatches"
    :applied-shared-track="appliedSharedTrack"
    @choose-track="chooseTrack"
    @dismiss-ambiguous="dismissAmbiguous"
    @detach="detachFromSharedTrack"
  />
</template>
