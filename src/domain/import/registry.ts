import type { Importer, ImportCandidate } from './Importer'
import { logaImporter } from './loga/LogaImporter'
import { nmeaImporter } from './nmea/NmeaImporter'
import { vboImporter } from './vbo/VboImporter'
import { rczImporter } from './rcz/RczImporter'
import { rcnxImporter } from './rcnx/RcnxImporter'
import { xrkImporter } from './xrk/XrkImporter'

/** Registry of known importers. Order matters: first match wins. */
export const IMPORTERS: readonly Importer[] = [
  logaImporter,
  nmeaImporter,
  vboImporter,
  rczImporter,
  rcnxImporter,
  xrkImporter,
]

const HEAD_BYTES = 4096

/**
 * Build an ImportCandidate by reading the head of the file ONCE. The same bytes
 * are exposed both as raw `headBytes` (for binary-format magic sniffing) and as
 * UTF-8 decoded `headText` (for text-format content sniffing).
 */
export async function sniff(file: File): Promise<ImportCandidate> {
  const fileName = file.name.toLowerCase()
  const buf = await file.slice(0, HEAD_BYTES).arrayBuffer()
  const headBytes = new Uint8Array(buf)
  const headText = new TextDecoder().decode(headBytes)
  return { fileName, headText, headBytes }
}

/** Pick the first importer that recognises the candidate, or undefined. */
export function detectImporter(candidate: ImportCandidate): Importer | undefined {
  return IMPORTERS.find((imp) => imp.detect(candidate))
}

/** All accepted import extensions (without dots) across the registry. */
export function allImportExtensions(): string[] {
  return IMPORTERS.flatMap((imp) => [...imp.extensions])
}

/**
 * Extensions (without dots) registered for a single importer id, e.g.
 * `extensionsForImporter('loga')` -> `['loga']`. Lets UI copy that groups
 * formats by category (e.g. "ECU logs" vs "GPS logger formats") stay in sync
 * with the registry instead of hardcoding the extension string.
 */
export function extensionsForImporter(id: string): string[] {
  const imp = IMPORTERS.find((i) => i.id === id)
  return imp ? [...imp.extensions] : []
}
