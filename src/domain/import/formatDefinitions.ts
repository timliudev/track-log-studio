import type { ImportCandidate } from './Importer'
import { detectFormat } from '@/domain/parsing/HeaderDetector'

/**
 * Lightweight description of a format accepted by the file picker.
 *
 * This intentionally contains recognition metadata only. Browser-side parsing
 * happens in parse.worker.ts, so merely rendering FileBar must not pull every
 * parser (or their decompression dependencies) onto the initial route.
 */
export interface ImportFormatDefinition {
  readonly id: string
  readonly extensions: readonly string[]
  detect(candidate: ImportCandidate): boolean
}

/** Registry order is significant: the first matching format wins. */
export const IMPORT_FORMATS: readonly ImportFormatDefinition[] = [
  {
    id: 'loga',
    extensions: ['loga'],
    detect: ({ fileName, headText }) =>
      fileName.endsWith('.loga') ||
      detectFormat(headText.split(/\r?\n/, 1)[0] ?? '') !== undefined,
  },
  {
    id: 'nmea',
    extensions: ['nmea'],
    detect: ({ fileName, headText }) =>
      fileName.endsWith('.nmea') || /^\s*\$G[PN]RMC,/m.test(headText),
  },
  {
    id: 'vbo',
    extensions: ['vbo'],
    detect: ({ fileName, headText }) => fileName.endsWith('.vbo') || /\[header\]/i.test(headText),
  },
  { id: 'csv', extensions: ['csv'], detect: ({ fileName }) => fileName.endsWith('.csv') },
  {
    id: 'rcz',
    extensions: ['rcz'],
    detect: ({ fileName, headBytes }) =>
      fileName.endsWith('.rcz') ||
      (headBytes[0] === 0x50 && headBytes[1] === 0x4b && fileName.endsWith('.rcz')),
  },
  {
    id: 'rcnx',
    extensions: ['rcnx'],
    detect: ({ fileName, headBytes }) =>
      fileName.endsWith('.rcnx') ||
      (headBytes[0] === 0x50 && headBytes[1] === 0x4b && fileName.endsWith('.rcnx')),
  },
  {
    id: 'xrk',
    extensions: ['xrk', 'xrz'],
    detect: ({ fileName, headBytes }) =>
      fileName.endsWith('.xrk') ||
      fileName.endsWith('.xrz') ||
      (headBytes[0] === 0x3c &&
        headBytes[1] === 0x68 &&
        headBytes[2] === 0x43 &&
        headBytes[3] === 0x4e &&
        headBytes[4] === 0x46) ||
      ((headBytes[0] & 0x0f) === 8 &&
        (headBytes[0] * 256 + headBytes[1]) % 31 === 0),
  },
]

/** Build an import candidate by reading the file head exactly once. */
export async function sniff(file: File): Promise<ImportCandidate> {
  const fileName = file.name.toLowerCase()
  const buf = await file.slice(0, 4096).arrayBuffer()
  const headBytes = new Uint8Array(buf)
  const headText = new TextDecoder().decode(headBytes)
  return { fileName, headText, headBytes }
}

/** Pick the first format that recognises a candidate. */
export function detectImporter(candidate: ImportCandidate): ImportFormatDefinition | undefined {
  return IMPORT_FORMATS.find((format) => format.detect(candidate))
}

/** Every extension accepted by the picker, without the leading dot. */
export function allImportExtensions(): string[] {
  return IMPORT_FORMATS.flatMap((format) => [...format.extensions])
}

/** Registered extensions for one importer id, without the leading dot. */
export function extensionsForImporter(id: string): string[] {
  const format = IMPORT_FORMATS.find((item) => item.id === id)
  return format ? [...format.extensions] : []
}
