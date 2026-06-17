<script setup lang="ts">
import { useConverterStore } from '@/stores/converterStore'
import { useLogImport } from '@/composables/useLogImport'
import ConverterNotes from './ConverterNotes.vue'
import FileDropZone from './FileDropZone.vue'
import FileList from './FileList.vue'
import PresetBar from './PresetBar.vue'
import SlotMappingPanel from './SlotMappingPanel.vue'
import ConvertResults from './ConvertResults.vue'

const store = useConverterStore()
const { parseFile } = useLogImport()

async function onFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const id = store.beginImport(file)
    try {
      const session = await parseFile(file, (f) => store.setProgress(id, f))
      store.completeImport(id, session)
    } catch (e) {
      store.failImport(id, e instanceof Error ? e.message : String(e))
    }
  }
}
</script>

<template>
  <div class="converter">
    <ConverterNotes />
    <FileDropZone @files="onFiles" />
    <div class="grid">
      <div class="col">
        <FileList />
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
