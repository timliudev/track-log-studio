<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GpsTrack } from '@/domain/analysis/gpsTrack'
import { circuitKey } from '@/domain/persist/circuitKey'
import {
  deleteCircuitSetup,
  exportCircuitSetupJson,
  importCircuitSetupJson,
  listCircuitSetups,
  putCircuitSetup,
  CircuitSetupImportError,
  type CircuitSetup,
} from '@/domain/persist/circuitStore'
import { useLapStore } from '@/stores/lapStore'
import { useSectorStore } from '@/stores/sectorStore'
import { downloadText } from '@/features/converter/download'
import type { TrackDefinitionV1 } from '@/domain/tracks/schema'

const props = defineProps<{
  track: GpsTrack | null
  /** §4.3: non-null while the current circuit matches 2+ SHARED library
   *  entries — render a picker instead of silently applying nothing. */
  ambiguousMatches?: TrackDefinitionV1[] | null
  /** §4.4: the SHARED track currently in effect (no local override yet), if
   *  any — shown as an informational banner with a detach affordance. */
  appliedSharedTrack?: TrackDefinitionV1 | null
}>()

const emit = defineEmits<{
  chooseTrack: [track: TrackDefinitionV1]
  dismissAmbiguous: []
  detach: []
}>()

const { t, locale } = useI18n()
const lapStore = useLapStore()
const sectorStore = useSectorStore()

const activeKey = computed(() => (props.track ? circuitKey(props.track) : null))

/** Best-effort display name for a SHARED track: current locale, then any
 *  locale present, then the bare id — a track library entry only promises
 *  "at least one locale" (§1.2), not that it covers this user's locale. The
 *  app's internal locale codes (`zh-Hant`/`en`, see i18n/index.ts) don't
 *  exactly match the design doc's example locale tags (`zh-TW`/`en`) — try
 *  both the app code and its common track-data alias before falling back. */
function trackDisplayName(track: TrackDefinitionV1): string {
  const aliases: Record<string, string[]> = { 'zh-Hant': ['zh-Hant', 'zh-TW'], en: ['en'] }
  for (const key of aliases[locale.value] ?? [locale.value]) {
    if (track.name[key]) return track.name[key]
  }
  return Object.values(track.name)[0] ?? track.id
}

const status = ref<string | null>(null)
const statusIsError = ref(false)

function setStatus(msg: string, isError: boolean): void {
  status.value = msg
  statusIsError.value = isError
}

function exportCurrent(): void {
  const key = activeKey.value
  if (!key) return
  // Phase 1 (docs/CLOUD-TRACK-DESIGN.md §7 第一階段): no SHARED library yet,
  // so the exported file is always a "local override" overlay — trackId null,
  // geometry in localOverride. See schema.ts / useCircuitPersistence.ts.
  const setup: CircuitSetup = {
    schemaVersion: 1,
    key,
    trackId: null,
    localOverride: { line: lapStore.line, gates: sectorStore.gates },
    columns: lapStore.columns,
    updatedAt: Date.now(),
  }
  downloadText(`track-setup-${key}.json`, exportCircuitSetupJson(setup))
}

async function importFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    // Tolerant import: accepts both the current versioned shape and a file
    // exported before this upgrade (no schemaVersion) — see
    // parsePersonalTrackOverlay's migration path in domain/tracks/schema.ts.
    const setup = importCircuitSetupJson(text)
    await putCircuitSetup(setup)
    // If the imported file is for the circuit currently active, apply it
    // immediately via the store actions (same restore path as auto-restore).
    if (activeKey.value && setup.key === activeKey.value) {
      const override = setup.localOverride
      if (override?.line) lapStore.setLine(override.line)
      // Importing a track file is not a manual edit — use `loadDetected` (not
      // `addGate` per gate) so `sectorStore.edited` stays false, same
      // reasoning as the auto-restore path in useCircuitPersistence.ts.
      if (override) sectorStore.loadDetected(override.gates)
      for (const col of [...lapStore.columns]) lapStore.removeColumn(col.id)
      for (const col of setup.columns) lapStore.addColumn(col.metric)
    }
    setStatus(t('analyzer.trackFile.importOk', { key: setup.key }), false)
    await refreshSaved()
  } catch (err) {
    const reason = err instanceof CircuitSetupImportError ? err.message : String(err)
    setStatus(t('analyzer.trackFile.importFailed', { reason }), true)
  }
}

