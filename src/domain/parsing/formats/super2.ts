import type { LogaFormat, HeaderParseResult } from './types'
import { parseCreatedDate } from '@/domain/parsing/dateParse'

const FIRST_LINE = '<Cycling Memory Log Data of Super ECU>'

/**
 * Super2 ("Cycling Memory Log Data of Super ECU"). Fixed layout:
 *   line 0: title
 *   line 1: "Creased Date:..." (note the firmware typo) or "Created Date:..."
 *   line 2..3: Ex ID / AMS Version
 *   line 4: per-column group row (Stage_/Flag)
 *   line 5: column names
 *   line 6+: data
 * Mirrors load_super2() in loga2nmea.py.
 */
export const super2Format: LogaFormat = {
  id: 'super2',

  matches(firstLine) {
    return firstLine.trim().startsWith(FIRST_LINE)
  },

  parseHeader(lines): HeaderParseResult {
    let createdDate: Date | null = null
    const headerInfo: Record<string, string> = {}

    for (const line of lines.slice(0, 5)) {
      const colon = line.indexOf(':')
      if (colon === -1) continue
      const key = line.slice(0, colon).trim()
      const value = line.slice(colon + 1).trim()
      if (key === 'Creased Date' || key === 'Created Date') {
        createdDate = parseCreatedDate(value)
      } else {
        headerInfo[key] = value
      }
    }

    return {
      rawColumns: (lines[5] ?? '').split(','),
      namesLineIndex: 5,
      dataStartLine: 6,
      createdDate,
      headerInfo,
    }
  },
}
