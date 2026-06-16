import { computed, ref, watchEffect, type ComputedRef } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Resolves the effective light/dark theme from the user preference and the OS
 * setting, and applies it to <html data-theme> (which theme.css keys off).
 */
export function useTheme(): { effectiveTheme: ComputedRef<'light' | 'dark'> } {
  const { themePref } = storeToRefs(useSettingsStore())

  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const systemDark = ref(media.matches)
  media.addEventListener('change', (e) => {
    systemDark.value = e.matches
  })

  const effectiveTheme = computed<'light' | 'dark'>(() =>
    themePref.value === 'auto'
      ? systemDark.value
        ? 'dark'
        : 'light'
      : themePref.value,
  )

  watchEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme.value)
  })

  return { effectiveTheme }
}
