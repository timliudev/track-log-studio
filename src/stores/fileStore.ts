import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { LogSession } from '@/domain/model/LogSession'
import { normalizeExportMetadata, type ExportMetadata } from '@/domain/export/metadata'
import type { RcnxSessionInfo } from '@/domain/import/rcnx/parseRcnx'

export interface ImportedFile {
  id: number
  name: string
  status: 'parsing' | 'ready' | 'error'
  progress: number
  formatId: string | null
  rowCount: number
  error: string | null
  fileType: 'loga' | 'nmea' | 'vbo' | 'rcz' | 'xrk' | 'rcnx' | 'merged'
  /**
   * F4 phase 1 — present only for records imported from a MULTI-session
   * `.rcnx` archive (`listRcnxSessions()` returned more than one entry at
   * import time). Lets FileBar offer a "切換場次" control that re-parses the
   * SAME original File at a different `sessionIndex` and replaces this
   * record's LogSession in place (see `replaceSession` below) instead of
   * requiring the user to re-import the file from disk. Absent for
   * single-session `.rcnx` and every other format — a length check (`> 1`)
   * at write time, not just presence, gates whether the switcher UI shows.
   */
  rcnxSessions?: RcnxSessionInfo[]
  /** The `RcnxSessionInfo.n` of the session currently loaded into this record. */
  rcnxSessionIndex?: number
}

/**
 * Map a file name to its import fileType, used ONLY to gate the .loga
 * in-place patch flow (`savableEntries` / `patchLogaText`) — that flow rewrites
 * the original .loga text byte-for-byte and only makes sense for a real .loga
 * source. Export-to-any-format (the registry in `domain/export/registry.ts`)
 * does not consult this at all; it works off any ready LogSession regardless
 * of source format.
 */
function fileTypeOf(name: string): ImportedFile['fileType'] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.nmea')) return 'nmea'
  if (lower.endsWith('.vbo')) return 'vbo'
  if (lower.endsWith('.rcz')) return 'rcz'
  if (lower.endsWith('.xrk') || lower.endsWith('.xrz')) return 'xrk'
  if (lower.endsWith('.rcnx')) return 'rcnx'
  return 'loga'
}

