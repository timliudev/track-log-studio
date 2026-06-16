import type { LogaFormat, HeaderParseResult } from './types'
import { parseCreatedDate } from '@/domain/parsing/dateParse'

const FIRST_LINE = '<aRacer ECU_Memory Log Data for RaceAMP>'

const GROUP_TOKENS = new Set(['Stage_1', 'Stage_2', 'Stage_3', 'Flag', ''])

/** A per-column group row contains only Stage_/Flag/empty tokens. */
function isGroupLine(line: string): boolean {
  const fields = line.split(',')
  if (fields.length < 2) return false
  return fields.every((f) => GROUP_TOKENS.has(f.trim()))
}

/** Parse "Key = Value ; Key = Value ; ..." into headerInfo. */
function parseKeyValueLine(line: string, into: Record<string, string>): void {
  for (const part of line.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key) into[key] = value
  }
}

/**
 * RaceAMP ("aRacer ECU_Memory Log Data for RaceAMP"). Layout:
 *   line 0: title
 *   line 1: "Created Date:..." (may use Chinese 上午/下午)
 *   line 2: "Product ID = ... ; Table ID = ... ; V.S.C.A = ... ; ..."
 *   line 3: "Serial Number = ... ; Hardware ID = ..."
 *   group row (Stage_/Flag) -> column-name row -> data
 * The group row is located by content (not a fixed index) for robustness.
 * This format was NOT handled by loga2nmea.py; it is the only one carrying
 * suspension channels (SuspensionAD1/AD2, Front/Rear Suspension).
 *
 * Note: its name row and data rows carry a trailing comma (a ragged trailing
 * empty column); trailing empties are stripped centrally in LogaParser.
 */
export const raceAmpFormat: LogaFormat = {
  id: 'raceAmp',

  matches(firstLine) {
    return firstLine.trim().startsWith(FIRST_LINE)
  },

  parseHeader(lines): HeaderParseResult {
    let createdDate: Date | null = null
    const headerInfo: Record<string, string> = {}
    let groupLine = -1

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (trimmed.startsWith('Created Date')) {
        createdDate = parseCreatedDate(line.slice(line.indexOf(':') + 1))
      } else if (trimmed.includes('=')) {
        parseKeyValueLine(line, headerInfo)
      } else if (isGroupLine(line)) {
        groupLine = i
        break
      }
    }

    if (groupLine === -1) {
      throw new Error('RaceAMP format: could not locate the column group row')
    }

    return {
      rawColumns: (lines[groupLine + 1] ?? '').split(','),
      dataStartLine: groupLine + 2,
      createdDate,
      headerInfo,
    }
  },
}
