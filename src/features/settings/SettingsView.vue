<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'
import type { TzOverride } from '@/stores/settingsStore'
import { useDrivetrainStore } from '@/stores/drivetrainStore'
import { useInputCapabilities } from '@/composables/useInputCapabilities'
import { detectLocale, type LocaleCode } from '@/i18n'
import { thirdPartyLicenses } from '@/data/licenses'
import { loadLayout, saveLayout } from '@/domain/layout/dashboardLayout'
import { loadPanelState, savePanelState } from '@/domain/layout/panelState'
import { loadLayoutLocked, saveLayoutLocked } from '@/domain/layout/layoutLock'
import {
  loadCurrentValuesFieldPrefs,
  saveCurrentValuesFieldPrefs,
} from '@/domain/analysis/currentValuesFieldPrefs'
import {
  buildExportBundle,
  serializeExportBundle,
  parseImportBundle,
  type ImportError,
} from '@/domain/settings/settingsTransfer'
import {
  REVEAL_TAP_COUNT,
  REVEAL_HINT_THRESHOLD,
  loadDevOptionsRevealed,
  saveDevOptionsRevealed,
} from '@/domain/settings/devOptionsReveal'
import {
  FEATURE_FLAGS,
  useFeatureFlags,
  getLocalFlagOverride,
  setLocalFlagOverride,
  type FeatureFlagName,
} from '@/config/featureFlags'

const { t, locale } = useI18n()
const settingsStore = useSettingsStore()
const { tzOverride, themePref, localePref, inputModePref, centreCursorMode } = storeToRefs(settingsStore)
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

// --- B20: show the CURRENTLY-APPLIED value next to each 'auto'-capable
// control — the <select> itself already reflects an explicit choice, but
// 'auto' alone doesn't tell the user what it currently resolves to. ---

// Effective theme: mirrors useTheme.ts's resolution formula, but kept as its
// OWN small matchMedia listener (rather than calling useTheme() again here)
// so mounting/unmounting the Settings tab doesn't accumulate duplicate
// 'change' listeners on top of the one App.vue's root-level useTheme() call
// already owns for the entire app lifetime — this is display-only and never
// touches <html data-theme> itself.
const systemPrefersDark = ref(false)
let darkMediaQuery: MediaQueryList | undefined
function onSystemThemeChange(e: MediaQueryListEvent): void {
  systemPrefersDark.value = e.matches
}
onMounted(() => {
  darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemPrefersDark.value = darkMediaQuery.matches
  darkMediaQuery.addEventListener('change', onSystemThemeChange)
})
onBeforeUnmount(() => {
  darkMediaQuery?.removeEventListener('change', onSystemThemeChange)
})
const effectiveTheme = computed<'light' | 'dark'>(() =>
  themePref.value === 'auto' ? (systemPrefersDark.value ? 'dark' : 'light') : themePref.value,
)

// Effective language: the app-wide locale useLocale() (mounted once in
// App.vue) keeps `locale` (vue-i18n's global-scope ref, since useI18n() here
// has no local `messages` option) in sync with localePref/detectLocale — so
// this just reads that same reactive value rather than recomputing it.
const localeLabels: Record<LocaleCode, string> = { 'zh-Hant': '繁體中文', en: 'English' }
const effectiveLocaleLabel = computed(() => localeLabels[(locale.value as LocaleCode) ?? detectLocale()])

