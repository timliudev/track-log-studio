import type { RcnxSessionInfo } from './rcnx/parseRcnx'
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

/** Load ZIP decompression only after a ZIP export is selected. */
export async function extractZipFile(file: File): Promise<ExtractedLog[]> {
  const [{ extractLogFiles }, buffer] = await Promise.all([
    import('./zip'),
    file.arrayBuffer(),
  ])
  return extractLogFiles(new Uint8Array(buffer))
}
