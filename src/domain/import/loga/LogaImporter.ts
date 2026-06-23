import type { TextImporter } from '@/domain/import/Importer'
import { parseLoga } from '@/domain/parsing/LogaParser'
import { detectFormat } from '@/domain/parsing/HeaderDetector'

export const logaImporter: TextImporter = {
  id: 'loga',
  extensions: ['loga'],
  detect: ({ fileName, headText }) =>
    fileName.endsWith('.loga') ||
    detectFormat(headText.split(/\r?\n/, 1)[0] ?? '') !== undefined,
  parse: (text, onProgress) => parseLoga(text, onProgress),
}