const saved = ref<CircuitSetup[]>([])

async function refreshSaved(): Promise<void> {
  saved.value = await listCircuitSetups()
}

async function removeSaved(key: string): Promise<void> {
  await deleteCircuitSetup(key)
  await refreshSaved()
}

watch(() => props.track, refreshSaved, { immediate: true })
</script>

<template>
  <div class="track-file-panel">
    <div v-if="ambiguousMatches && ambiguousMatches.length > 0" class="ambiguous">
      <p class="ambiguous-title">{{ t('analyzer.trackFile.ambiguousTitle') }}</p>
      <p class="hint">{{ t('analyzer.trackFile.ambiguousHint') }}</p>
      <ul class="ambiguous-list">
        <li v-for="candidate in ambiguousMatches" :key="candidate.id">
          <span class="ambiguous-name">{{ trackDisplayName(candidate) }}</span>
          <button type="button" class="choose" @click="emit('chooseTrack', candidate)">
            {{ t('analyzer.trackFile.ambiguousChoose') }}
          </button>
        </li>
      </ul>
      <button type="button" class="dismiss" @click="emit('dismissAmbiguous')">
        {{ t('analyzer.trackFile.ambiguousDismiss') }}
      </button>
    </div>

    <div v-else-if="appliedSharedTrack" class="shared-banner">
      <span>{{ t('analyzer.trackFile.sharedAppliedBanner', { name: trackDisplayName(appliedSharedTrack) }) }}</span>
      <button type="button" class="detach" @click="emit('detach')">
        {{ t('analyzer.trackFile.detach') }}
      </button>
    </div>

    <div class="row">
      <button type="button" class="export" :disabled="!activeKey" @click="exportCurrent">
        {{ t('analyzer.trackFile.export') }}
      </button>
      <label class="import-btn">
        <input type="file" accept=".json,application/json" class="hidden" @change="importFile" />
        <span>{{ t('analyzer.trackFile.import') }}</span>
      </label>
      <span v-if="!activeKey" class="hint">{{ t('analyzer.trackFile.noGps') }}</span>
    </div>
    <p v-if="status" class="status" :class="{ error: statusIsError }">{{ status }}</p>

    <details v-if="saved.length > 0" class="saved">
      <summary>{{ t('analyzer.trackFile.savedCount', { n: saved.length }) }}</summary>
      <ul class="saved-list">
        <li v-for="s in saved" :key="s.key">
          <span class="saved-name">{{ s.name || s.key }}</span>
          <span class="saved-date">{{ new Date(s.updatedAt).toLocaleString() }}</span>
          <button type="button" class="remove" @click="removeSaved(s.key)">
            {{ t('analyzer.trackFile.delete') }}
          </button>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.track-file-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: var(--space);
  padding-top: var(--space);
  border-top: 1px solid var(--color-border);
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.export,
.import-btn span {
  display: inline-flex;
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 6px 12px;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}
.export:hover,
.import-btn:hover span {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.export:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.import-btn {
  cursor: pointer;
}
.hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.hint,
.status {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}
.status.error {
  color: #ff6b6b;
}
.shared-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius);
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
  font-size: 0.8rem;
}
.shared-banner span {
  flex: 1;
  min-width: 200px;
}
.detach,
.dismiss,
.choose {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  color: var(--color-text);
  font: inherit;
  font-size: 0.78rem;
  padding: 4px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.detach:hover,
.dismiss:hover,
.choose:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.ambiguous {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius);
  background: var(--color-bg);
  border: 1px solid var(--color-accent);
}
.ambiguous-title {
  font-weight: 600;
  font-size: 0.85rem;
}
.ambiguous-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ambiguous-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.82rem;
}
.ambiguous .dismiss {
  align-self: flex-start;
}
.saved summary {
  font-size: 0.85rem;
  color: var(--color-text-muted);
  cursor: pointer;
}
.saved-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.saved-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
  border-radius: var(--radius);
  background: var(--color-bg);
  font-size: 0.8rem;
}
.saved-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.saved-date {
  color: var(--color-text-muted);
}
.remove {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: 0.8rem;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}
</style>
