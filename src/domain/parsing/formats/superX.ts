import type { LogaFormat, HeaderParseResult } from './types'
import { scanMarkerHeader } from './markerHeader'

const FIRST_LINE = '<aRacerX Memory Log File>'

/**
 * SuperX ("aRacerX Memory Log File"). Marker-based layout: a "<VAR NAME>"
 * marker is immediately followed by the column-name row, and "<DATA START>"
 * is immediately followed by the first data row. Mirrors load_superx().
 */
export const superXFormat: LogaFormat = {
  id: 'superX',

  matches(firstLine) {
    return firstLine.trim().startsWith(FIRST_LINE)
  },

  parseHeader(lines): HeaderParseResult {
    return scanMarkerHeader(lines, 'SuperX')
  },
}
