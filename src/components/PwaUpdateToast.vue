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
  /* BottomNav.vue occupies a fixed strip at the very bottom on narrow
     viewports (see its own `bottom-nav` rule and App.vue's `.content`/
     `.site-footer` padding, which reserve the same amount) — lift the toast
     above it via the shared `--bottom-nav-height` var (theme.css), which is
     0px on desktop/tablet, so this single declaration is correct at every
     width without a separate media query. */
  bottom: calc(
    var(--bottom-nav-height) + var(--space) * 2 + env(safe-area-inset-bottom, 0px)
  );
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
  box-shadow: var(--shadow-3);
}

.pwa-toast-message {
  font-size: var(--text-lg);
  line-height: var(--leading-normal);
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
  font-size: var(--text-base);
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
  font-size: var(--text-base);
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
    transform var(--dur-base) var(--ease-standard),
    opacity var(--dur-base) var(--ease-standard);
}
.pwa-toast-enter-from,
.pwa-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .pwa-toast-enter-active,
  .pwa-toast-leave-active {
    transition: opacity var(--dur-fast) linear;
  }
  .pwa-toast-enter-from,
  .pwa-toast-leave-to {
    transform: translateX(-50%);
  }
}
</style>
