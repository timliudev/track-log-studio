<script setup lang="ts">
import { useI18n } from 'vue-i18n'

export type NavTab = 'converter' | 'analyzer' | 'settings'

defineProps<{
  tab: NavTab
}>()

const emit = defineEmits<{
  (e: 'update:tab', value: NavTab): void
}>()

const { t } = useI18n()

const items: { id: NavTab; labelKey: string; icon: string }[] = [
  { id: 'converter', labelKey: 'nav.converter', icon: '⇄' },
  { id: 'analyzer', labelKey: 'nav.analyzer', icon: '📈' },
  { id: 'settings', labelKey: 'nav.settings', icon: '⚙' },
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
      <span class="bottom-nav__icon" aria-hidden="true">{{ item.icon }}</span>
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
  font-size: 1.25rem;
  line-height: 1;
}

.bottom-nav__label {
  font-size: 0.68rem;
  line-height: 1;
  font-weight: 500;
}
</style>
