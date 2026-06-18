import type { HeaderParseResult } from './types'
import { parseCreatedDate } from '@/domain/parsing/dateParse'

/**
 * Shared header scan for marker-based aRacer logs: a "<VAR NAME>" marker is
 * immediately followed by the column-name row, and "<DATA START>" by the first
 * data row. "Created Date:" feeds the date; any other "Key:Value" line (not a
 * "<...>" marker) becomes headerInfo. Other marker sections (e.g. "<VAR ID>",
 * "<VAR GROUP>") and their value rows are ignored — they neither contain ':'
 * nor start with the next markers we look for.
 *
 * Used by both SuperX ("<aRacerX Memory Log File>") and the MX APP
 * ("<aRacer MX APP Log File>") formats, which share this exact layout.
 */
export function scanMarkerHeader(lines: string[], formatLabel: string): HeaderParseResult {
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
    throw new Error(`${formatLabel} format: missing <VAR NAME> or <DATA START> marker`)
  }

  return {
    rawColumns: (lines[nameLine] ?? '').split(','),
    namesLineIndex: nameLine,
    dataStartLine,
    createdDate,
    headerInfo,
  }
}
