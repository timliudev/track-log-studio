import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { LocaleCode } from '@/i18n'

export type ThemePref = 'auto' | 'light' | 'dark'
export type LocalePref = 'auto' | LocaleCode
/** Timezone for clock-time axis labels: 'auto' (browser) or offset minutes east of UTC. */
export type TzOverride = 'auto' | number
/** B35 — §8 觸控友善四層政策's layer-4 manual override fuse: 'auto' (default)
 *  trusts useInputCapabilities()'s live matchMedia reads; 'touch'/'pointer'
 *  pin every capability read regardless of what the device actually reports,
 *  for the rare case the automatic read gets it wrong. */
export type InputModePref = 'auto' | 'touch' | 'pointer'

const STORAGE_KEY = 'aracer-loga.settings.v1'

/** The "appearance / general" preference slice — theme, language, timezone,
 *  input mode. Pulled out as its own named type (rather than an inline
 *  interface) so the B19 settings export/import transfer module
 *  (`domain/settings/settingsTransfer.ts`) can reference and re-validate
 *  exactly this shape without duplicating the field list. */
export interface AppearanceSettings {
  themePref: ThemePref
  localePref: LocalePref
  tzOverride: TzOverride
  inputModePref: InputModePref
  /** B31 — RaceChrono-style fixed centre-needle chart mode: when true, every
   *  time-series chart (`UPlotChart.vue`, wired through `TimeSeriesChart.vue`)
   *  shows an always-visible fixed vertical cursor at its own horizontal
   *  centre; dragging the chart (any pointer type) pans the data under it
   *  instead of the usual pan/box-zoom split, and whatever sample lands under
   *  the needle becomes the app-wide cursor. Deliberately a GLOBAL toggle
   *  (not per-chart) — see UPlotChart.vue's centreCursorMode prop doc for why
   *  a per-chart toggle would fragment the cross-chart cursor sync B30/B30b
   *  just fixed. Default false keeps every chart's existing pan/zoom/cursor
   *  behaviour unchanged. */
  centreCursorMode: boolean
}

const VALID_THEME_PREFS: readonly ThemePref[] = ['auto', 'light', 'dark']
const VALID_LOCALE_PREFS: readonly LocalePref[] = ['auto', 'zh-Hant', 'en']
const VALID_INPUT_MODE_PREFS: readonly InputModePref[] = ['auto', 'touch', 'pointer']

export function defaultAppearanceSettings(): AppearanceSettings {
  return {
    themePref: 'auto',
    localePref: 'auto',
    tzOverride: 'auto',
    inputModePref: 'auto',
    centreCursorMode: false,
  }
}

/**
 * Sanitize a possibly-partial/garbage payload (an older persisted blob, or an
 * imported settings JSON — see B19) into a fully-populated
 * {@link AppearanceSettings}, falling back FIELD-BY-FIELD to the default for
 * anything missing or not recognised — same "never trust persisted/imported
 * JSON wholesale" discipline drivetrainStore's `looksLikeV2Mt`-gated merge
 * uses, just per-field here since every field is an independent scalar
 * (no nested shape to reject-or-accept as a whole).
 */
export function mergeAppearanceSettings(
  partial: Partial<AppearanceSettings> | null | undefined,
): AppearanceSettings {
  const def = defaultAppearanceSettings()
  if (!partial || typeof partial !== 'object') return def
  const themePref = VALID_THEME_PREFS.includes(partial.themePref as ThemePref)
    ? (partial.themePref as ThemePref)
    : def.themePref
  const localePref = VALID_LOCALE_PREFS.includes(partial.localePref as LocalePref)
    ? (partial.localePref as LocalePref)
    : def.localePref
  const tzOverride: TzOverride =
    partial.tzOverride === 'auto' || typeof partial.tzOverride === 'number'
      ? partial.tzOverride
      : def.tzOverride
  const inputModePref = VALID_INPUT_MODE_PREFS.includes(partial.inputModePref as InputModePref)
    ? (partial.inputModePref as InputModePref)
    : def.inputModePref
  const centreCursorMode =
    typeof partial.centreCursorMode === 'boolean' ? partial.centreCursorMode : def.centreCursorMode
  return { themePref, localePref, tzOverride, inputModePref, centreCursorMode }
}

function loadPersisted(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return mergeAppearanceSettings(raw ? (JSON.parse(raw) as Partial<AppearanceSettings>) : undefined)
  } catch {
    return defaultAppearanceSettings()
  }
}

/**
 * User preferences, persisted to localStorage. Kept deliberately small — large
 * data (uploaded base maps, column presets) will live in IndexedDB in later
 * phases. `applyAppearance` backs the B19 settings export/import feature (see
 * `domain/settings/settingsTransfer.ts` for the serialize/validate logic and
 * SettingsView.vue for the export/import UI).
 */
export const useSettingsStore = defineStore('settings', () => {
  const persisted = loadPersisted()
  const themePref = ref<ThemePref>(persisted.themePref)
  const localePref = ref<LocalePref>(persisted.localePref)
  const tzOverride = ref<TzOverride>(persisted.tzOverride)
  const inputModePref = ref<InputModePref>(persisted.inputModePref)
  const centreCursorMode = ref<boolean>(persisted.centreCursorMode)

  watch([themePref, localePref, tzOverride, inputModePref, centreCursorMode], () => {
    const data: AppearanceSettings = {
      themePref: themePref.value,
      localePref: localePref.value,
      tzOverride: tzOverride.value,
      inputModePref: inputModePref.value,
      centreCursorMode: centreCursorMode.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // storage unavailable / quota — preferences simply won't persist
    }
  })

  /** Replace all five appearance fields at once (B19 import) — a single
   *  assignment per ref so the `watch` above only fires (and persists) once
   *  rather than once per field. */
  function applyAppearance(next: AppearanceSettings): void {
    themePref.value = next.themePref
    localePref.value = next.localePref
    tzOverride.value = next.tzOverride
    inputModePref.value = next.inputModePref
    centreCursorMode.value = next.centreCursorMode
  }

  return { themePref, localePref, tzOverride, inputModePref, centreCursorMode, applyAppearance }
})
