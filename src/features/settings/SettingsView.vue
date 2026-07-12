<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'
import type { TzOverride } from '@/stores/settingsStore'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { thirdPartyLicenses } from '@/data/licenses'
import { loadLayout, saveLayout } from '@/domain/layout/dashboardLayout'
import { loadPanelState, savePanelState } from '@/domain/layout/panelState'
import { loadLayoutLocked, saveLayoutLocked } from '@/domain/layout/layoutLock'
import {
  buildExportBundle,
  serializeExportBundle,
  parseImportBundle,
  type ImportError,
} from '@/domain/settings/settingsTransfer'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const { tzOverride, themePref, localePref } = storeToRefs(settingsStore)
const drivetrainStore = useDrivetrainStore()

// Whole-hour offsets UTC-12 .. UTC+14; value is offset minutes east of UTC.
const tzHours = Array.from({ length: 27 }, (_, i) => i - 12)
function tzLabel(hours: number): string {
  if (hours === 0) return 'UTC'
  return `UTC${hours > 0 ? '+' : '-'}${Math.abs(hours)}`
}

// <select> values are strings; bridge to the 'auto' | number preference.
const tzModel = computed<string>({
  get: () => (tzOverride.value === 'auto' ? 'auto' : String(tzOverride.value)),
  set: (v: string) => {
    const next: TzOverride = v === 'auto' ? 'auto' : Number(v)
    tzOverride.value = next
  },
})

// --- B19: settings export / import ---

const includeLayout = ref(true)
const importFileInput = ref<HTMLInputElement | null>(null)
const importMessage = ref<{ kind: 'success' | 'error'; text: string } | null>(null)

function downloadJsonFile(name: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function exportSettings(): void {
  const bundle = buildExportBundle({
    appearance: {
      themePref: themePref.value,
      localePref: localePref.value,
      tzOverride: tzOverride.value,
    },
    drivetrain: {
      kind: drivetrainStore.kind,
      mt: drivetrainStore.mt,
      cvt: drivetrainStore.cvt,
      inversionWheelCircumferenceMm: drivetrainStore.inversionWheelCircumferenceMm,
    },
    layout: includeLayout.value
      ? {
          dashboardLayout: loadLayout(),
          panelState: loadPanelState(),
          layoutLocked: loadLayoutLocked(),
        }
      : undefined,
  })
  const json = serializeExportBundle(bundle)
  const stamp = new Date().toISOString().slice(0, 10)
  downloadJsonFile(`track-log-studio-settings-${stamp}.json`, json)
}

function triggerImportPicker(): void {
  importFileInput.value?.click()
}

const IMPORT_ERROR_KEYS: Record<ImportError, string> = {
  invalidJson: 'settings.transfer.importErrorInvalidJson',
  invalidShape: 'settings.transfer.importErrorInvalidShape',
}

async function onImportFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // allow re-selecting the same file later
  if (!file) return

  let text: string
  try {
    text = await file.text()
  } catch {
    importMessage.value = { kind: 'error', text: t('settings.transfer.importErrorRead') }
    return
  }

  const result = parseImportBundle(text)
  if (!result.ok) {
    importMessage.value = { kind: 'error', text: t(IMPORT_ERROR_KEYS[result.error]) }
    return
  }

  // Import is an overwrite — confirm before applying (B19 requirement).
  if (!window.confirm(t('settings.transfer.importConfirm'))) return

  const { bundle } = result
  settingsStore.applyAppearance(bundle.appearance)
  drivetrainStore.applyImported(bundle.drivetrain)

  if (bundle.layout) {
    saveLayout(bundle.layout.dashboardLayout)
    savePanelState(bundle.layout.panelState)
    saveLayoutLocked(bundle.layout.layoutLocked)
    // The dashboard grid (AnalyzerView) only reads its layout/panel state
    // once at mount, so a reload is needed for an imported layout to take
    // effect immediately — appearance/drivetrain above already applied live
    // via reactive store refs, no reload needed for those alone.
    importMessage.value = { kind: 'success', text: t('settings.transfer.importSuccessReload') }
    setTimeout(() => window.location.reload(), 800)
  } else {
    importMessage.value = { kind: 'success', text: t('settings.transfer.importSuccess') }
  }
}

