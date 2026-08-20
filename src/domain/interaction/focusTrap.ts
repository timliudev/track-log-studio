/**
 * B118(b) — shared focus-trap primitives for FileBar's three
 * `role="dialog" aria-modal="true"` pickers (rcnx/rcz/composite), consumed
 * by `useModalDialog.ts`. Split out from that composable (rather than
 * inlined) for the same reason `xRangeGesture.ts`/`edgeGesture.ts` are
 * split from their Vue call sites: the tab-wrap ARITHMETIC is pure and
 * trivially unit-testable, while `getFocusableElements` is a thin,
 * intentionally simple DOM query — testable with a plain jsdom/happy-dom
 * container element, no component mount required.
 */

/**
 * Elements considered reachable by Tab inside a trapped dialog. Deliberately
 * NOT exhaustive of every focusable HTML construct (e.g. `contenteditable`,
 * `audio`/`video` controls) — FileBar's three dialogs only ever contain
 * links, buttons, checkboxes, and the dialog root's own `tabindex="-1"`
 * fallback, so this covers everything actually in play without pulling in a
 * generic (and much larger) "is this element focusable" library.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * True when `el` is actually visible — accounts for `display:none`/
 * `visibility:hidden` on `el` itself OR an ancestor, via the standard
 * `checkVisibility()` API where available. Falls back to the cheaper
 * `offsetParent !== null` check (which only catches `display:none`, not
 * `visibility:hidden`, but needs no more browser support than the rest of
 * this codebase already assumes) for the rare runtime that lacks
 * `checkVisibility` — NOTE this fallback is effectively dead in this repo's
 * own test suite: happy-dom (this project's test DOM, see
 * useFlipAnimation.test.ts's comment on its limitations) never computes
 * real layout, so `offsetParent` is always `undefined` there regardless of
 * actual visibility — `checkVisibility` is the one happy-dom DOES implement
 * correctly, which is what {@link getFocusableElements}'s own tests rely
 * on.
 */
function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility()
  return el.offsetParent !== null
}

/**
 * All Tab-reachable descendants of `root`, in DOM order (== visual tab
 * order for this app — nothing here sets an explicit positive `tabindex` to
 * reorder it), excluding anything hidden (see {@link isVisible}).
 *
 * The `tabindex="-1"` re-check below (on top of `FOCUSABLE_SELECTOR`
 * already excluding it for the GENERIC `[tabindex]` clause) matters because
 * `FOCUSABLE_SELECTOR`'s OTHER clauses (`button:not([disabled])` etc.) are
 * independent alternatives in one selector list — a `<button
 * tabindex="-1">` still matches the plain `button:not([disabled])` clause
 * regardless of its tabindex, so without this extra filter a natively
 * focusable element explicitly opted OUT of the tab order via
 * `tabindex="-1"` would incorrectly stay in the trap.
 */
export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.getAttribute('tabindex') !== '-1')
    .filter(isVisible)
}

/**
 * Pure index arithmetic for a Tab/Shift+Tab wrap: given how many focusable
 * elements there are and which one (if any, `-1` if focus is currently
 * outside all of them — e.g. still on the dialog root's own `tabindex="-1"`
 * fallback) currently has focus, return the index Tab should move to next.
 * `-1` always resolves to "the first" (Tab) or "the last" (Shift+Tab) —
 * Tab must always land back INSIDE the trap even when the trap doesn't yet
 * know exactly where focus was.
 */
export function wrappingFocusIndex(currentIndex: number, count: number, shiftKey: boolean): number {
  if (count <= 0) return -1
  if (shiftKey) return currentIndex <= 0 ? count - 1 : currentIndex - 1
  return currentIndex >= count - 1 ? 0 : currentIndex + 1
}
