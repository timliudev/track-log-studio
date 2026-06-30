import type { BinaryImporter } from '@/domain/import/Importer'
import { parseRcnx } from './parseRcnx'

/**
 * Qstarz RCNX importer. `.rcnx` is a ZIP container (like `.rcz`), so detection
 * is by extension; the ZIP magic (`PK`) is only a sanity check. RCNX must be
 * registered ahead of any bare-ZIP matcher so `.rcnx` routes here, not to rcz.
 */
export const rcnxImporter: BinaryImporter = {
  id: 'rcnx',
  extensions: ['rcnx'],
  binary: true,
  detect: ({ fileName, headBytes }) =>
    fileName.endsWith('.rcnx') ||
    (headBytes[0] === 0x50 && headBytes[1] === 0x4b && fileName.endsWith('.rcnx')),
  parseBinary: (bytes) => parseRcnx(bytes),
}
