import type { TextImporter } from '@/domain/import/Importer'
import { nmeaToSession } from '@/domain/import/nmea/nmeaToSession'

export const nmeaImporter: TextImporter = {
  id: 'nmea',
  extensions: ['nmea'],
  detect: ({ fileName, headText }) =>
    fileName.endsWith('.nmea') || /^\s*\$G[PN]RMC,/m.test(headText),
  parse: (text) => nmeaToSession(text),
}
