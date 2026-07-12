<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePwaUpdate } from '@/composables/usePwaUpdate'

const { t } = useI18n()
const { toast, reload, dismiss } = usePwaUpdate()
</script>

<template>
  <Transition name="pwa-toast">
    <div
      v-if="toast"
      class="pwa-toast"
      role="status"
      aria-live="polite"
    >
      <span class="pwa-toast-message">
        {{ toast === 'update' ? t('pwa.updateAvailable') : t('pwa.offlineReady') }}
      </span>
      <div class="pwa-toast-actions">
        <button
          v-if="toast === 'update'"
          type="button"
          class="pwa-toast-reload"
          @click="reload"
        >
          {{ t('pwa.reload') }}
        </button>
        <button
          type="button"
          class="pwa-toast-dismiss"
          :aria-label="t('pwa.dismiss')"
          @click="dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Bottom snackbar/toast — Material & iOS both favour a bottom-anchored,
   non-blocking, dismissible strip for this kind of low-urgency notice
   (rather than a modal dialog, which would interrupt whatever the user is
   doing, e.g. mid-import). Single slot: only ever one toast at a time (see
   pwaUpdateToast.ts's activePwaToast priority — update beats offline-ready). */
.pwa-toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--space) * 2 + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: calc(var(--space) * 1.5);
  max-width: min(92vw, 420px);
  padding: calc(var(--space) * 1.25) calc(var(--space) * 1.5);
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
}

/* On narrow viewports BottomNav.vue occupies a fixed ~56px + safe-area strip
   at the very bottom (see its own `bottom-nav` rule and App.vue's `.content`
   padding, which reserves the same amount) — lift the toast above it so it
   never overlaps the tab bar. */
@media (max-width: 768px) {
  .pwa-toast {
    bottom: calc(56px + var(--space) * 2 + env(safe-area-inset-bottom, 0px));
  }
}

.pwa-toast-message {
  font-size: 0.88rem;
  line-height: 1.35;
}

.pwa-toast-actions {
  display: flex;
  align-items: center;
  gap: calc(var(--space) * 0.5);
  flex: none;
}

.pwa-toast-reload {
  border: none;
  border-radius: var(--radius);
  padding: 6px 12px;
  background: var(--color-accent);
  color: var(--color-accent-text);
  font: inherit;
  font-weight: 600;
  font-size: 0.85rem;
  white-space: nowrap;
  cursor: pointer;
}
.pwa-toast-reload:hover {
  filter: brightness(1.08);
}
.pwa-toast-reload:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.pwa-toast-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  min-height: 32px;
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--color-text-muted);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}
.pwa-toast-dismiss:hover {
  color: var(--color-text);
  background: var(--color-bg);
}
.pwa-toast-dismiss:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.pwa-toast-enter-active,
.pwa-toast-leave-active {
  transition:
    transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.pwa-toast-enter-from,
.pwa-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .pwa-toast-enter-active,
  .pwa-toast-leave-active {
    transition: opacity 0.15s linear;
  }
  .pwa-toast-enter-from,
  .pwa-toast-leave-to {
    transform: translateX(-50%);
  }
}
</style>
