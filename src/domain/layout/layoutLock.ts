/**
 * Dashboard-lock (鎖定布局): a single global boolean, persisted to
 * localStorage alongside dashboardLayout.v1/panelState.v1 (same
 * `tracklogstudio.*.v1` slot pattern — see dashboardLayout.ts's module doc).
 *
 * Deliberately its OWN tiny storage key rather than a field bolted onto
 * DashboardLayoutItem[] or PanelState: it's a single scalar toggle, not
 * per-card state, and keeping it separate means neither of those modules'
 * parse/reconcile logic needs to know about it.
 *
 * Semantics: TRUE disables both drag AND resize for every card (grid-wide);
 * FALSE (default) restores whatever drag/resize the current breakpoint
 * already allows. This is intentionally orthogonal to per-card PIN (see
 * panelState.ts) — pinning affects scroll position, not drag/resize — so a
 * pinned card's placeholder slot still separately loses drag/resize (via
 * AnalyzerView's per-item decoration) regardless of this global flag.
 */

export const STORAGE_KEY = 'tracklogstudio.layoutLocked.v1'

/** Parse persisted JSON into a boolean, or null if missing/invalid (caller
 *  falls back to the default, unlocked, state). */
export function parseLayoutLocked(raw: string | null): boolean | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    return typeof data === 'boolean' ? data : null
  } catch {
    return null
  }
}

export function loadLayoutLocked(): boolean {
  try {
    return parseLayoutLocked(localStorage.getItem(STORAGE_KEY)) ?? false
  } catch {
    return false
  }
}

export function saveLayoutLocked(locked: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(locked))
  } catch {
    // storage unavailable / quota — the lock simply won't persist
  }
}
