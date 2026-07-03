/**
 * #9 — Analyzer dashboard PANEL state: per-card collapse (all breakpoints)
 * and a single mobile-only PIN (sticky-to-top while the rest scrolls).
 *
 * Deliberately a SIBLING module/storage key to dashboardLayout.ts rather than
 * an extension of it: the v1 layout shape (`{ i, x, y, w, h }[]`) is read/
 * written wholesale by grid-layout-plus's `v-model:layout` on every drag/
 * resize, so bolting extra fields onto each item would mean either (a)
 * teaching that round-trip to preserve unknown fields (grid-layout-plus emits
 * its OWN plain objects, it wouldn't echo back a `collapsed`/`pinned` key we
 * added) or (b) re-merging on every emit — both more fragile than just
 * keying a second, independent map by the same stable card id already
 * defined in dashboardLayout.ts (`STATIC_CARD_IDS` / `chartItemId`). Same
 * "global-slot" storage pattern (`aracer-loga.*.v1`) as dashboardLayout.ts /
 * drivetrainStore / settingsStore.
 */

/** Per-card collapse flag, keyed by the same stable card id as DashboardLayoutItem.i. */
export interface PanelState {
  /** Card ids that are currently collapsed (header-only). Absence = expanded. */
  collapsed: string[]
  /** The single pinned (sticky, mobile-only) card id, or null for none. */
  pinnedId: string | null
}

export const STORAGE_KEY = 'aracer-loga.panelState.v1'

function emptyState(): PanelState {
  return { collapsed: [], pinnedId: null }
}

/** Parse persisted JSON into a PanelState, or null if missing/invalid (caller
 *  falls back to an empty state). Permissive about extra/missing fields, same
 *  spirit as dashboardLayout.ts's parseLayout. */
export function parsePanelState(raw: string | null): PanelState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const collapsed = Array.isArray(data.collapsed)
      ? data.collapsed.filter((x: unknown): x is string => typeof x === 'string')
      : []
    const pinnedId = typeof data.pinnedId === 'string' ? data.pinnedId : null
    return { collapsed, pinnedId }
  } catch {
    return null
  }
}

export function loadPanelState(): PanelState {
  try {
    return parsePanelState(localStorage.getItem(STORAGE_KEY)) ?? emptyState()
  } catch {
    return emptyState()
  }
}

export function savePanelState(state: PanelState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage unavailable / quota — panel state simply won't persist
  }
}

/** True when `id` is currently collapsed. */
export function isCollapsed(state: PanelState, id: string): boolean {
  return state.collapsed.includes(id)
}

/** Returns a NEW state with `id`'s collapsed flag toggled (or forced to
 *  `force` when provided) — pure function, caller re-assigns + persists. */
export function toggleCollapsed(state: PanelState, id: string, force?: boolean): PanelState {
  const currentlyCollapsed = isCollapsed(state, id)
  const next = force ?? !currentlyCollapsed
  if (next === currentlyCollapsed) return state
  return {
    ...state,
    collapsed: next ? [...state.collapsed, id] : state.collapsed.filter((x) => x !== id),
  }
}

/** Returns a NEW state with `id` pinned — pinning a second card unpins the
 *  first (only one card may be pinned at a time, per the task's mobile
 *  "watch the map while scrolling" design). Pinning the already-pinned card
 *  unpins it (toggle). */
export function togglePinned(state: PanelState, id: string): PanelState {
  return { ...state, pinnedId: state.pinnedId === id ? null : id }
}

/** Drop collapsed/pinned entries for card ids that no longer exist (e.g. a
 *  removed chart) — mirrors dashboardLayout.ts's reconcileLayout so
 *  localStorage doesn't accumulate stale ids forever. `validIds` is the full
 *  current set of static + chart card ids. */
export function reconcilePanelState(state: PanelState, validIds: string[]): PanelState {
  const valid = new Set(validIds)
  const collapsed = state.collapsed.filter((id) => valid.has(id))
  const pinnedId = state.pinnedId != null && valid.has(state.pinnedId) ? state.pinnedId : null
  if (collapsed.length === state.collapsed.length && pinnedId === state.pinnedId) return state
  return { collapsed, pinnedId }
}
