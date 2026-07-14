<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useConverterStore } from '@/stores/converterStore'
import ConverterNotes from './ConverterNotes.vue'
import PresetBar from './PresetBar.vue'
import SlotMappingPanel from './SlotMappingPanel.vue'
import VboChannelMap from './VboChannelMap.vue'
import ConvertResults from './ConvertResults.vue'
import SuspensionPanel from './SuspensionPanel.vue'

const { t } = useI18n()
const { outputFormat } = storeToRefs(useConverterStore())

// Collapsed by default — suspension calibration is a secondary, occasional
// setup step, not part of the main convert flow most users touch every time.
const suspensionOpen = ref(false)
</script>

<template>
  <div class="converter">
    <ConverterNotes />
    <div class="grid">
      <div class="col">
        <ConvertResults />
        <!-- B21 — the suspension-calibration menu used to sit full-width
             below the two-column grid, which wasted horizontal space on wide
             (PC) layouts. It's a secondary/occasional setup step for the
             output/conversion side (its calibrated channels only affect the
             .loga save-modified output and the CSV/VBO/NMEA exports' derived
             suspension columns), so it belongs in THIS column rather than the
             input-mapping column on the right. On narrow/mobile widths the
             grid already collapses to a single column (see the media query
             below), so this still ends up stacked under ConvertResults same
             as before — only the wide-layout position changed. -->
        <details
          class="suspension-section"
          :open="suspensionOpen"
          @toggle="suspensionOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary>{{ t('converter.suspensionToggle') }}</summary>
          <SuspensionPanel />
        </details>
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
/* B36 — App.vue's `.content` zeroes its own left/right padding below the
   mobile breakpoint so the ANALYZER tab's dashboard cards can go edge-to-
   edge (see that file's own B36 comment). Converter isn't part of that
   full-bleed ask — it's a form/table layout, not chart/map real estate — so
   it restores the same horizontal gutter here instead, keeping its own
   look unchanged at every width. */
@media (max-width: 768px) {
  .converter {
    padding-left: calc(var(--space) * 2);
    padding-right: calc(var(--space) * 2);
  }
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
.suspension-section {
  /* B21 — now nested inside `.col` (which already supplies the surrounding
     card background/border), so this no longer needs its OWN full bordered
     card — that read as a card-inside-a-card. A top divider + no fill keeps
     it visually part of the same column while still standing apart from
     ConvertResults above it. */
  border-top: 1px solid var(--color-border);
  padding: calc(var(--space) * 1.5) 0 0;
}
.suspension-section summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.95rem;
}
.suspension-section summary::-webkit-details-marker {
  color: var(--color-text-muted);
}
.suspension-section[open] summary {
  margin-bottom: calc(var(--space) * 1.5);
}
</style>
