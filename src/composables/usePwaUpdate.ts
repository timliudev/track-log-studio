import { computed, onUnmounted, ref, watch, type ComputedRef } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { activePwaToast, type PwaToastKind } from './pwaUpdateToast'

// Informational-only toast (no action needed) — auto-dismiss it after a
// short delay, matching Material/iOS snackbar convention for non-actionable
// confirmations. The update toast is deliberately NOT auto-dismissed: it
// carries an action (reload) the user might want to defer, e.g. mid-import.
const OFFLINE_READY_AUTO_DISMISS_MS = 6000

/**
 * Registers the service worker (`registerType: 'prompt'` in vite.config.ts —
 * see that file for why) and exposes a single-slot toast state machine for
 * "update available" / "ready to work offline", plus the actions to reload
 * or dismiss. UI lives in PwaUpdateToast.vue; this composable stays UI-free
 * so the transition logic (pwaUpdateToast.ts) can be unit tested directly.
 */
export function usePwaUpdate(): {
  toast: ComputedRef<PwaToastKind>
  reload: () => void
  dismiss: () => void
} {
  const needRefreshDismissed = ref(false)
  const offlineReadyDismissed = ref(false)

  const { needRefresh, offlineReady, updateServiceWorker } = useRegisterSW({
    onRegisterError(error) {
      // Best-effort: a PWA that fails to register its service worker should
      // degrade to "just a website", not break the app it's meant to serve.
      console.error('[pwa] service worker registration failed', error)
    },
  })

  const toast = computed<PwaToastKind>(() =>
    activePwaToast({
      needRefresh: needRefresh.value,
      offlineReady: offlineReady.value,
      needRefreshDismissed: needRefreshDismissed.value,
      offlineReadyDismissed: offlineReadyDismissed.value,
    }),
  )

  let autoDismissTimer: ReturnType<typeof setTimeout> | undefined
  // `immediate: true` so the auto-dismiss timer still gets scheduled even if
  // `offlineReady` is already `true` by the time this composable runs (e.g.
  // registration resolved synchronously-ish before this watch is set up) —
  // without it, a plain `watch` only reacts to *changes*, and an
  // already-true starting value would never trigger the callback.
  watch(
    offlineReady,
    (ready) => {
      clearTimeout(autoDismissTimer)
      if (!ready) return
      autoDismissTimer = setTimeout(() => {
        offlineReadyDismissed.value = true
      }, OFFLINE_READY_AUTO_DISMISS_MS)
    },
    { immediate: true },
  )
  onUnmounted(() => clearTimeout(autoDismissTimer))

  function reload(): void {
    // `true` per the plugin's own contract: it fetches, activates the new
    // worker via skipWaiting + clients.claim, then reloads this page for us.
    void updateServiceWorker(true)
  }

  function dismiss(): void {
    if (toast.value === 'update') needRefreshDismissed.value = true
    else if (toast.value === 'offline-ready') offlineReadyDismissed.value = true
  }

  return { toast, reload, dismiss }
}