export const useFileStore = defineStore('file', () => {
  const files = ref<ImportedFile[]>([])
  let nextId = 1

  // Non-reactive: prevent Vue from deeply proxying large typed arrays
  const sessions = new Map<number, LogSession>()
  const originalFiles = new Map<number, File>()
  const exportMetadata = reactive(new Map<number, ExportMetadata>())
  // F4 phase 1 — a reactive per-id counter with NO purpose other than being
  // read (and bumped) so Vue can track/trigger recomputation around the
  // plain, intentionally-non-reactive `sessions` Map above. `getSession`
  // reads it purely for the dependency; `replaceSession` bumps it when a
  // record's LogSession is swapped in place (the `.rcnx` session switcher),
  // so every computed built on `getSession(id)` (useActiveSession,
  // useSessionComparison, useTrackOverlay, …) recomputes with the new
  // channels — same as it already does when `analyzer.activeFileId` itself
  // changes to a different id.
  const sessionVersion = reactive<Record<number, number>>({})

  const readyFiles = computed(() => files.value.filter((f) => f.status === 'ready'))

  const readySessions = computed<LogSession[]>(() =>
    files.value
      .filter((f) => f.status === 'ready')
      .map((f) => getSession(f.id))
      .filter((s): s is LogSession => s !== undefined),
  )

  /** Ready loga files paired with session + original File (for the loga writer). */
  const savableEntries = computed<
    { id: number; name: string; session: LogSession; file: File; metadata: ExportMetadata }[]
  >(() =>
    files.value
      .filter((f) => f.status === 'ready' && f.fileType === 'loga')
      .map((f) => ({
        id: f.id,
        name: f.name,
        session: getSession(f.id),
        file: originalFiles.get(f.id),
        metadata: getExportMetadata(f.id),
      }))
      .filter(
        (e): e is { id: number; name: string; session: LogSession; file: File; metadata: ExportMetadata } =>
          e.session !== undefined && e.file !== undefined,
      ),
  )

  function getSession(id: number): LogSession | undefined {
    void sessionVersion[id] // reactive-dependency touch only, see sessionVersion's doc above
    return sessions.get(id)
  }

  /** The original uploaded File for a record, if one exists (absent for
   *  in-app-produced sessions like SessionMerge's `addMergedSession`). Used by
   *  FileBar's `.rcnx` session switcher to re-parse the SAME file at a
   *  different `sessionIndex` without asking the user to re-upload it. */
  function getOriginalFile(id: number): File | undefined {
    return originalFiles.get(id)
  }

  function getExportMetadata(id: number): ExportMetadata {
    return exportMetadata.get(id) ?? normalizeExportMetadata(sessions.get(id)?.meta.exportMetadata)
  }

  function setExportMetadata(id: number, metadata: ExportMetadata): void {
    if (!sessions.has(id)) return
    exportMetadata.set(id, normalizeExportMetadata(metadata))
  }

  function beginImport(file: File): number {
    const id = nextId++
    const fileType = fileTypeOf(file.name)
    originalFiles.set(id, file)
    files.value.push({
      id,
      name: file.name,
      status: 'parsing',
      progress: 0,
      formatId: null,
      rowCount: 0,
      error: null,
      fileType,
    })
    return id
  }

  function withFile(id: number, fn: (f: ImportedFile) => void): void {
    const f = files.value.find((x) => x.id === id)
    if (f) fn(f)
  }

  function setProgress(id: number, fraction: number): void {
    withFile(id, (f) => { f.progress = fraction })
  }

  /**
   * `rcnxSwitch` is supplied by FileBar for `.rcnx` imports and only takes
   * effect (is stored on the record) when it lists MORE than one session —
   * a single-session `.rcnx` carries no switch context, same as every other
   * format.
   */
  function completeImport(
    id: number,
    session: LogSession,
    rcnxSwitch?: { sessions: RcnxSessionInfo[]; sessionIndex: number },
  ): void {
    sessions.set(id, session)
    exportMetadata.set(id, normalizeExportMetadata(session.meta.exportMetadata))
    withFile(id, (f) => {
      f.status = 'ready'
      f.progress = 1
      f.formatId = session.meta.formatId
      f.rowCount = session.rowCount
      if (rcnxSwitch && rcnxSwitch.sessions.length > 1) {
        f.rcnxSessions = rcnxSwitch.sessions
        f.rcnxSessionIndex = rcnxSwitch.sessionIndex
      }
    })
  }

  /**
   * F4 phase 1 — replace an existing READY record's LogSession IN PLACE (same
   * id/slot/role: analysis selection, colour, comparison membership all stay
   * put), used by FileBar's `.rcnx` "切換場次" switcher to load a different
   * `sess_N` from the SAME already-imported archive without re-importing.
   * No-op if `id` was never a real parsed record (e.g. already removed).
   *
   * Bumps `sessionVersion` so every computed reading `getSession(id)` picks
   * up the new channels. Callers are responsible for invalidating whatever
   * lap-index-keyed state (selection/manual-exclusion/offsets) pointed at the
   * OLD session — that depends on whether `id` is the analyzer's primary or a
   * comparison recording, a distinction this store (deliberately) has no
   * opinion on; see FileBar.vue's `switchRcnxSession`.
   */
  function replaceSession(id: number, session: LogSession, sessionIndex: number): void {
    if (!sessions.has(id)) return
    sessions.set(id, session)
    exportMetadata.set(id, normalizeExportMetadata(session.meta.exportMetadata))
    sessionVersion[id] = (sessionVersion[id] ?? 0) + 1
    withFile(id, (f) => {
      f.formatId = session.meta.formatId
      f.rowCount = session.rowCount
      if (f.rcnxSessions) f.rcnxSessionIndex = sessionIndex
    })
  }

  function failImport(id: number, message: string): void {
    withFile(id, (f) => {
      f.status = 'error'
      f.error = message
    })
  }

  /**
   * Register a session that was produced in-app (not parsed from an uploaded
   * File) — currently only Phase 5's GPS session merge (see
   * `useSessionMerge.ts`). Goes straight to 'ready' (no parsing phase) and has
   * no `originalFiles` entry, so it's naturally excluded from `savableEntries`
   * (no source .loga text to patch) but still shows up in `readyFiles` /
   * `readySessions` for the analyzer and any export-registry format.
   */
  function addMergedSession(name: string, session: LogSession): number {
    const id = nextId++
    sessions.set(id, session)
    exportMetadata.set(id, normalizeExportMetadata(session.meta.exportMetadata))
    files.value.push({
      id,
      name,
      status: 'ready',
      progress: 1,
      formatId: session.meta.formatId,
      rowCount: session.rowCount,
      error: null,
      fileType: 'merged',
    })
    return id
  }

  function removeFile(id: number): void {
    sessions.delete(id)
    originalFiles.delete(id)
    exportMetadata.delete(id)
    delete sessionVersion[id]
    files.value = files.value.filter((f) => f.id !== id)
  }

  function clearFiles(): void {
    sessions.clear()
    originalFiles.clear()
    exportMetadata.clear()
    for (const key of Object.keys(sessionVersion)) delete sessionVersion[Number(key)]
    files.value = []
  }

  return {
    files,
    readyFiles,
    readySessions,
    savableEntries,
    getSession,
    getOriginalFile,
    getExportMetadata,
    setExportMetadata,
    beginImport,
    setProgress,
    completeImport,
    replaceSession,
    addMergedSession,
    failImport,
    removeFile,
    clearFiles,
  }
})
