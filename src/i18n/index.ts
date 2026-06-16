import { createI18n } from 'vue-i18n'
import zhHant from './locales/zh-Hant'
import en from './locales/en'

export type LocaleCode = 'zh-Hant' | 'en'

export const SUPPORTED_LOCALES: readonly LocaleCode[] = ['zh-Hant', 'en']

export const DEFAULT_LOCALE: LocaleCode = 'zh-Hant'

/** Best-matching supported locale from the browser, defaulting to zh-Hant. */
export function detectLocale(): LocaleCode {
  const langs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const lang of langs) {
    const lower = lang.toLowerCase()
    if (lower.startsWith('zh')) return 'zh-Hant'
    if (lower.startsWith('en')) return 'en'
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: 'en',
  messages: {
    'zh-Hant': zhHant,
    en,
  },
})
