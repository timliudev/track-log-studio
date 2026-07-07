<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGithubStars } from '@/composables/useGithubStars'

const REPO = 'timliudev/track-log-studio'

const { t } = useI18n()
const { stars } = useGithubStars(REPO)

/** GitHub-button-style compact count, e.g. 1234 -> "1.2k"; null (still
 *  loading / offline / fetch failed) falls back to the literal word "Star"
 *  so the button never shows a broken or empty label. */
const label = computed(() => {
  const n = stars.value
  if (n == null) return t('header.githubStar')
  if (n >= 1000) {
    const k = (n / 1000).toFixed(1).replace(/\.0$/, '')
    return `${k}k`
  }
  return String(n)
})
</script>

<template>
  <a
    class="gh-star"
    href="https://github.com/timliudev/track-log-studio"
    target="_blank"
    rel="noopener noreferrer"
    v-tooltip="t('header.githubTooltip')"
  >
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
    <span class="gh-star-label">{{ label }}</span>
  </a>
</template>

<style scoped>
.gh-star {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-bg);
  color: var(--color-text);
  text-decoration: none;
  font-size: 0.8rem;
  line-height: 1;
  white-space: nowrap;
}
.gh-star:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.gh-star svg {
  flex: none;
}

/* Narrow phones: the header already has the brand title competing for
   space, so drop the text label and keep just the icon (matches the app's
   other icon-only-on-mobile affordances, e.g. BottomNav). */
@media (max-width: 480px) {
  .gh-star {
    padding: 6px;
  }
  .gh-star-label {
    display: none;
  }
}
</style>
