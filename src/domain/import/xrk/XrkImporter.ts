import type { BinaryImporter } from '@/domain/import/Importer'
import { parseXrk } from './parseXrk'
import { isZlibMagic } from './inflateXrz'

/**
 * AiM `.xrk` importer (Solo 2 DL / MyChron5). Detected by extension or by the
 * leading `<hCNF` config H-message magic at offset 0. Also accepts `.xrz`
 * (zlib-wrapped `.xrk`, e.g. the leading `78 9C` magic) — `parseXrk` inflates
 * it transparently before parsing.
 */
export const xrkImporter: BinaryImporter = {
  id: 'xrk',
  extensions: ['xrk', 'xrz'],
  binary: true,
  detect: ({ fileName, headBytes }) =>
    fileName.endsWith('.xrk') ||
    fileName.endsWith('.xrz') ||
    (headBytes[0] === 0x3c &&
      headBytes[1] === 0x68 &&
      headBytes[2] === 0x43 &&
      headBytes[3] === 0x4e &&
      headBytes[4] === 0x46) || // '<hCNF'
    isZlibMagic(headBytes),
  parseBinary: (bytes) => parseXrk(bytes),
}
