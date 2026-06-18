<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useFileStore } from '@/stores/fileStore'
import { useLogImport } from '@/composables/useLogImport'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'

const { t } = useI18n()
const fileStore = useFileStore()
const { parseFile } = useLogImport()

async function onFiles(list: FileList | null): Promise<void> {
  if (!list || list.length === 0) return
  for (const file of Array.from(list)) {
    const id = fileStore.beginImport(file)
    try {
      if (file.name.toLowerCase().endsWith('.nmea')) {
        const text = await file.text()
        const session = nmeaToSession(text)
        fileStore.completeImport(id, session)
      } else {
        const session = await parseFile(file, (f) => fileStore.setProgress(id, f))
        fileStore.completeImport(id, session)
      }
    } catch (e) {
      fileStore.failImport(id, e instanceof Error ? e.message : String(e))
    }
  }
}

function onChange(e: Event): void {
  const input = e.target as HTMLInputElement
  onFiles(input.files)
  input.value = ''
}
</script>

<template>
  <div class="filebar">
    <label class="load-btn">
      <input
        type="file"
        multiple
        accept=".loga,.nmea"
        class="hidden"
        @change="onChange"
      />
      <span>＋ {{ t('fileBar.load') }}</span>
    </label>

    <div v-if="fileStore.files.length" class="pills">
      <span
        v-for="f in fileStore.files"
        :key="f.id"
        class="pill"
        :class="{ ready: f.status === 'ready', error: f.status === 'error' }"
      >
        <span class="pill-name">{{ f.name }}</span>
        <span v-if="f.status === 'parsing'" class="pill-meta">{{ Math.round(f.progress * 100) }}%</span>
        <span v-else-if="f.status === 'ready'" class="pill-meta">
          {{ f.formatId }} · {{ t('fileBar.rows', { n: f.rowCount }) }}
        </span>
        <span v-else class="pill-meta err">{{ t('fileBar.error') }}</span>
        <button type="button" class="pill-x" :title="t('fileBar.remove')" @click="fileStore.removeFile(f.id)">×</button>
      </span>
    </div>

    <button
      v-if="fileStore.files.length"
      type="button"
      class="clear-btn"
      @click="fileStore.clearFiles()"
    >
      {{ t('fileBar.clearAll') }}
    </button>
  </div>
</template>

<style scoped>
.filebar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px calc(var(--space) * 2);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.load-btn {
  cursor: pointer;
}
.load-btn span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border-radius: var(--radius);
  font-size: 0.85rem;
  white-space: nowrap;
}
.hidden {
  display: none;
}
.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 0.8rem;
  background: var(--color-bg);
}
.pill.ready {
  border-color: var(--color-accent);
}
.pill.error {
  border-color: var(--color-text-muted);
}
.pill-name {
  font-weight: 500;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill-meta {
  color: var(--color-text-muted);
  font-size: 0.75rem;
}
.pill-meta.err {
  color: var(--color-accent);
}
.pill-x {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 0 2px;
}
.pill-x:hover {
  color: var(--color-text);
}
.clear-btn {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  padding: 0;
}
.clear-btn:hover {
  color: var(--color-text);
}
</style>
