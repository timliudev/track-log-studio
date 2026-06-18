<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useFileStore } from '@/stores/fileStore'
import { useLogImport } from '@/composables/useLogImport'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'
import { extractLogFiles } from '@/domain/import/zip'

const { t, tm, rt } = useI18n()
const fileStore = useFileStore()
const { parseFile } = useLogImport()

/** Import one log file (.loga → parse worker, .nmea → NMEA reader). */
async function importOne(file: File): Promise<void> {
  const id = fileStore.beginImport(file)
  try {
    if (file.name.toLowerCase().endsWith('.nmea')) {
      const session = nmeaToSession(await file.text())
      fileStore.completeImport(id, session)
    } else {
      const session = await parseFile(file, (f) => fileStore.setProgress(id, f))
      fileStore.completeImport(id, session)
    }
  } catch (e) {
    fileStore.failImport(id, e instanceof Error ? e.message : String(e))
  }
}

/** Expand a .zip into its .loga / .nmea entries as Files ready to import. */
async function importZip(zip: File): Promise<void> {
  // Surface a bad/empty zip as a failed pill rather than a silent no-op.
  const id = fileStore.beginImport(zip)
  let inner: File[]
  try {
    const logs = extractLogFiles(new Uint8Array(await zip.arrayBuffer()))
    if (logs.length === 0) {
      throw new Error(`${zip.name}: no .loga or .nmea file inside the zip`)
    }
    // A Uint8Array is a valid BlobPart at runtime; the lib type is over-narrow.
    inner = logs.map((l) => new File([l.data as BlobPart], l.name))
  } catch (e) {
    fileStore.failImport(id, e instanceof Error ? e.message : String(e))
    return
  }
  fileStore.removeFile(id)
  for (const f of inner) await importOne(f)
}

async function onFiles(list: FileList | null): Promise<void> {
  if (!list || list.length === 0) return
  for (const file of Array.from(list)) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      await importZip(file)
    } else {
      await importOne(file)
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
    <label class="load-btn" :title="t('fileBar.loadTitle')">
      <input
        type="file"
        multiple
        accept=".loga,.nmea,.zip"
        class="hidden"
        @change="onChange"
      />
      <span>＋ {{ t('fileBar.load') }}</span>
    </label>

    <details class="sources">
      <summary class="info-btn" :title="t('fileBar.sources.title')" :aria-label="t('fileBar.sources.title')">ⓘ</summary>
      <div class="sources-panel">
        <p class="src-title">{{ t('fileBar.sources.title') }}</p>
        <p class="src-label">{{ t('fileBar.sources.tested') }}</p>
        <ol class="src-list">
          <li v-for="(item, i) in tm('fileBar.sources.testedItems')" :key="`t${i}`">{{ rt(item) }}</li>
        </ol>
        <p class="src-label muted">{{ t('fileBar.sources.untested') }}</p>
        <ol class="src-list muted">
          <li v-for="(item, i) in tm('fileBar.sources.untestedItems')" :key="`u${i}`">{{ rt(item) }}</li>
        </ol>
      </div>
    </details>

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
.sources {
  position: relative;
}
.info-btn {
  cursor: pointer;
  list-style: none;
  font-size: 1rem;
  color: var(--color-text-muted);
  user-select: none;
}
.info-btn::-webkit-details-marker {
  display: none;
}
.info-btn:hover {
  color: var(--color-accent);
}
.sources[open] .info-btn {
  color: var(--color-accent);
}
.sources-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  width: min(340px, 86vw);
  padding: 10px 14px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-accent);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  font-size: 0.82rem;
}
.src-title {
  margin: 0 0 6px;
  font-weight: 600;
}
.src-label {
  margin: 8px 0 2px;
  font-weight: 500;
}
.src-label.muted {
  color: var(--color-text-muted);
  font-weight: 400;
}
.src-list {
  margin: 0;
  padding-left: 1.4em;
  line-height: 1.55;
}
.src-list.muted {
  color: var(--color-text-muted);
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
