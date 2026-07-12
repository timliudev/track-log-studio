// Pure state-transition logic for the PWA "update available" / "ready to
// work offline" toast, split out of usePwaUpdate.ts so it's testable without
// touching the `virtual:pwa-register/vue` module (a Vite virtual module that
// only resolves inside a real Vite build/dev context, not plain Vitest).
//
// Two independent boolean signals come from the service worker
// (`needRefresh`, `offlineReady`, both provided by vite-plugin-pwa's
// `useRegisterSW`), each with its own "the user dismissed this one" flag —
// dismissing the offline-ready toast must NOT suppress a later update toast,
// and vice versa, so a single shared "dismissed" flag would be wrong.

export interface PwaToastFlags {
  needRefresh: boolean
  offlineReady: boolean
  needRefreshDismissed: boolean
  offlineReadyDismissed: boolean
}

export type PwaToastKind = 'update' | 'offline-ready' | null

/**
 * Which toast (if any) should be visible right now. "update" always wins
 * over "offline-ready" when both are pending — a pending update is the more
 * actionable, more important message, and showing both at once would be
 * confusing in the single-toast-slot UI this drives.
 */
export function activePwaToast(flags: PwaToastFlags): PwaToastKind {
  if (flags.needRefresh && !flags.needRefreshDismissed) return 'update'
  if (flags.offlineReady && !flags.offlineReadyDismissed) return 'offline-ready'
  return null
}
