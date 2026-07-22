/**
 * F2 — Settings' hidden "開發者選項" (dev options) section: unlocked by
 * tapping the app version number 7 times (the familiar Android "developer
 * options" pattern), then stays unlocked on this device — a tiny persisted
 * boolean, deliberately its own module rather than folded into
 * settingsStore.ts's `AppearanceSettings` since it's a one-way reveal latch,
 * not a real user-facing preference (there's no UI to hide it again).
 */

export const STORAGE_KEY = 'tracklogstudio.devOptions.v1'

/** How many taps on the version number unlock the section. */
export const REVEAL_TAP_COUNT = 7

/** Taps remaining after which SettingsView starts showing a "還差 N 次" hint. */
export const REVEAL_HINT_THRESHOLD = 3

export function loadDevOptionsRevealed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function saveDevOptionsRevealed(revealed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, revealed ? 'true' : 'false')
  } catch {
    // storage unavailable / quota — reveal state simply won't persist
  }
}
