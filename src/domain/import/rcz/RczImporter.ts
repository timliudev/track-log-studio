import type { BinaryImporter } from '@/domain/import/Importer'
import { parseRcz } from './parseRcz'

/**
 * RaceChrono RCZ importer. `.rcz` is a ZIP container, so detection is by
 * extension; the ZIP magic (`PK`) is only a sanity check — we deliberately do
 * NOT match bare ZIP magic without the extension, since `.zip` log containers
 * and other formats are ZIPs too.
 */
export const rczImporter: BinaryImporter = {
  id: 'rcz',
  extensions: ['rcz'],
  binary: true,
  detect: ({ fileName, headBytes }) =>
    fileName.endsWith('.rcz') ||
    (headBytes[0] === 0x50 && headBytes[1] === 0x4b && fileName.endsWith('.rcz')),
  parseBinary: (bytes) => parseRcz(bytes),
}
