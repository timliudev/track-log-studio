<script setup lang="ts">
import { useI18n } from 'vue-i18n'

export type NavTab = 'converter' | 'analyzer' | 'settings' | 'about'

defineProps<{
  tab: NavTab
}>()

const emit = defineEmits<{
  (e: 'update:tab', value: NavTab): void
}>()

const { t } = useI18n()

// Inline SVGs (not emoji/Unicode glyphs) so all three tabs share the exact
// same icon family — same viewBox, stroke width and line-cap style, and
// they inherit `color` via currentColor so the active/inactive tint applies
// uniformly. Before this, analyzer used the 📈 emoji, which renders as a
// fixed-color multi-tone glyph and visibly clashed with the other two
// monoline symbol icons (#20).
const items: { id: NavTab; labelKey: string }[] = [
  { id: 'converter', labelKey: 'nav.converter' },
  { id: 'analyzer', labelKey: 'nav.analyzer' },
  { id: 'settings', labelKey: 'nav.settings' },
  { id: 'about', labelKey: 'nav.about' },
]
</script>

<template>
  <nav class="bottom-nav" :aria-label="t('nav.mainLabel')">
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="bottom-nav__tab"
      :class="{ active: tab === item.id }"
      :aria-current="tab === item.id ? 'page' : undefined"
      @click="emit('update:tab', item.id)"
    >
      <svg
        v-if="item.id === 'converter'"
        class="bottom-nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M7 4 3 8l4 4" />
        <path d="M3 8h13" />
        <path d="M17 12l4 4-4 4" />
        <path d="M21 16H8" />
      </svg>
      <svg
        v-else-if="item.id === 'analyzer'"
        class="bottom-nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4 19V5" />
        <path d="M4 19h16" />
        <path d="M7 16l4-5 3 3 5-7" />
      </svg>
      <svg
        v-else-if="item.id === 'settings'"
        class="bottom-nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        />
      </svg>
      <svg
        v-else
        class="bottom-nav__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16.5" />
        <circle cx="12" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
      </svg>
      <span class="bottom-nav__label">{{ t(item.labelKey) }}</span>
    </button>
  </nav>
</template>

<style scoped>
.bottom-nav {
  display: none;
}

@media (max-width: 768px) {
  .bottom-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    align-items: stretch;
    justify-content: space-around;
    gap: 2px;
    padding: 4px 6px calc(env(safe-area-inset-bottom, 0px) + 4px);
    background: color-mix(in srgb, var(--color-surface) 88%, transparent);
    -webkit-backdrop-filter: blur(14px) saturate(150%);
    backdrop-filter: blur(14px) saturate(150%);
    border-top: 1px solid var(--color-border);
    box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.08);
  }
}

.bottom-nav__tab {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 44px;
  min-width: 44px;
  padding: 6px 4px;
  background: none;
  border: none;
  border-radius: var(--radius);
  font: inherit;
  color: var(--color-text-muted);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    color 0.15s ease,
    transform 0.15s ease;
}

.bottom-nav__tab:active {
  transform: scale(0.94);
}

.bottom-nav__tab.active {
  color: var(--color-accent);
}

.bottom-nav__tab:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}

.bottom-nav__icon {
  width: 22px;
  height: 22px;
}

.bottom-nav__label {
  font-size: 0.68rem;
  line-height: 1;
  font-weight: 500;
}
</style>
