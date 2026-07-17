import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { LogSession } from '@/domain/model/LogSession'
import { normalizeExportMetadata, type ExportMetadata } from '@/domain/export/metadata'

export interface ImportedFile {
  id: number
  name: string
  status: 'parsing' | 'ready' | 'error'
  progress: number
  formatId: string | null
  rowCount: number
  error: string | null
  fileType: 'loga' | 'nmea' | 'vbo' | 'rcz' | 'xrk' | 'rcnx' | 'merged'
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

  const readyFiles = computed(() => files.value.filter((f) => f.status === 'ready'))

  const readySessions = computed<LogSession[]>(() =>
    files.value
      .filter((f) => f.status === 'ready')
      .map((f) => sessions.get(f.id))
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
        session: sessions.get(f.id),
        file: originalFiles.get(f.id),
        metadata: getExportMetadata(f.id),
      }))
      .filter(
        (e): e is { id: number; name: string; session: LogSession; file: File; metadata: ExportMetadata } =>
          e.session !== undefined && e.file !== undefined,
      ),
  )

  function getSession(id: number): LogSession | undefined {
    return sessions.get(id)
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

  function completeImport(id: number, session: LogSession): void {
    sessions.set(id, session)
    exportMetadata.set(id, normalizeExportMetadata(session.meta.exportMetadata))
    withFile(id, (f) => {
      f.status = 'ready'
      f.progress = 1
      f.formatId = session.meta.formatId
      f.rowCount = session.rowCount
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
    files.value = files.value.filter((f) => f.id !== id)
  }

  function clearFiles(): void {
    sessions.clear()
    originalFiles.clear()
    exportMetadata.clear()
    files.value = []
  }

  return {
    files,
    readyFiles,
    readySessions,
    savableEntries,
    getSession,
    getExportMetadata,
    setExportMetadata,
    beginImport,
    setProgress,
    completeImport,
    addMergedSession,
    failImport,
    removeFile,
    clearFiles,
  }
})
