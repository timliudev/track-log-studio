import { watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'
import { detectLocale } from '@/i18n'

/**
 * Applies the effective locale (preference, or browser-detected when 'auto')
 * to vue-i18n. Call once from the app root.
 */
export function useLocale(): void {
  const { locale } = useI18n()
  const { localePref } = storeToRefs(useSettingsStore())

  watchEffect(() => {
    locale.value =
      localePref.value === 'auto' ? detectLocale() : localePref.value
  })
}
