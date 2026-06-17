import type { LogaFormat, HeaderParseResult } from './types'
import { parseCreatedDate } from '@/domain/parsing/dateParse'

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
    let createdDate: Date | null = null
    let nameLine = -1
    let dataStartLine = -1
    const headerInfo: Record<string, string> = {}

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (trimmed === '<VAR NAME>') {
        nameLine = i + 1
      } else if (trimmed === '<DATA START>') {
        dataStartLine = i + 1
        break // everything below is data
      } else if (trimmed.startsWith('Created Date')) {
        createdDate = parseCreatedDate(line.slice(line.indexOf(':') + 1))
      } else if (trimmed.includes(':') && !trimmed.startsWith('<')) {
        const colon = line.indexOf(':')
        headerInfo[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
      }
    }

    if (nameLine === -1 || dataStartLine === -1) {
      throw new Error('SuperX format: missing <VAR NAME> or <DATA START> marker')
    }

    return {
      rawColumns: (lines[nameLine] ?? '').split(','),
      namesLineIndex: nameLine,
      dataStartLine,
      createdDate,
      headerInfo,
    }
  },
}
