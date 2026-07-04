/**
 * Pure helpers for FileBar's drag-and-drop import (#3). Kept free of Vue/DOM
 * event wiring so the file-filtering logic can be unit-tested without a
 * browser/jsdom environment — the test env here is plain `node` (see
 * vite.config.ts), so these only rely on the *shape* of DataTransfer, not a
 * real one.
 */

/**
 * True if the drag actually carries OS files, as opposed to e.g. dragging
 * selected page text or a link/image from elsewhere on the page. Browsers
 * expose this via `DataTransfer.types` containing `'Files'` — checking this
 * (rather than `dataTransfer.files.length`) is reliable even during
 * `dragover`, when most browsers don't populate `files` yet for security
 * reasons but do already populate `types`.
 */
export function isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types).includes('Files')
}

/**
 * Extract the dropped Files from a drop event's DataTransfer. Returns an
 * empty array (rather than throwing) for a non-file drag so callers can
 * safely no-op.
 */
export function filesFromDataTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
  if (!isFileDrag(dataTransfer)) return []
  return Array.from(dataTransfer?.files ?? [])
}
