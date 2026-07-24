/**
 * F1/F5 — mobile view DEVICE preference: which of the two mobile layouts is
 * active (`focus` = F5's single-focus view, `full` = existing full-dashboard
 * scroll), the user's explicit focus/tab order, the currently selected
 * single-focus tab (F5, `currentViewId`), and (F1-only, deprecated) per-panel
 * height weights the retired draggable divider used. A sibling module/storage
 * key to cardVisibility.ts and panelState.ts — same "device/UI preference, not
 * per-circuit" pattern. See docs/specs/F1-MOBILE-STACK-DESIGN.md §8 for the
 * original persisted shape and docs/specs/F5-SINGLE-FOCUS-DESIGN.md §4 for the
 * single-focus-view additions.
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
  /** 'focus' = the mobile single-focus view (F5, mobile default; was the F1
   *  curated Focus Stack), 'full' = existing full-dashboard scroll. */
  mode: 'focus' | 'full'
  /** Card ids in explicit focus-stack top-to-bottom order. Only ids the user
   *  has actually ordered — unknown/absent ids are tolerated on load and
   *  reconciled away (see {@link reconcileMobileView}); an id that's visible
   *  but not yet in this list simply falls after the ordered ones (see
   *  {@link resolveFocusStackOrder}). Still doubles as F5's tab order (the
   *  single-focus view's top tab bar uses the same resolved id list). */
  focusOrder: string[]
  /**
   * @deprecated F1-only (per-panel flex-grow height weight for the retired
   * draggable divider between adjacent stack panels). F5's single-focus view
   * has no height split to weight — kept (and still sanitized/persisted
   * verbatim) purely so old persisted `tracklogstudio.mobileView.v1` values
   * round-trip without loss; no longer read by any view. See
   * {@link weightFor}/{@link setSplitWeight}.
   */
  splitWeights: Record<string, number>
  /** F5 — the id of the card currently shown in the single-focus view's body
   *  (selected via its top tab bar). `''` = unset/stale — the view falls back
   *  to the first visible id (see AnalyzerView's `currentFocusViewId`).
   *  Reconciled like `focusOrder`: an id that's no longer visible/valid is
   *  dropped back to `''` rather than being remapped (see
   *  {@link reconcileMobileView}). */
  currentViewId: string
}

export const STORAGE_KEY = 'tracklogstudio.mobileView.v1'

/** The empty/default mobile-view state — Focus Stack mode, no explicit order
 *  yet, default split weights, no current-view selection. */
export function defaultMobileView(): MobileViewState {
  return { mode: 'focus', focusOrder: [], splitWeights: {}, currentViewId: '' }
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

function toCurrentViewId(v: unknown): string {
  return typeof v === 'string' ? v : ''
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
    currentViewId: toCurrentViewId(d.currentViewId),
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

/** Drop focusOrder entries, splitWeights keys, and a stale currentViewId for
 *  card ids that no longer exist (e.g. a removed chart) — mirrors
 *  panelState.ts's `reconcilePanelState`, but (unlike `reconcileMobileOrder`)
 *  never APPENDS missing ids: `focusOrder` only ever holds ids the user
 *  explicitly placed. `currentViewId` is dropped back to `''` rather than
 *  remapped — same "leave it unset, let the view fall back" contract as an id
 *  that was never set. Returns the SAME object when nothing changed, so a
 *  persist-watch doesn't churn (same no-op guard convention as the sibling
 *  modules). */
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
  const currentViewId = state.currentViewId !== '' && valid.has(state.currentViewId) ? state.currentViewId : ''
  const sameOrder =
    focusOrder.length === state.focusOrder.length &&
    focusOrder.every((id, i) => id === state.focusOrder[i])
  const sameCurrentView = currentViewId === state.currentViewId
  if (sameOrder && !weightsChanged && sameCurrentView) return state
  return { mode: state.mode, focusOrder, splitWeights, currentViewId }
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

/** F5 — returns a NEW state with `currentViewId` set to `id`, the single-focus
 *  view's top tab bar selection (see {@link MobileViewState.currentViewId}).
 *  Same-reference no-op when `id` isn't a string or is already the current
 *  value (same convention as {@link setMode}). Does not itself validate `id`
 *  against the visible set — that's {@link reconcileMobileView}'s job (and
 *  AnalyzerView's own fallback), same division of labour `setFocusOrder` has
 *  with `resolveFocusStackOrder`. */
export function setCurrentView(state: MobileViewState, id: string): MobileViewState {
  if (typeof id !== 'string') return state
  if (state.currentViewId === id) return state
  return { ...state, currentViewId: id }
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

/**
 * @deprecated F1-only (see {@link MobileViewState.splitWeights}) — F5's
 * single-focus view has nothing to weight; kept only so old persisted weights
 * round-trip. The effective height weight for `id`: the persisted
 * `splitWeights[id]` if it's a finite, `> 0` number, else `fallback` (default
 * `1`, i.e. "equal share" when no weight has been recorded).
 */
export function weightFor(state: MobileViewState, id: string, fallback = 1): number {
  const weight = state.splitWeights[id]
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? weight : fallback
}

/**
 * @deprecated F1-only (see {@link weightFor}) — no longer read by any view.
 * F1 phase 2 — returns a NEW state with `splitWeights[id]` set to `weight`,
 *  the draggable-divider persistence path {@link weightFor} reads back.
 *  Sanitizes the same way {@link sanitizeMobileView}'s `toSplitWeights` does:
 *  a `weight` that isn't a finite, `> 0` number is ignored — same-reference
 *  no-op, nothing is written. Also a same-reference no-op when the stored
 *  weight for `id` already equals `weight` (same convention as the other
 *  setters). */
export function setSplitWeight(state: MobileViewState, id: string, weight: number): MobileViewState {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return state
  if (state.splitWeights[id] === weight) return state
  return { ...state, splitWeights: { ...state.splitWeights, [id]: weight } }
}
