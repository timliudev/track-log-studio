import type { CurrentValueField } from './currentValues'

/**
 * B49 — user control over the "目前數值" (current values) card's field
 * arrangement: which sort order to use, which channels to hide, and (when
 * sorting is 'custom') a manually-arranged order.
 *
 * Kept as a SIBLING module to currentValues.ts (rather than folded into it)
 * because it's a genuinely separate concern — currentValues.ts answers "what
 * IS the value of every channel at this sample", this module answers "which
 * of those fields does the user want to see, and in what order" — but it
 * still lives under `domain/analysis` (not `domain/layout`, where
 * panelState.ts's sibling per-card collapse/pin state lives) because this is
 * about the card's own CONTENT (channel identity/order), not its position in
 * the dashboard grid.
 *
 * Persisted to localStorage under its own global-slot key
 * (`tracklogstudio.currentValuesFieldPrefs.v1`), same pattern as
 * `domain/layout/panelState.ts` — a plain JSON blob, tolerant of missing/
 * garbage fields on load (see {@link parseCurrentValuesFieldPrefs}), and also
 * folded into the B19 settings export/import bundle (see
 * `domain/settings/settingsTransfer.ts`).
 *
 * Every function here is pure (no localStorage/DOM access — that lives in
 * `useCurrentValuesFieldPrefs.ts`) so the sort/filter/reorder logic is
 * unit-testable without a browser environment.
 */

export type CurrentValuesSortMode = 'original' | 'alphabetical' | 'custom'

export interface CurrentValuesFieldPrefs {
  sortMode: CurrentValuesSortMode
  /** Channel field keys (never `'time'` — the time field can't be hidden)
   *  that are currently hidden from the (non-edit-mode) grid. */
  hidden: string[]
  /**
   * Manually-arranged order of every non-time field key seen so far. Only
   * actually DISPLAYED when `sortMode === 'custom'` (see
   * {@link arrangeCurrentValueFields} / {@link currentValuesEditableFields} —
   * under 'original'/'alphabetical' it's tracked but dormant), so switching
   * TO custom starts from whatever the user last arranged (or channel order,
   * if never touched) instead of an empty list.
   */
  order: string[]
}

export const STORAGE_KEY = 'tracklogstudio.currentValuesFieldPrefs.v1'

/** The empty/default prefs — original channel order, nothing hidden, no
 *  custom order recorded yet. Exported so other callers needing a
 *  well-formed default (e.g. the settings export/import transfer module,
 *  B19) don't have to hand-roll the shape. */
export function defaultCurrentValuesFieldPrefs(): CurrentValuesFieldPrefs {
  return { sortMode: 'original', hidden: [], order: [] }
}

/** Parse persisted JSON into prefs, or null if missing/invalid (caller falls
 *  back to the default). Permissive about extra/missing fields, same spirit
 *  as panelState.ts's `parsePanelState`. */
export function parseCurrentValuesFieldPrefs(raw: string | null): CurrentValuesFieldPrefs | null {
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const d = data as Record<string, unknown>
    const sortMode: CurrentValuesSortMode =
      d.sortMode === 'alphabetical' || d.sortMode === 'custom' ? d.sortMode : 'original'
    const toStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []
    return {
      sortMode,
      hidden: toStringArray(d.hidden),
      order: toStringArray(d.order),
    }
  } catch {
    return null
  }
}

export function loadCurrentValuesFieldPrefs(): CurrentValuesFieldPrefs {
  try {
    return parseCurrentValuesFieldPrefs(localStorage.getItem(STORAGE_KEY)) ?? defaultCurrentValuesFieldPrefs()
  } catch {
    return defaultCurrentValuesFieldPrefs()
  }
}

export function saveCurrentValuesFieldPrefs(prefs: CurrentValuesFieldPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // storage unavailable / quota — prefs simply won't persist
  }
}

/**
 * Reconcile stored prefs against the CURRENT set of non-time field keys
 * (session changed, channels added/removed) — same spirit as
 * `panelState.ts`'s `reconcilePanelState`/`reconcileMobileOrder`: drop
 * `hidden`/`order` entries for channels that no longer exist, then append any
 * brand-new channel's key at the END of `order` (in `currentKeys`' own —
 * i.e. the session's native channel — order) so it shows up last until the
 * user rearranges it. Returns the SAME object (not a copy) when nothing
 * actually changed, so a Vue ref watcher doesn't re-trigger/re-persist on
 * every no-op reconcile (mirrors `setMobileOrder`'s same-reference guard).
 */
export function reconcileCurrentValuesFieldPrefs(
  prefs: CurrentValuesFieldPrefs,
  currentKeys: string[],
): CurrentValuesFieldPrefs {
  const valid = new Set(currentKeys)
  const hidden = prefs.hidden.filter((k) => valid.has(k))
  const keptOrder = prefs.order.filter((k) => valid.has(k))
  const present = new Set(keptOrder)
  const order = [...keptOrder]
  for (const k of currentKeys) {
    if (!present.has(k)) order.push(k)
  }
  const sameHidden = hidden.length === prefs.hidden.length && hidden.every((k, i) => k === prefs.hidden[i])
  const sameOrder = order.length === prefs.order.length && order.every((k, i) => k === prefs.order[i])
  if (sameHidden && sameOrder) return prefs
  return { ...prefs, hidden, order }
}

