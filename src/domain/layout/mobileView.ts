/**
 * F1 — mobile "Focus Stack" view DEVICE preference: which of the two mobile
 * layouts is active (`focus` = new curated stack, `full` = existing
 * full-dashboard scroll), the user's explicit focus-stack panel order, and
 * (reserved for a later phase) per-panel height weights for a draggable
 * divider. A sibling module/storage key to cardVisibility.ts and
 * panelState.ts — same "device/UI preference, not per-circuit" pattern, see
 * docs/specs/F1-MOBILE-STACK-DESIGN.md §8 for the exact persisted shape.
 *
 * `focusOrder` is deliberately NOT the same shape as panelState.ts's
 * `mobileOrder`: `mobileOrder` always holds a full permutation of every
 * current card id (reconcile appends anything missing so the desktop→mobile
 * fallback order is fully determined), whereas `focusOrder` only records the
 * ids the user has EXPLICITLY placed in the stack — an empty/partial
 * `focusOrder` is normal (see `resolveFocusStackOrder`), and reconcile here
 * only drops stale ids, it never appends. This keeps the "which cards get
 * curated into the stack" question (F2's visibility store) fully separate
 * from "what order do the curated ones appear in" (this module).
 *
 * Every function here is pure (no localStorage access — that lives in
 * `useMobileView.ts`), same "pure core, thin storage shell" split
 * cardVisibility.ts and panelState.ts use.
 */

export interface MobileViewState {
  /** 'focus' = curated Focus Stack (mobile default), 'full' = existing
   *  full-dashboard scroll. */
  mode: 'focus' | 'full'
  /** Card ids in explicit focus-stack top-to-bottom order. Only ids the user
   *  has actually ordered — unknown/absent ids are tolerated on load and
   *  reconciled away (see {@link reconcileMobileView}); an id that's visible
   *  but not yet in this list simply falls after the ordered ones (see
   *  {@link resolveFocusStackOrder}). */
  focusOrder: string[]
  /** Per-panel height weight (finite, `> 0`), keyed by card id — reserved for
   *  the phase-2 draggable divider between adjacent stack panels. Empty
   *  object = use the built-in defaults (e.g. map 55% / chart 45%). */
  splitWeights: Record<string, number>
}

export const STORAGE_KEY = 'tracklogstudio.mobileView.v1'

/** The empty/default mobile-view state — Focus Stack mode, no explicit order
 *  yet, default split weights. */
export function defaultMobileView(): MobileViewState {
  return { mode: 'focus', focusOrder: [], splitWeights: {} }
}

/** Exported constant mirror of {@link defaultMobileView} for callers that want
 *  a static default rather than a freshly-allocated object (e.g. comparisons) —
 *  same convention as sibling modules' `DEFAULT_*`-style exports. Always
 *  allocate a fresh copy (e.g. via `defaultMobileView()`) before mutating. */
export const DEFAULT_MOBILE_VIEW: MobileViewState = defaultMobileView()

function toFocusOrder(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string' || x.length === 0) continue
    if (seen.has(x)) continue
    seen.add(x)
    out.push(x)
  }
  return out
}

function toSplitWeights(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, number> = {}
  for (const [id, weight] of Object.entries(v as Record<string, unknown>)) {
    if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
      out[id] = weight
    }
  }
  return out
}

/** Sanitize an arbitrary (possibly corrupt/foreign) value into a well-formed
 *  `MobileViewState` — never throws. Anything malformed falls back to the
 *  corresponding default field rather than failing the whole parse, same
 *  permissive spirit as `parsePanelState`/`parseCardVisibilityPrefs`. */
export function sanitizeMobileView(raw: unknown): MobileViewState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultMobileView()
  const d = raw as Record<string, unknown>
  const mode: MobileViewState['mode'] = d.mode === 'focus' || d.mode === 'full' ? d.mode : 'focus'
  return {
    mode,
    focusOrder: toFocusOrder(d.focusOrder),
    splitWeights: toSplitWeights(d.splitWeights),
  }
}

