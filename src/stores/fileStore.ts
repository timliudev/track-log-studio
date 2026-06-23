import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LogSession } from '@/domain/model/LogSession'

export interface ImportedFile {
  id: number
  name: string
  status: 'parsing' | 'ready' | 'error'
  progress: number
  formatId: string | null
  rowCount: number
  error: string | null
  fileType: 'loga' | 'nmea' | 'vbo'
}

/** Map a file name to its import fileType (analyzer + converter gating). */
function fileTypeOf(name: string): ImportedFile['fileType'] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.nmea')) return 'nmea'
  if (lower.endsWith('.vbo')) return 'vbo'
  return 'loga'
}

export const useFileStore = defineStore('file', () => {
  const files = ref<ImportedFile[]>([])
  let nextId = 1

  // Non-reactive: prevent Vue from deeply proxying large typed arrays
  const sessions = new Map<number, LogSession>()
  const originalFiles = new Map<number, File>()

  const readyFiles = computed(() => files.value.filter((f) => f.status === 'ready'))

  const readySessions = computed<LogSession[]>(() =>
    files.value
      .filter((f) => f.status === 'ready')
      .map((f) => sessions.get(f.id))
      .filter((s): s is LogSession => s !== undefined),
  )

  /** Ready loga files paired with session + original File (for the loga writer). */
  const savableEntries = computed<
    { id: number; name: string; session: LogSession; file: File }[]
  >(() =>
    files.value
      .filter((f) => f.status === 'ready' && f.fileType === 'loga')
      .map((f) => ({
        id: f.id,
        name: f.name,
        session: sessions.get(f.id),
        file: originalFiles.get(f.id),
      }))
      .filter(
        (e): e is { id: number; name: string; session: LogSession; file: File } =>
          e.session !== undefined && e.file !== undefined,
      ),
  )

  function getSession(id: number): LogSession | undefined {
    return sessions.get(id)
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

  function removeFile(id: number): void {
    sessions.delete(id)
    originalFiles.delete(id)
    files.value = files.value.filter((f) => f.id !== id)
  }

  function clearFiles(): void {
    sessions.clear()
    originalFiles.clear()
    files.value = []
  }

  return {
    files,
    readyFiles,
    readySessions,
    savableEntries,
    getSession,
    beginImport,
    setProgress,
    completeImport,
    failImport,
    removeFile,
    clearFiles,
  }
})
