import type { BinaryImporter } from '@/domain/import/Importer'
import { parseXrk } from './parseXrk'

/**
 * AiM `.xrk` importer (Solo 2 DL / MyChron5). Detected by extension or by the
 * leading `<hCNF` config H-message magic at offset 0.
 */
export const xrkImporter: BinaryImporter = {
  id: 'xrk',
  extensions: ['xrk'],
  binary: true,
  detect: ({ fileName, headBytes }) =>
    fileName.endsWith('.xrk') ||
    (headBytes[0] === 0x3c &&
      headBytes[1] === 0x68 &&
      headBytes[2] === 0x43 &&
      headBytes[3] === 0x4e &&
      headBytes[4] === 0x46), // '<hCNF'
  parseBinary: (bytes) => parseXrk(bytes),
}
