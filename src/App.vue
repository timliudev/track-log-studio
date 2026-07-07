<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/composables/useLocale'
import FileBar from '@/components/FileBar.vue'
import BottomNav from '@/components/BottomNav.vue'
import GithubStarButton from '@/components/GithubStarButton.vue'

// Lazy tab views: async imports keep each top-level view in its own chunk so
// heavy per-tab dependencies (notably grid-layout-plus + interactjs pulled in
// by AnalyzerView's #8 dashboard grid) stay out of the main bundle and only
// load when the tab is opened (mirrors ScatterChart.vue's GgChart boundary).
// No loadingComponent on purpose: the <Transition mode="out-in"> below waits
// for an async child to resolve before playing the enter animation, so a
// loading placeholder would only add a flash mid-transition.
const ConverterView = defineAsyncComponent(() => import('@/features/converter/ConverterView.vue'))
const AnalyzerView = defineAsyncComponent(() => import('@/features/analyzer/AnalyzerView.vue'))
const SettingsView = defineAsyncComponent(() => import('@/features/settings/SettingsView.vue'))

const { t } = useI18n()

// Apply appearance + language side effects from persisted preferences (the
// selectors themselves now live in the Settings tab — B4).
useTheme()
useLocale()

type Tab = 'converter' | 'analyzer' | 'settings'
const tabOrder: Tab[] = ['converter', 'analyzer', 'settings']
const tab = ref<Tab>('converter')

// Direction-aware slide: figure out whether the newly selected tab sits to
// the right or left of the previous one so the <Transition> can slide the
// incoming view from the matching side (B5).
const transitionName = ref<'slide-left' | 'slide-right'>('slide-left')
function selectTab(next: Tab) {
  const from = tabOrder.indexOf(tab.value)
  const to = tabOrder.indexOf(next)
  transitionName.value = to >= from ? 'slide-left' : 'slide-right'
  tab.value = next
}

const activeView = computed(() => tab.value)

// Build identity injected at compile time (see vite.config.ts `define`).
const buildSha = __BUILD_SHA__
const buildDate = __BUILD_DATE__
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <h1 class="brand-title">{{ t('app.title') }}</h1>
        <span class="brand-subtitle">{{ t('app.subtitle') }}</span>
      </div>
      <div class="topbar-actions">
        <GithubStarButton />
      </div>
    </header>

    <nav class="tabs" :aria-label="t('nav.mainLabel')">
      <button
        type="button"
        class="tab"
        :class="{ active: tab === 'converter' }"
        :aria-current="tab === 'converter' ? 'page' : undefined"
        @click="selectTab('converter')"
      >
        {{ t('nav.converter') }}
      </button>
      <button
        type="button"
        class="tab"
        :class="{ active: tab === 'analyzer' }"
        :aria-current="tab === 'analyzer' ? 'page' : undefined"
        @click="selectTab('analyzer')"
      >
        {{ t('nav.analyzer') }}
      </button>
      <button
        type="button"
        class="tab tab--right"
        :class="{ active: tab === 'settings' }"
        :aria-current="tab === 'settings' ? 'page' : undefined"
        @click="selectTab('settings')"
      >
        {{ t('nav.settings') }}
      </button>
    </nav>

    <FileBar v-if="tab !== 'settings'" />

    <main class="content">
      <Transition :name="transitionName" mode="out-in">
        <ConverterView v-if="activeView === 'converter'" key="converter" />
        <AnalyzerView v-else-if="activeView === 'analyzer'" key="analyzer" />
        <SettingsView v-else-if="activeView === 'settings'" key="settings" />
      </Transition>
    </main>

    <BottomNav :tab="tab" @update:tab="selectTab" />

    <footer class="site-footer">
      <a
        class="repo-link"
        href="https://github.com/timliudev/track-log-studio"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span>{{ t('footer.developedBy') }} timliudev</span>
      </a>
      <span class="build-stamp">build {{ buildSha }} · {{ buildDate }}</span>
    </footer>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space);
  padding: var(--space) calc(var(--space) * 2);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand-title {
  margin: 0;
  font-size: 1.1rem;
  color: var(--color-accent);
}
.brand-subtitle {
  font-size: 0.78rem;
  color: var(--color-text-muted);
}
.topbar-actions {
  display: flex;
  align-items: center;
  flex: none;
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 calc(var(--space) * 2);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.tab {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 14px;
  font: inherit;
  color: var(--color-text-muted);
  cursor: pointer;
}
.tab.active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent);
}
.tab--right {
  margin-left: auto;
}
.tab:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.tab small {
  font-size: 0.7rem;
}
.content {
  flex: 1;
  min-width: 0;
  padding: calc(var(--space) * 2);
  /* Non-linear transition support: the view container establishes the
     positioning context that slide-enter/leave transforms animate within. */
  position: relative;
  overflow-x: clip;
}

/* Below 768px the top tab row gives way to the iOS-style bottom bar
   (BottomNav.vue mirrors this breakpoint), and the content area reserves
   room at the bottom so the fixed bar never overlaps scrolled content. */
@media (max-width: 768px) {
  .tabs {
    display: none;
  }
  .content {
    padding-bottom: calc(var(--space) * 2 + 56px + env(safe-area-inset-bottom, 0px));
  }
}

/* View-switch transition: a subtle non-linear slide+fade, direction-aware
   via the `slide-left` / `slide-right` name picked in selectTab(). */
.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition:
    transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.slide-left-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}
.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-24px);
}
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

@media (prefers-reduced-motion: reduce) {
  .slide-left-enter-active,
  .slide-left-leave-active,
  .slide-right-enter-active,
  .slide-right-leave-active {
    transition: opacity 0.15s linear;
  }
  .slide-left-enter-from,
  .slide-left-leave-to,
  .slide-right-enter-from,
  .slide-right-leave-to {
    transform: none;
  }
}
.site-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: calc(var(--space) * 2);
  border-top: 1px solid var(--color-border);
}
.build-stamp {
  font-size: 0.72rem;
  color: var(--color-text-muted);
  opacity: 0.7;
}
.repo-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-muted);
  text-decoration: none;
  font-size: 0.85rem;
}
.repo-link:hover {
  color: var(--color-text);
}
</style>
