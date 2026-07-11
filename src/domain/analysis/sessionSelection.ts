export interface SessionSelectionState {
  primaryId: number | null
  comparisonIds: number[]
}

/**
 * Toggle one recording in the analyzer's file-bar selection.
 *
 * The primary recording is always part of the visible set. Unchecking it
 * promotes the first compared recording; when it is the only visible file it
 * stays selected so the analyzer never falls into an ambiguous "files loaded,
 * but no primary" state.
 */
export function toggleIncludedSession(
  state: SessionSelectionState,
  id: number,
): SessionSelectionState {
  if (state.primaryId == null) return { primaryId: id, comparisonIds: [] }

  if (id === state.primaryId) {
    const [nextPrimary, ...remaining] = state.comparisonIds
    return nextPrimary == null
      ? state
      : { primaryId: nextPrimary, comparisonIds: remaining }
  }

  return state.comparisonIds.includes(id)
    ? { ...state, comparisonIds: state.comparisonIds.filter((other) => other !== id) }
    : { ...state, comparisonIds: [...state.comparisonIds, id] }
}

/** Promote a recording without changing which recordings are visible. */
export function promotePrimarySession(
  state: SessionSelectionState,
  id: number,
): SessionSelectionState {
  if (id === state.primaryId) return state
  const comparisons = state.comparisonIds.filter((other) => other !== id)
  if (state.primaryId != null) comparisons.unshift(state.primaryId)
  return { primaryId: id, comparisonIds: comparisons }
}
