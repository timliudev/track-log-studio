<script setup lang="ts">
import ConverterNotes from './ConverterNotes.vue'
import PresetBar from './PresetBar.vue'
import SlotMappingPanel from './SlotMappingPanel.vue'
import ConvertResults from './ConvertResults.vue'
</script>

<template>
  <div class="converter">
    <ConverterNotes />
    <div class="grid">
      <div class="col">
        <ConvertResults />
      </div>
      <div class="col">
        <PresetBar />
        <SlotMappingPanel />
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
}
.col {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 2);
}
@media (max-width: 880px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