/** Returns NEW prefs with `key` hidden/shown (or forced to `force` when
 *  provided) — pure, caller re-assigns + persists. No-op (`'time'` can never
 *  be hidden — the caller's UI doesn't even offer the toggle for it, but this
 *  guards the domain layer too). */
export function toggleFieldHidden(
  prefs: CurrentValuesFieldPrefs,
  key: string,
  force?: boolean,
): CurrentValuesFieldPrefs {
  if (key === 'time') return prefs
  const isHidden = prefs.hidden.includes(key)
  const next = force ?? !isHidden
  if (next === isHidden) return prefs
  return {
    ...prefs,
    hidden: next ? [...prefs.hidden, key] : prefs.hidden.filter((k) => k !== key),
  }
}

/** Returns NEW prefs with the sort mode switched — a no-op (same object) if
 *  already that mode. */
export function setCurrentValuesSortMode(
  prefs: CurrentValuesFieldPrefs,
  mode: CurrentValuesSortMode,
): CurrentValuesFieldPrefs {
  if (mode === prefs.sortMode) return prefs
  return { ...prefs, sortMode: mode }
}

/**
 * Move `key` one place up (`direction: -1`) or down (`direction: 1`) within
 * `prefs.order` — the edit-mode "↑/↓" buttons (B49). A no-op (same object)
 * when `key` isn't found or is already at that end, so a disabled-looking
 * button that still gets clicked can't corrupt the order.
 */
export function moveFieldInOrder(
  prefs: CurrentValuesFieldPrefs,
  key: string,
  direction: -1 | 1,
): CurrentValuesFieldPrefs {
  const order = prefs.order
  const i = order.indexOf(key)
  if (i < 0) return prefs
  const j = i + direction
  if (j < 0 || j >= order.length) return prefs
  const next = [...order]
  const tmp = next[i]
  next[i] = next[j]
  next[j] = tmp
  return { ...prefs, order: next }
}

/**
 * The field list the (non-edit-mode) grid actually displays: the time field
 * first (always, unhideable, unmovable — B16/B49), then the remaining fields
 * filtered to non-hidden and ordered per `sortMode`:
 * - `'original'` — the session's own channel order (i.e. `fields`' own order,
 *   filter only).
 * - `'alphabetical'` — locale-aware sort by `label`.
 * - `'custom'` — `prefs.order`, with any field not yet present in it (a
 *   channel added since the order was last touched) appended at the end in
 *   original order (mirrors {@link reconcileCurrentValuesFieldPrefs}, which
 *   normally keeps `order` fully reconciled already — this fallback just
 *   means a stale/unreconciled `order` degrades gracefully instead of
 *   silently dropping the field).
 */
export function arrangeCurrentValueFields(
  fields: CurrentValueField[],
  prefs: CurrentValuesFieldPrefs,
): CurrentValueField[] {
  const timeField = fields.find((f) => f.kind === 'time')
  const rest = fields.filter((f) => f.kind !== 'time')
  const visible = rest.filter((f) => !prefs.hidden.includes(f.key))

  let ordered: CurrentValueField[]
  if (prefs.sortMode === 'alphabetical') {
    ordered = [...visible].sort((a, b) => a.label.localeCompare(b.label))
  } else if (prefs.sortMode === 'custom') {
    const byKey = new Map(visible.map((f) => [f.key, f]))
    ordered = []
    for (const key of prefs.order) {
      const f = byKey.get(key)
      if (f) {
        ordered.push(f)
        byKey.delete(key)
      }
    }
    for (const f of visible) {
      if (byKey.has(f.key)) ordered.push(f)
    }
  } else {
    ordered = visible
  }

  return timeField ? [timeField, ...ordered] : ordered
}

/**
 * The field list the EDIT-MODE grid displays: every non-time field, hidden
 * ones INCLUDED (B49 requires hidden fields stay listed, with their checkbox
 * unchecked, so the user can bring them back) — ordered exactly the same way
 * {@link arrangeCurrentValueFields} would order them (original / alphabetical
 * / custom, per the active `sortMode`), just without dropping the hidden
 * ones. Reusing that function (via a hidden-cleared copy of `prefs`, then
 * dropping the synthetic time entry it always puts first — the caller
 * re-adds time itself, unconditionally, at the very front) keeps the two
 * views from ever silently drifting apart: what you see while editing is
 * always "the live arrangement, plus the hidden fields spliced back in", not
 * a separate ordering concept.
 *
 * Consequence: the "↑/↓" buttons (via {@link moveFieldInOrder}, which only
 * ever touches `prefs.order`) only visibly reorder anything while
 * `sortMode === 'custom'` — under 'original'/'alphabetical' this list (and
 * therefore what a button click would move) is driven by that preset
 * instead, which is why the caller only renders the buttons in custom mode.
 */
export function currentValuesEditableFields(
  fields: CurrentValueField[],
  prefs: CurrentValuesFieldPrefs,
): CurrentValueField[] {
  const unhiddenPrefs: CurrentValuesFieldPrefs = { ...prefs, hidden: [] }
  return arrangeCurrentValueFields(fields, unhiddenPrefs).filter((f) => f.kind !== 'time')
}
