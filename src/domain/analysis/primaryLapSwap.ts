/**
 * B55 — migrate per-lap state (selection / manual exclusion / alignment
 * offsets) when the analyzer's PRIMARY recording changes.
 *
 * `lapStore` keeps two parallel facets of this state: an index-only facet for
 * the primary (`selected`/`manualExcluded`/`offsets`, meaningless without
 * knowing which file the indices belong to) and a fileId-keyed facet for
 * every OTHER loaded recording (`selectedAcrossSessions`/
 * `manualExcludedBySession`/`sessionLapOffsets`). Promoting a different
 * recording to primary (FileBar.vue's `makePrimary`, or `toggleIncludedSession`
 * auto-promoting the first comparison when the primary is unchecked) swaps
 * which recording each facet describes — without this migration the index-
 * only facet would silently keep pointing at the OUTGOING primary's lap
 * indices/exclusions/offsets while every consumer reads it as belonging to
 * the new one (see useLaps.ts's/useSectors.ts's file-change watchers, which
 * this module's `primarySwapPending` companion signal is designed to work
 * alongside — see lapStore.ts's `swapPrimarySession`).
 */

/** Stable lap identity once more than one recording is in play — structurally
 *  identical to (and interchangeable with) lapStore's `SessionLapRef`. */
export interface SessionLapRef {
  fileId: number
  index: number
}

/** The index-only facet that always describes "whichever recording is primary". */
export interface PrimaryLapFacet<TOffset> {
  selected: number[]
  manualExcluded: number[]
  offsets: Record<number, TOffset>
}

/** The fileId-keyed facet describing every OTHER (comparison) recording. */
export interface ComparisonLapFacet<TOffset> {
  selectedAcrossSessions: SessionLapRef[]
  manualExcludedBySession: Record<number, number[]>
  sessionLapOffsets: Record<string, TOffset>
}

export interface PrimaryLapSwapInput<TOffset> extends PrimaryLapFacet<TOffset>, ComparisonLapFacet<TOffset> {
  /** The outgoing primary's fileId, or `null` when it is leaving the loaded
   *  set entirely (e.g. unchecking the primary in FileBar — the next
   *  comparison is promoted but the old primary isn't kept as one) rather
   *  than staying loaded as a comparison (an explicit `makePrimary` swap). */
  oldPrimaryId: number | null
  newPrimaryId: number
}

export type PrimaryLapSwapResult<TOffset> = PrimaryLapFacet<TOffset> & ComparisonLapFacet<TOffset>

function sessionLapKey(fileId: number, index: number): string {
  return `${fileId}:${index}`
}

/** Split a `sessionLapKey` back into its fileId (used to filter `Record<string, T>`
 *  facets by recording without re-deriving the key format in callers). */
function keyFileId(key: string): number {
  return Number(key.slice(0, key.indexOf(':')))
}

function keyIndex(key: string): number {
  return Number(key.slice(key.indexOf(':') + 1))
}

/**
 * Compute the post-swap value of every per-lap facet. Pure — `lapStore`'s
 * `swapPrimarySession` action is the only caller and just assigns each
 * returned field back onto its matching ref.
 */
export function swapPrimaryLapState<TOffset>(
  input: PrimaryLapSwapInput<TOffset>,
): PrimaryLapSwapResult<TOffset> {
  const {
    oldPrimaryId,
    newPrimaryId,
    selected,
    manualExcluded,
    offsets,
    selectedAcrossSessions,
    manualExcludedBySession,
    sessionLapOffsets,
  } = input

  // The new primary's own state, pulled OUT of the per-session facets — this
  // becomes the new index-only primary facet regardless of what happens to
  // the outgoing primary below.
  const nextSelected = selectedAcrossSessions
    .filter((ref) => ref.fileId === newPrimaryId)
    .map((ref) => ref.index)
  const nextManualExcluded = manualExcludedBySession[newPrimaryId] ?? []
  const nextOffsets: Record<number, TOffset> = {}
  for (const [key, value] of Object.entries(sessionLapOffsets)) {
    if (keyFileId(key) === newPrimaryId) nextOffsets[keyIndex(key)] = value
  }

  const remainingRefs = selectedAcrossSessions.filter((ref) => ref.fileId !== newPrimaryId)
  const nextManualExcludedBySession = { ...manualExcludedBySession }
  delete nextManualExcludedBySession[newPrimaryId]
  const nextSessionLapOffsets: Record<string, TOffset> = {}
  for (const [key, value] of Object.entries(sessionLapOffsets)) {
    if (keyFileId(key) !== newPrimaryId) nextSessionLapOffsets[key] = value
  }

  // Fold the OUTGOING primary's state back in as a per-session facet under
  // its own id — only when it's staying loaded as a comparison. When it's
  // leaving the analysis set entirely (oldPrimaryId null), its index-only
  // state is simply discarded along with it — nothing to fold it into.
  if (oldPrimaryId != null) {
    remainingRefs.push(...selected.map((index) => ({ fileId: oldPrimaryId, index })))
    if (manualExcluded.length > 0) nextManualExcludedBySession[oldPrimaryId] = manualExcluded
    else delete nextManualExcludedBySession[oldPrimaryId]
    for (const [indexStr, value] of Object.entries(offsets)) {
      nextSessionLapOffsets[sessionLapKey(oldPrimaryId, Number(indexStr))] = value
    }
  }

  return {
    selected: nextSelected,
    manualExcluded: nextManualExcluded,
    offsets: nextOffsets,
    selectedAcrossSessions: remainingRefs,
    manualExcludedBySession: nextManualExcludedBySession,
    sessionLapOffsets: nextSessionLapOffsets,
  }
}
