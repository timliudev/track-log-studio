/**
 * F2 — per-card visibility DEVICE preference: which dashboard cards the user
 * wants shown at all, independent of the desktop/mobile 2-D position
 * (dashboardLayout.ts) and collapse/pin state (panelState.ts) — a sibling
 * module/storage key, same "device/UI preference, not per-circuit" pattern
 * those two use.
 *
 * NEW `tracklogstudio.*` storage prefix (see the F2 storage-prefix-rename
 * commit) — this module is introduced alongside that rename, so it starts
 * directly on the new prefix rather than joining the legacy `aracer-loga.*`
 * one first.
 *
 * Two independent signals combine into whether a card actually renders (see
 * AnalyzerView's `isVisibleId`):
 *  - a per-card DATA-AVAILABILITY default (cardDataAvailability.ts's
 *    `cardHasData` — "no corresponding data → default OFF"),
 *  - the user's own EXPLICIT choice recorded here, which always wins once
 *    made (see `isCardVisible`'s doc) — flipping a checkbox in the card menu
 *    is a deliberate, higher-intent choice than a data-driven guess.
 *
 * Every function here is pure (no localStorage access — that lives in
 * `useCardVisibility.ts`), same "pure core, thin storage shell" split
 * currentValuesFieldPrefs.ts and panelState.ts use.
 */

export interface CardVisibilityPrefs {
  /** Card ids the user explicitly turned ON (overrides a data-driven default OFF). */
  shown: string[]
  /** Card ids the user explicitly turned OFF (overrides a data-driven default
   *  ON, or overrides the cvtDynamics card once its feature flag is on). */
  hidden: string[]
}

export const STORAGE_KEY = 'tracklogstudio.cardVisibility.v1'

/** The empty/default prefs — every card falls back to its data-driven default. */
export function defaultCardVisibilityPrefs(): CardVisibilityPrefs {
  return { shown: [], hidden: [] }
}

/** Parse persisted JSON into prefs, or null if missing/invalid (caller falls
 *  back to the default). Permissive about extra/missing fields, same spirit
 *  as panelState.ts's `parsePanelState`. */
export function parseCardVisibilityPrefs(raw: string | null): CardVisibilityPrefs | null {
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const d = data as Record<string, unknown>
    const toStringArray = (v: unknown): string[] =>
      Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []
    return { shown: toStringArray(d.shown), hidden: toStringArray(d.hidden) }
  } catch {
    return null
  }
}

export function loadCardVisibilityPrefs(): CardVisibilityPrefs {
  try {
    return parseCardVisibilityPrefs(localStorage.getItem(STORAGE_KEY)) ?? defaultCardVisibilityPrefs()
  } catch {
    return defaultCardVisibilityPrefs()
  }
}

export function saveCardVisibilityPrefs(prefs: CardVisibilityPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // storage unavailable / quota — prefs simply won't persist
  }
}

/** Effective show/hide for `id`: an explicit hide/show always wins;
 *  otherwise falls back to the data-driven default (`hasData`, see
 *  cardDataAvailability.ts's `cardHasData`). */
export function isCardVisible(prefs: CardVisibilityPrefs, id: string, hasData: boolean): boolean {
  if (prefs.hidden.includes(id)) return false
  if (prefs.shown.includes(id)) return true
  return hasData
}

/** Returns NEW prefs recording an explicit choice for `id` — pure, caller
 *  re-assigns + persists. A no-op (same object reference) when `id` is
 *  already explicitly recorded as `visible`, so a redundant toggle call can't
 *  spuriously re-trigger a persist watcher. */
export function setCardVisible(
  prefs: CardVisibilityPrefs,
  id: string,
  visible: boolean,
): CardVisibilityPrefs {
  const alreadyExplicit = visible ? prefs.shown.includes(id) : prefs.hidden.includes(id)
  if (alreadyExplicit) return prefs
  const shown = prefs.shown.filter((x) => x !== id)
  const hidden = prefs.hidden.filter((x) => x !== id)
  if (visible) shown.push(id)
  else hidden.push(id)
  return { shown, hidden }
}

/** Drop shown/hidden entries for card ids that no longer exist (e.g. a
 *  removed chart) — mirrors panelState.ts's `reconcilePanelState`. Returns
 *  the SAME object when nothing changed (same no-op guard convention). */
export function reconcileCardVisibilityPrefs(
  prefs: CardVisibilityPrefs,
  validIds: string[],
): CardVisibilityPrefs {
  const valid = new Set(validIds)
  const shown = prefs.shown.filter((id) => valid.has(id))
  const hidden = prefs.hidden.filter((id) => valid.has(id))
  if (shown.length === prefs.shown.length && hidden.length === prefs.hidden.length) return prefs
  return { shown, hidden }
}
