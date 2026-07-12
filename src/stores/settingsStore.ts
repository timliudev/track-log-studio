import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { LocaleCode } from '@/i18n'

export type ThemePref = 'auto' | 'light' | 'dark'
export type LocalePref = 'auto' | LocaleCode
/** Timezone for clock-time axis labels: 'auto' (browser) or offset minutes east of UTC. */
export type TzOverride = 'auto' | number

const STORAGE_KEY = 'aracer-loga.settings.v1'

/** The "appearance / general" preference slice — theme, language, timezone.
 *  Pulled out as its own named type (rather than an inline interface) so the
 *  B19 settings export/import transfer module (`domain/settings/
 *  settingsTransfer.ts`) can reference and re-validate exactly this shape
 *  without duplicating the field list. */
export interface AppearanceSettings {
  themePref: ThemePref
  localePref: LocalePref
  tzOverride: TzOverride
}

const VALID_THEME_PREFS: readonly ThemePref[] = ['auto', 'light', 'dark']
const VALID_LOCALE_PREFS: readonly LocalePref[] = ['auto', 'zh-Hant', 'en']

export function defaultAppearanceSettings(): AppearanceSettings {
  return { themePref: 'auto', localePref: 'auto', tzOverride: 'auto' }
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
  return { themePref, localePref, tzOverride }
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

  watch([themePref, localePref, tzOverride], () => {
    const data: AppearanceSettings = {
      themePref: themePref.value,
      localePref: localePref.value,
      tzOverride: tzOverride.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // storage unavailable / quota — preferences simply won't persist
    }
  })

  /** Replace all three appearance fields at once (B19 import) — a single
   *  assignment per ref so the `watch` above only fires (and persists) once
   *  rather than once per field. */
  function applyAppearance(next: AppearanceSettings): void {
    themePref.value = next.themePref
    localePref.value = next.localePref
    tzOverride.value = next.tzOverride
  }

  return { themePref, localePref, tzOverride, applyAppearance }
})
