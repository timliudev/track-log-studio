<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useConverterStore } from '@/stores/converterStore'
import ConverterNotes from './ConverterNotes.vue'
import PresetBar from './PresetBar.vue'
import SlotMappingPanel from './SlotMappingPanel.vue'
import VboChannelMap from './VboChannelMap.vue'
import ConvertResults from './ConvertResults.vue'

const { outputFormat } = storeToRefs(useConverterStore())
</script>

<template>
  <div class="converter">
    <ConverterNotes />
    <div class="grid">
      <div class="col">
        <ConvertResults />
      </div>
      <div class="col">
        <!-- RC3 slot mapping only applies to .nmea; .vbo exports every channel
             automatically, so show the channel cross-reference instead. .csv
             also exports every channel automatically but under its own plain
             names (no RaceChrono rc_ identifiers), so the VBO-specific map
             doesn't apply there — the format hint below covers it instead. -->
        <template v-if="outputFormat === 'nmea'">
          <PresetBar />
          <SlotMappingPanel />
        </template>
        <VboChannelMap v-else-if="outputFormat === 'vbo'" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.converter {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: calc(var(--space) * 2);
  align-items: start;
  /* Grid tracks default to min-width:auto (sized to content's min-content),
     so a wide child (e.g. VboChannelMap's table) would stretch the whole
     grid past the viewport instead of letting its own overflow-x:auto
     container do the scrolling. min-width:0 lets tracks shrink to the
     available width, same fix as .content in App.vue. */
  min-width: 0;
}
.col {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 2);
  min-width: 0;
}
@media (max-width: 880px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