// "About" content, merged into the bottom of the Settings tab (previously a
// standalone tab — see BottomNav.vue / App.vue history). Build identity
// injected at compile time (see vite.config.ts `define`), same mechanism as
// the footer build stamp in App.vue.
const buildSha = __BUILD_SHA__
const buildDate = __BUILD_DATE__

const siteUrl = 'https://tracklogstudio.timliudev.com/'
const repoUrl = 'https://github.com/timliudev/track-log-studio'
const authorUrl = 'https://github.com/timliudev'
const licenseUrl = `${repoUrl}/blob/main/LICENSE`
</script>

<template>
  <div class="settings">
    <div class="card">
      <label class="control">
        <span>{{ t('theme.label') }}</span>
        <select v-model="themePref" name="theme">
          <option value="auto">{{ t('theme.auto') }}</option>
          <option value="light">{{ t('theme.light') }}</option>
          <option value="dark">{{ t('theme.dark') }}</option>
        </select>
      </label>
      <label class="control">
        <span>{{ t('language.label') }}</span>
        <select v-model="localePref" name="locale">
          <option value="auto">{{ t('language.auto') }}</option>
          <option value="zh-Hant">繁體中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <label class="control">
        <span>{{ t('settings.timezone') }}</span>
        <select v-model="tzModel" name="timezone">
          <option value="auto">{{ t('settings.timezoneAuto') }}</option>
          <option v-for="h in tzHours" :key="h" :value="String(h * 60)">{{ tzLabel(h) }}</option>
        </select>
      </label>
    </div>

    <div class="card">
      <h2 class="card-heading">{{ t('settings.transfer.heading') }}</h2>
      <p class="transfer-description">{{ t('settings.transfer.description') }}</p>
      <label class="control checkbox-control">
        <input v-model="includeLayout" type="checkbox" name="includeLayout" />
        <span>{{ t('settings.transfer.includeLayout') }}</span>
      </label>
      <div class="transfer-actions">
        <button type="button" class="btn-primary" @click="exportSettings">
          {{ t('settings.transfer.exportButton') }}
        </button>
        <button type="button" class="btn-secondary" @click="triggerImportPicker">
          {{ t('settings.transfer.importButton') }}
        </button>
        <input
          ref="importFileInput"
          type="file"
          accept="application/json,.json"
          class="visually-hidden"
          @change="onImportFileChange"
        />
      </div>
      <p
        v-if="importMessage"
        class="transfer-message"
        :class="importMessage.kind"
        role="status"
      >
        {{ importMessage.text }}
      </p>
    </div>

    <div class="card">
      <h2 class="card-heading">{{ t('about.project.heading') }}</h2>
      <p class="app-name">{{ t('app.title') }}</p>
      <p class="app-subtitle">{{ t('app.subtitle') }}</p>
      <p class="app-description">{{ t('about.project.description') }}</p>
      <dl class="info-list">
        <div class="info-row">
          <dt>{{ t('about.project.author') }}</dt>
          <dd>
            <a :href="authorUrl" target="_blank" rel="noopener noreferrer">timliudev</a>
          </dd>
        </div>
        <div class="info-row">
          <dt>{{ t('about.project.website') }}</dt>
          <dd>
            <a :href="siteUrl" target="_blank" rel="noopener noreferrer">{{ siteUrl }}</a>
          </dd>
        </div>
        <div class="info-row">
          <dt>{{ t('about.project.repo') }}</dt>
          <dd>
            <a :href="repoUrl" target="_blank" rel="noopener noreferrer">{{ repoUrl }}</a>
          </dd>
        </div>
        <div class="info-row">
          <dt>{{ t('about.project.version') }}</dt>
          <dd>{{ t('about.project.versionValue', { sha: buildSha, date: buildDate }) }}</dd>
        </div>
        <div class="info-row">
          <dt>{{ t('about.project.license') }}</dt>
          <dd>
            <a :href="licenseUrl" target="_blank" rel="noopener noreferrer">{{
              t('about.project.licenseValue')
            }}</a>
          </dd>
        </div>
      </dl>
    </div>

    <div class="card">
      <h2 class="card-heading">{{ t('about.licenses.heading') }}</h2>
      <p class="licenses-intro">{{ t('about.licenses.intro') }}</p>
      <div class="licenses-table-wrap">
        <table class="licenses-table">
          <thead>
            <tr>
              <th>{{ t('about.licenses.colName') }}</th>
              <th>{{ t('about.licenses.colVersion') }}</th>
              <th>{{ t('about.licenses.colLicense') }}</th>
              <th>{{ t('about.licenses.colLink') }}</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="pkg in thirdPartyLicenses" :key="pkg.name">
              <tr>
                <td class="pkg-name">{{ pkg.name }}</td>
                <td>{{ pkg.version }}</td>
                <td>
                  <span class="license-badge">{{ pkg.license }}</span>
                </td>
                <td>
                  <a :href="pkg.url" target="_blank" rel="noopener noreferrer">{{
                    t('about.licenses.viewLink')
                  }}</a>
                </td>
              </tr>
              <tr v-if="pkg.noteKey" class="note-row">
                <td colspan="4">{{ t(`about.licenses.notes.${pkg.noteKey}`) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 2);
  max-width: 820px;
}
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: calc(var(--radius) * 1.5);
  padding: calc(var(--space) * 2);
  display: flex;
  flex-direction: column;
  gap: calc(var(--space) * 1.5);
}
.control {
  display: flex;
  align-items: center;
  gap: var(--space);
}
.control span {
  color: var(--color-text-muted);
  font-size: 0.9rem;
}
.control select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 5px 8px;
  font: inherit;
}
.transfer-description {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}
.checkbox-control {
  gap: 8px;
}
.checkbox-control input {
  width: 16px;
  height: 16px;
}
.transfer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.transfer-message {
  margin: 0;
  font-size: 0.85rem;
}
.transfer-message.success {
  color: var(--color-accent);
}
.transfer-message.error {
  color: var(--color-danger, #e5484d);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.btn-primary {
  align-self: flex-start;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border: none;
  border-radius: var(--radius);
  padding: 8px 18px;
  font: inherit;
  cursor: pointer;
}
.btn-secondary {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: 8px 16px;
  font: inherit;
  cursor: pointer;
}
.card-heading {
  margin: 0;
  font-size: 1rem;
  color: var(--color-text);
}
.app-name {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--color-accent);
}
.app-subtitle {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.app-description {
  margin: 4px 0 0;
  font-size: 0.9rem;
  line-height: 1.6;
  color: var(--color-text);
}
.info-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.info-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-size: 0.9rem;
}
.info-row dt {
  min-width: 6em;
  color: var(--color-text-muted);
}
.info-row dd {
  margin: 0;
  word-break: break-all;
}
.info-row a {
  color: var(--color-accent);
}
.licenses-intro {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.licenses-table-wrap {
  overflow-x: auto;
}
.licenses-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.licenses-table th,
.licenses-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}
.licenses-table th {
  color: var(--color-text-muted);
  font-weight: 500;
}
.pkg-name {
  font-weight: 600;
}
.license-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--radius);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 0.78rem;
}
.licenses-table a {
  color: var(--color-accent);
}
.note-row td {
  white-space: normal;
  color: var(--color-text-muted);
  font-size: 0.78rem;
  padding-top: 0;
  padding-bottom: 10px;
}
</style>