export function loadMobileView(): MobileViewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultMobileView()
    return sanitizeMobileView(JSON.parse(raw))
  } catch {
    return defaultMobileView()
  }
}

export function saveMobileView(state: MobileViewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage unavailable / quota — mobile-view prefs simply won't persist
  }
}

/** Drop focusOrder entries and splitWeights keys for card ids that no longer
 *  exist (e.g. a removed chart) — mirrors panelState.ts's
 *  `reconcilePanelState`, but (unlike `reconcileMobileOrder`) never APPENDS
 *  missing ids: `focusOrder` only ever holds ids the user explicitly placed.
 *  Returns the SAME object when nothing changed, so a persist-watch doesn't
 *  churn (same no-op guard convention as the sibling modules). */
export function reconcileMobileView(state: MobileViewState, validIds: string[]): MobileViewState {
  const valid = new Set(validIds)
  const focusOrder = state.focusOrder.filter((id) => valid.has(id))
  const splitWeights: Record<string, number> = {}
  let weightsChanged = false
  for (const [id, weight] of Object.entries(state.splitWeights)) {
    if (valid.has(id)) {
      splitWeights[id] = weight
    } else {
      weightsChanged = true
    }
  }
  const sameOrder =
    focusOrder.length === state.focusOrder.length &&
    focusOrder.every((id, i) => id === state.focusOrder[i])
  if (sameOrder && !weightsChanged) return state
  return { mode: state.mode, focusOrder, splitWeights }
}

/** Returns a NEW state with `mode` set — pure, caller re-assigns + persists.
 *  Same-reference no-op when `mode` is unchanged. */
export function setMode(state: MobileViewState, mode: MobileViewState['mode']): MobileViewState {
  if (state.mode === mode) return state
  return { ...state, mode }
}

/** Returns a NEW state with the focus-stack order replaced — sanitizes the
 *  input (non-empty strings, deduped) same as {@link sanitizeMobileView}.
 *  Same-reference no-op when the (sanitized) order is unchanged. */
export function setFocusOrder(state: MobileViewState, order: string[]): MobileViewState {
  const next = toFocusOrder(order)
  const same =
    next.length === state.focusOrder.length && next.every((id, i) => id === state.focusOrder[i])
  if (same) return state
  return { ...state, focusOrder: next }
}

/**
 * The ordered list of cards to render in the Focus Stack: `focusOrder`
 * entries that are actually visible, in `focusOrder`'s order, followed by any
 * remaining visible ids in their given default order — i.e. "explicit order
 * first, then the rest in default order, filtered to what's actually
 * visible". Same semantics as panelState.ts's `mobileOrder` /
 * `reconcileMobileOrder` combo (see AnalyzerView's `mobileVisibleLayout`), but
 * computed on demand from the two independent inputs rather than stored as a
 * single reconciled array, since `focusOrder` deliberately doesn't force a
 * full permutation the way `mobileOrder` does. Never includes an id that
 * isn't in `visibleIdsInDefaultOrder`.
 */
export function resolveFocusStackOrder(
  visibleIdsInDefaultOrder: string[],
  focusOrder: string[],
): string[] {
  const visible = new Set(visibleIdsInDefaultOrder)
  const ordered = focusOrder.filter((id) => visible.has(id))
  const placed = new Set(ordered)
  for (const id of visibleIdsInDefaultOrder) {
    if (!placed.has(id)) ordered.push(id)
  }
  return ordered
}

/** The effective height weight for `id`: the persisted `splitWeights[id]` if
 *  it's a finite, `> 0` number, else `fallback` (default `1`, i.e. "equal
 *  share" when no weight has been recorded). */
export function weightFor(state: MobileViewState, id: string, fallback = 1): number {
  const weight = state.splitWeights[id]
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : fallback
}
