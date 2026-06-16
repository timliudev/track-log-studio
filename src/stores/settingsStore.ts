import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { LocaleCode } from '@/i18n'

export type ThemePref = 'auto' | 'light' | 'dark'
export type LocalePref = 'auto' | LocaleCode

const STORAGE_KEY = 'aracer-loga.settings.v1'

interface PersistedSettings {
  themePref: ThemePref
  localePref: LocalePref
}

function loadPersisted(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Partial<PersistedSettings>) : {}
  } catch {
    return {}
  }
}

/**
 * User preferences, persisted to localStorage. Kept deliberately small — large
 * data (uploaded base maps, column presets) will live in IndexedDB in later
 * phases. exportJson/importJson back the "transfer settings" requirement.
 */
export const useSettingsStore = defineStore('settings', () => {
  const persisted = loadPersisted()
  const themePref = ref<ThemePref>(persisted.themePref ?? 'auto')
  const localePref = ref<LocalePref>(persisted.localePref ?? 'auto')

  watch([themePref, localePref], () => {
    const data: PersistedSettings = {
      themePref: themePref.value,
      localePref: localePref.value,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // storage unavailable / quota — preferences simply won't persist
    }
  })

  function exportJson(): string {
    const data: PersistedSettings = {
      themePref: themePref.value,
      localePref: localePref.value,
    }
    return JSON.stringify(data, null, 2)
  }

  function importJson(json: string): void {
    const data = JSON.parse(json) as Partial<PersistedSettings>
    if (data.themePref) themePref.value = data.themePref
    if (data.localePref) localePref.value = data.localePref
  }

  return { themePref, localePref, exportJson, importJson }
})
