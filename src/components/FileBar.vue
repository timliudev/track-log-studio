<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileStore } from '@/stores/fileStore'
import { useLogImport } from '@/composables/useLogImport'
import { sniff, detectImporter, allImportExtensions } from '@/domain/import/registry'
import { extractLogFiles } from '@/domain/import/zip'
import { listRcnxSessions, type RcnxSessionInfo } from '@/domain/import/rcnx/parseRcnx'

const { t, tm, rt } = useI18n()
const fileStore = useFileStore()
const { parseFile } = useLogImport()

/** File input accept list, derived from the importer registry plus .zip. */
const acceptExtensions = computed(() =>
  [...allImportExtensions().map((e) => `.${e}`), '.zip'].join(','),
)

/** Pending .rcnx multi-session choice, shown as a small inline picker. */
const pendingRcnx = ref<{ id: number; file: File; sessions: RcnxSessionInfo[] } | null>(null)

/** The session with the most WayPoints — same default as parseRcnx itself. */
function largestSession(sessions: RcnxSessionInfo[]): RcnxSessionInfo {
  return sessions.reduce((best, s) => (s.waypointCount > best.waypointCount ? s : best))
}

async function finishRcnxImport(id: number, file: File, sessionIndex: number): Promise<void> {
  try {
    const imp = detectImporter(await sniff(file))
    const importerId = imp?.id ?? 'rcnx'
    const session = await parseFile(
      file,
      importerId,
      (f) => fileStore.setProgress(id, f),
      sessionIndex,
    )
    fileStore.completeImport(id, session)
  } catch (e) {
    fileStore.failImport(id, e instanceof Error ? e.message : String(e))
  }
}

/**
 * Import one log file. The importer is chosen by the registry (extension + a
 * content sniff), then all formats parse in the shared worker, selected there
 * by the importer id. `.rcnx` files with more than one session pause here and
 * show a picker instead of parsing immediately.
 */
async function importOne(file: File): Promise<void> {
  const id = fileStore.beginImport(file)
  try {
    const imp = detectImporter(await sniff(file))
    if (!imp) {
      fileStore.failImport(id, t('fileBar.unsupported', { name: file.name }))
      return
    }
    if (imp.id === 'rcnx') {
      const sessions = await listRcnxSessions(new Uint8Array(await file.arrayBuffer()))
      if (sessions.length > 1) {
        pendingRcnx.value = { id, file, sessions }
        return
      }
      await finishRcnxImport(id, file, sessions[0]?.n ?? 0)
      return
    }
    const session = await parseFile(file, imp.id, (f) => fileStore.setProgress(id, f))
    fileStore.completeImport(id, session)
  } catch (e) {
    fileStore.failImport(id, e instanceof Error ? e.message : String(e))
  }
}

async function choosePendingSession(n: number): Promise<void> {
  const pending = pendingRcnx.value
  if (!pending) return
  pendingRcnx.value = null
  await finishRcnxImport(pending.id, pending.file, n)
}

function cancelPendingRcnx(): void {
  const pending = pendingRcnx.value
  if (!pending) return
  pendingRcnx.value = null
  fileStore.removeFile(pending.id)
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

/** Duration in whole minutes for the picker label, or undefined if unknown. */
function durationMin(s: RcnxSessionInfo): number | undefined {
  return s.durationMs !== undefined ? Math.round(s.durationMs / 60000) : undefined
}
</script>

<template>
  <div class="filebar">
    <label class="load-btn" :title="t('fileBar.loadTitle')">
      <input
        type="file"
        name="logfile"
        multiple
        :accept="acceptExtensions"
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

    <div v-if="pendingRcnx" class="rcnx-picker-backdrop" @click.self="cancelPendingRcnx">
      <div class="rcnx-picker" role="dialog" aria-modal="true">
        <p class="rcnx-picker-title">{{ t('fileBar.rcnxPicker.title', { n: pendingRcnx.sessions.length }) }}</p>
        <p class="rcnx-picker-file">{{ t('fileBar.rcnxPicker.fileLabel') }}: {{ pendingRcnx.file.name }}</p>
        <ul class="rcnx-picker-list">
          <li v-for="s in pendingRcnx.sessions" :key="s.n">
            <button type="button" class="rcnx-session-btn" @click="choosePendingSession(s.n)">
              <span class="rcnx-session-name">
                {{ s.trackName || t('fileBar.rcnxPicker.session', { n: s.n }) }}
                <span v-if="s.n === largestSession(pendingRcnx.sessions).n" class="rcnx-recommended">
                  {{ t('fileBar.rcnxPicker.recommended') }}
                </span>
              </span>
              <span class="rcnx-session-meta">
                {{ t('fileBar.rcnxPicker.waypoints', { n: s.waypointCount }) }}
                <template v-if="durationMin(s) !== undefined">
                  · {{ t('fileBar.rcnxPicker.duration', { m: durationMin(s) }) }}
                </template>
                ·
                {{ s.hasLapData ? t('fileBar.rcnxPicker.hasLaps') : t('fileBar.rcnxPicker.noLaps') }}
              </span>
            </button>
          </li>
        </ul>
        <button type="button" class="rcnx-picker-cancel" @click="cancelPendingRcnx">
          {{ t('fileBar.rcnxPicker.cancel') }}
        </button>
      </div>
    </div>
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
.rcnx-picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
}
.rcnx-picker {
  width: min(420px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  padding: 16px 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
}
.rcnx-picker-title {
  margin: 0 0 4px;
  font-weight: 600;
}
.rcnx-picker-file {
  margin: 0 0 10px;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  word-break: break-all;
}
.rcnx-picker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rcnx-session-btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.rcnx-session-btn:hover {
  border-color: var(--color-accent);
}
.rcnx-session-name {
  font-weight: 500;
}
.rcnx-recommended {
  color: var(--color-accent);
  font-weight: 400;
  font-size: 0.8rem;
}
.rcnx-session-meta {
  color: var(--color-text-muted);
  font-size: 0.78rem;
}
.rcnx-picker-cancel {
  margin-top: 12px;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  padding: 0;
}
.rcnx-picker-cancel:hover {
  color: var(--color-text);
}
</style>