// Effective timezone: browser's own offset when 'auto'. getTimezoneOffset()
// returns minutes WEST of UTC (positive west, negative east) — negate for
// this app's "minutes east of UTC" convention (see TzOverride's doc).
const systemTzOffsetMinutes = -new Date().getTimezoneOffset()
function formatOffsetMinutes(min: number): string {
  if (min === 0) return 'UTC'
  const sign = min > 0 ? '+' : '-'
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`
}
const systemTzName = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
})()
const effectiveTimezoneLabel = computed(() => {
  const offset = formatOffsetMinutes(systemTzOffsetMinutes)
  return systemTzName ? `${offset} (${systemTzName})` : offset
})

// B101: effective input mode. Reuses the SAME §8 layer-3 signal every other
// consumer (UPlotChart.vue, TrackMap.vue, etc.) keys touch-target sizing off
// — `anyPointerCoarse` from useInputCapabilities.ts — rather than inventing a
// separate heuristic here. When inputModePref is 'auto' this already resolves
// through the live matchMedia reads; when it's an explicit 'touch'/'pointer'
// override the composable pins it accordingly (though this indicator only
// renders in the 'auto' case, mirroring theme/language/timezone above).
const { anyPointerCoarse } = useInputCapabilities()
const effectiveInputMode = computed<'touch' | 'pointer'>(() =>
  anyPointerCoarse.value ? 'touch' : 'pointer',
)

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
      inputModePref: inputModePref.value,
      centreCursorMode: centreCursorMode.value,
    },
    drivetrain: {
      kind: drivetrainStore.kind,
      kindSelection: drivetrainStore.kindSelection,
      mt: drivetrainStore.mt,
      cvt: drivetrainStore.cvt,
      inversionWheelCircumferenceMm: drivetrainStore.inversionWheelCircumferenceMm,
    },
    layout: includeLayout.value
      ? {
          dashboardLayout: loadLayout(),
          panelState: loadPanelState(),
          layoutLocked: loadLayoutLocked(),
          currentValuesFieldPrefs: loadCurrentValuesFieldPrefs(),
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
    saveCurrentValuesFieldPrefs(bundle.layout.currentValuesFieldPrefs)
    // The dashboard grid (AnalyzerView) only reads its layout/panel state
    // once at mount, so a reload is needed for an imported layout to take
    // effect immediately — appearance/drivetrain above already applied live
    // via reactive store refs, no reload needed for those alone. The
    // current-values card's field prefs (B49) are read the same
    // once-at-mount way, so they ride along with this same reload.
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

// --- F2: hidden "開發者選項" (dev options) section, revealed by tapping the
// version number REVEAL_TAP_COUNT times (the familiar Android pattern) —
// see devOptionsReveal.ts's module doc. Once revealed it stays revealed on
// this device (no UI to re-hide it), so the tap counter only matters before
// that point. ---
const devOptionsRevealed = ref(loadDevOptionsRevealed())
const versionTapCount = ref(0)
let versionTapResetTimer: ReturnType<typeof setTimeout> | undefined

function onVersionTap(): void {
  if (devOptionsRevealed.value) return
  versionTapCount.value += 1
  // A pause between taps resets the count — a handful of stray clicks spread
  // across unrelated visits to this page shouldn't accidentally accumulate
  // toward the reveal.
  if (versionTapResetTimer) clearTimeout(versionTapResetTimer)
  if (versionTapCount.value >= REVEAL_TAP_COUNT) {
    devOptionsRevealed.value = true
    saveDevOptionsRevealed(true)
    versionTapCount.value = 0
    return
  }
  versionTapResetTimer = setTimeout(() => {
    versionTapCount.value = 0
  }, 2000)
}
onBeforeUnmount(() => {
  if (versionTapResetTimer) clearTimeout(versionTapResetTimer)
})
const tapsRemaining = computed(() => Math.max(0, REVEAL_TAP_COUNT - versionTapCount.value))
const showTapHint = computed(
  () => !devOptionsRevealed.value && versionTapCount.value >= REVEAL_HINT_THRESHOLD,
)

// Every registered flag, listed as a labeled toggle. The toggle itself
// writes/reads the PERSISTED localStorage override (falling back to the
// registry default when the user hasn't touched it yet); the B20-style
// "目前套用" readout next to it always shows the fully-RESOLVED value
// (`useFeatureFlags`'s reactive `flags`), since a `?ff=` link or a
// `window.__flags` console override can outrank this toggle without this
// page knowing — see featureFlags.ts's precedence doc.
const featureFlagNames = Object.keys(FEATURE_FLAGS) as FeatureFlagName[]
const { flags: effectiveFlags } = useFeatureFlags()

function localFlagChecked(name: FeatureFlagName): boolean {
  return getLocalFlagOverride(name) ?? FEATURE_FLAGS[name].default
}
function onFlagToggle(name: FeatureFlagName, e: Event): void {
  setLocalFlagOverride(name, (e.target as HTMLInputElement).checked)
}
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
        <span v-if="themePref === 'auto'" class="current-value">
          {{ t('settings.current', { value: t(`theme.${effectiveTheme}`) }) }}
        </span>
      </label>
      <label class="control">
        <span>{{ t('language.label') }}</span>
        <select v-model="localePref" name="locale">
          <option value="auto">{{ t('language.auto') }}</option>
          <option value="zh-Hant">繁體中文</option>
          <option value="en">English</option>
        </select>
        <span v-if="localePref === 'auto'" class="current-value">
          {{ t('settings.current', { value: effectiveLocaleLabel }) }}
        </span>
      </label>
      <label class="control">
        <span>{{ t('settings.timezone') }}</span>
        <select v-model="tzModel" name="timezone">
          <option value="auto">{{ t('settings.timezoneAuto') }}</option>
          <option v-for="h in tzHours" :key="h" :value="String(h * 60)">{{ tzLabel(h) }}</option>
        </select>
        <span v-if="tzOverride === 'auto'" class="current-value">
          {{ t('settings.current', { value: effectiveTimezoneLabel }) }}
        </span>
      </label>
      <label class="control">
        <span>{{ t('inputMode.label') }}</span>
        <select v-model="inputModePref" name="inputMode">
          <option value="auto">{{ t('inputMode.auto') }}</option>
          <option value="touch">{{ t('inputMode.touch') }}</option>
          <option value="pointer">{{ t('inputMode.pointer') }}</option>
        </select>
        <span v-if="inputModePref === 'auto'" class="current-value">
          {{ t('settings.current', { value: t(`inputMode.${effectiveInputMode}`) }) }}
        </span>
      </label>
      <!-- B31 — global toggle (not per-chart, see UPlotChart.vue's
           centreCursorMode prop doc) for the RaceChrono-style fixed
           centre-needle chart mode. -->
      <label class="control checkbox-control">
        <input v-model="centreCursorMode" type="checkbox" name="centreCursorMode" />
        <span>{{ t('centreCursor.label') }}</span>
      </label>
      <p class="transfer-description">{{ t('centreCursor.hint') }}</p>
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
          <dd>
            <button type="button" class="version-tap" @click="onVersionTap">
              {{ t('about.project.versionValue', { sha: buildSha, date: buildDate }) }}
            </button>
            <span v-if="showTapHint" class="tap-hint">{{
              t('settings.devOptions.tapHint', { n: tapsRemaining })
            }}</span>
          </dd>
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

    <!-- F2 — hidden until the version number (above) is tapped
         REVEAL_TAP_COUNT times; lists every registered feature flag
         (featureFlags.ts) as a toggle. -->
    <div v-if="devOptionsRevealed" class="card">
      <h2 class="card-heading">{{ t('settings.devOptions.heading') }}</h2>
      <p class="transfer-description">{{ t('settings.devOptions.description') }}</p>
      <div v-for="name in featureFlagNames" :key="name" class="flag-row">
        <label class="control checkbox-control">
          <input
            type="checkbox"
            :checked="localFlagChecked(name)"
            @change="onFlagToggle(name, $event)"
          />
          <span>{{ t(FEATURE_FLAGS[name].labelKey) }}</span>
          <span class="current-value">
            {{
              t('settings.current', {
                value: t(`settings.devOptions.${effectiveFlags[name] ? 'on' : 'off'}`),
              })
            }}
          </span>
        </label>
        <p v-if="FEATURE_FLAGS[name].descriptionKey" class="transfer-description flag-description">
          {{ t(FEATURE_FLAGS[name].descriptionKey!) }}
        </p>
      </div>
      <p class="transfer-description">{{ t('settings.devOptions.overrideNote') }}</p>
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
/* B36 — App.vue's `.content` zeroes its own left/right padding below the
   mobile breakpoint so the ANALYZER tab's dashboard cards can go edge-to-
   edge (see that file's own B36 comment). Settings isn't part of that
   full-bleed ask — it's a form layout, not chart/map real estate — so it
   restores the same horizontal gutter here instead, keeping its own look
   unchanged at every width. */
@media (max-width: 768px) {
  .settings {
    padding-left: calc(var(--space) * 2);
    padding-right: calc(var(--space) * 2);
  }
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
  flex-wrap: wrap;
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
.current-value {
  color: var(--color-text-muted);
  font-size: 0.8rem;
  font-style: italic;
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
/* F2 — the version number doubles as the dev-options reveal tap target;
   styled as plain inline text (not an obvious button) so it doesn't look
   like a normal interactive control to ordinary users. */
.version-tap {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: default;
  -webkit-tap-highlight-color: transparent;
}
.tap-hint {
  margin-left: 8px;
  font-size: 0.78rem;
  font-style: italic;
  color: var(--color-text-muted);
}
.flag-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.flag-description {
  margin: 0 0 0 24px;
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
