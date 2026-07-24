import type { RcnxSessionInfo } from './rcnx/parseRcnx'
import type { RczSessionInfo } from './rcz/listRczSessions'
import type { ExtractedLog } from './zip'

/** Load the RCNX SQLite inspector only after an RCNX file is selected. */
export async function inspectRcnxFile(file: File): Promise<RcnxSessionInfo[]> {
  const [{ listRcnxSessions }, { default: sqlWasmUrl }, buffer] = await Promise.all([
    import('./rcnx/parseRcnx'),
    import('sql.js/dist/sql-wasm.wasm?url'),
    file.arrayBuffer(),
  ])
  return listRcnxSessions(new Uint8Array(buffer), sqlWasmUrl)
}

/**
 * Load the RCZ backup inspector only after an `.rcz` file is selected. Returns
 * `null` for a plain single-session `.rcz` export (no picker needed — that
 * import path is unchanged); returns the nested sessions (possibly empty, for
 * a malformed backup) when the archive IS a device backup. Never inflates any
 * `channel_*` file (see `listRczSessions.ts` module doc).
 */
export async function inspectRczFile(file: File): Promise<RczSessionInfo[] | null> {
  const [{ isRczBackup, listRczSessions }, buffer] = await Promise.all([
    import('./rcz/listRczSessions'),
    file.arrayBuffer(),
  ])
  const bytes = new Uint8Array(buffer)
  if (!isRczBackup(bytes)) return null
  return listRczSessions(bytes)
}

/** Load ZIP decompression only after a ZIP export is selected. */
export async function extractZipFile(file: File): Promise<ExtractedLog[]> {
  const [{ extractLogFiles }, buffer] = await Promise.all([
    import('./zip'),
    file.arrayBuffer(),
  ])
  return extractLogFiles(new Uint8Array(buffer))
}
