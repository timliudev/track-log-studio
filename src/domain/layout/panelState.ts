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
 * "global-slot" storage pattern (`tracklogstudio.*.v1`) as dashboardLayout.ts /
 * drivetrainStore / settingsStore.
 */

/** Per-card collapse flag, keyed by the same stable card id as DashboardLayoutItem.i. */
export interface PanelState {
  /** Card ids that are currently collapsed (header-only). Absence = expanded. */
  collapsed: string[]
  /** The single pinned (sticky, mobile-only) card id, or null for none. */
  pinnedId: string | null
  /**
   * #9 (revised) — the user's chosen MOBILE (single-column) card order, top to
   * bottom, keyed by the same stable card id. Kept HERE rather than in
   * dashboardLayout.v1 on purpose: the desktop 2-D arrangement
   * (`{ i, x, y, w, h }[]`) and the mobile 1-D order are independent user
   * preferences — reordering on a phone must not clobber the desktop layout,
   * and vice-versa. Empty `[]` means "no mobile customisation yet" → fall back
   * to the default (desktop-layout-derived) order. Only visible cards that
   * actually exist are ever stored (see {@link reconcilePanelState}); unknown
   * ids are tolerated on load and reconciled away.
   */
  mobileOrder: string[]
}

export const STORAGE_KEY = 'tracklogstudio.panelState.v1'

/** The empty/default panel state — no cards collapsed, none pinned, no
 *  mobile-order customisation yet. Exported (not just an internal fallback)
 *  so other callers needing a well-formed default (e.g. the settings
 *  export/import transfer module, B19) don't have to hand-roll the shape. */
export function defaultPanelState(): PanelState {
  return { collapsed: [], pinnedId: null, mobileOrder: [] }
}

/** Parse persisted JSON into a PanelState, or null if missing/invalid (caller
 *  falls back to an empty state). Permissive about extra/missing fields, same
 *  spirit as dashboardLayout.ts's parseLayout. */
export function parsePanelState(raw: string | null): PanelState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const collapsed = Array.isArray(data.collapsed)
      ? data.collapsed.filter((x: unknown): x is string => typeof x === 'string')
      : []
    const pinnedId = typeof data.pinnedId === 'string' ? data.pinnedId : null
    // `mobileOrder` is a v1.1 addition — tolerate its absence (older blobs) by
    // defaulting to []; filter to strings + de-dup so a corrupt/duplicated
    // entry can't wedge the reorder logic downstream.
    const mobileOrder: string[] = Array.isArray(data.mobileOrder)
      ? [
          ...new Set<string>(
            data.mobileOrder.filter((x: unknown): x is string => typeof x === 'string'),
          ),
        ]
      : []
    return { collapsed, pinnedId, mobileOrder }
  } catch {
    return null
  }
}

export function loadPanelState(): PanelState {
  try {
    return parsePanelState(localStorage.getItem(STORAGE_KEY)) ?? defaultPanelState()
  } catch {
    return defaultPanelState()
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

/** Returns a NEW state with the mobile card order replaced — pure, caller
 *  re-assigns + persists. De-dups defensively (the grid should never emit
 *  duplicate ids, but a stray double never wedges the order).
 *
 *  #11 — same-reference guard: when the (de-duped) order is IDENTICAL to the
 *  current one, return the existing `state` object unchanged rather than a
 *  fresh `{ ...state }`. `usePanelState` does `state.value = setMobileOrder(...)`,
 *  and a Vue ref triggers on reference inequality; without this guard, a
 *  breakpoint switch to mobile makes `activeLayout`'s getter emit the mobile
 *  layout, grid-layout-plus echoes it back (it re-emits `update:layout` even
 *  when nothing moved), the setter calls `setMobileOrder` with the SAME order,
 *  a new object is assigned, the ref re-triggers, and the whole chain loops
 *  until Vue throws "Maximum recursive updates exceeded" (see AnalyzerView's
 *  `activeLayout`). Mirrors `reconcilePanelState`'s `sameOrder` short-circuit
 *  and the desktop branch's `mergeLayoutPositions` same-ref guard (#4). */
export function setMobileOrder(state: PanelState, order: string[]): PanelState {
  const deduped = [...new Set(order)]
  const sameOrder =
    deduped.length === state.mobileOrder.length &&
    deduped.every((id, i) => id === state.mobileOrder[i])
  if (sameOrder) return state
  return { ...state, mobileOrder: deduped }
}

/**
 * Reconcile a persisted mobile order against the CURRENT set of card ids
 * (static + chart), same spirit as dashboardLayout's reconcileLayout: keep the
 * user's chosen order for ids that still exist (dropping removed charts), then
 * append any brand-new card id at the END (so an added chart shows up at the
 * bottom of the mobile column, matching the desktop "append below" rule).
 * `orderedIds` is the canonical order to append missing ids in (the default
 * top-to-bottom card order) so a fresh state with no stored order is
 * deterministic.
 */
export function reconcileMobileOrder(stored: string[], orderedIds: string[]): string[] {
  const valid = new Set(orderedIds)
  const kept = stored.filter((id) => valid.has(id))
  const present = new Set(kept)
  for (const id of orderedIds) {
    if (!present.has(id)) kept.push(id)
  }
  return kept
}

/** Drop collapsed/pinned entries for card ids that no longer exist (e.g. a
 *  removed chart) — mirrors dashboardLayout.ts's reconcileLayout so
 *  localStorage doesn't accumulate stale ids forever. `validIds` is the full
 *  current set of static + chart card ids. */
export function reconcilePanelState(state: PanelState, validIds: string[]): PanelState {
  const valid = new Set(validIds)
  const collapsed = state.collapsed.filter((id) => valid.has(id))
  const pinnedId = state.pinnedId != null && valid.has(state.pinnedId) ? state.pinnedId : null
  // `validIds` doubles as the canonical top-to-bottom order for appending any
  // not-yet-ordered card (usePanelState passes [...staticIds, ...chartIds]).
  const mobileOrder = reconcileMobileOrder(state.mobileOrder, validIds)
  const sameOrder =
    mobileOrder.length === state.mobileOrder.length &&
    mobileOrder.every((id, i) => id === state.mobileOrder[i])
  if (collapsed.length === state.collapsed.length && pinnedId === state.pinnedId && sameOrder) {
    return state
  }
  return { collapsed, pinnedId, mobileOrder }
}
