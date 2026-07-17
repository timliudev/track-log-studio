import { LogSession } from '@/domain/model/LogSession'
import type { Channel, LogMeta } from '@/domain/model/types'
import { exportMetadataFromHeader } from '@/domain/export/metadata'

/**
 * CSV rows are held only while being visited. The parser makes one validation
 * pass before allocating Float32Arrays, then a second fill pass, which keeps a
 * large input from retaining an object for every cell alongside its arrays.
 */
export const MAX_PLAIN_CSV_CELLS = 50_000_000

export class PlainCsvParseError extends Error {
  constructor(message: string) {
    super(`CSV: ${message}`)
    this.name = 'PlainCsvParseError'
  }
}

type RowVisitor = (row: string[]) => void

function isNewline(ch: string): boolean {
  return ch === '\n' || ch === '\r'
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every((field) => field.trim() === '')
}

/** Visit RFC 4180 comma-separated rows, including quoted CR/LF and quotes. */
function visitCsvRows(text: string, visit: RowVisitor): void {
  let row: string[] = []
  let field = ''
  let quoted = false
  let afterQuote = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const finishRow = (): void => {
    row.push(field)
    visit(row)
    row = []
    field = ''
    afterQuote = false
  }

  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          quoted = false
          afterQuote = true
          i++
        }
      } else {
        field += ch
        i++
      }
      continue
    }

    if (afterQuote) {
      if (ch === ',') {
        row.push(field)
        field = ''
        afterQuote = false
        i++
      } else if (isNewline(ch)) {
        if (ch === '\r' && text[i + 1] === '\n') i++
        i++
        finishRow()
      } else {
        throw new PlainCsvParseError('unexpected character after closing quote')
      }
      continue
    }

    if (ch === '"') {
      if (field.length !== 0) throw new PlainCsvParseError('quote in an unquoted field')
      quoted = true
      i++
    } else if (ch === ',') {
      row.push(field)
      field = ''
      i++
    } else if (isNewline(ch)) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      i++
      finishRow()
    } else {
      field += ch
      i++
    }
  }

  if (quoted) throw new PlainCsvParseError('unterminated quoted field')
  // Do not manufacture an extra blank row after a final CR/LF. A final comma
  // still needs its final empty field, hence the `row.length` condition.
  if (field.length > 0 || row.length > 0 || afterQuote) finishRow()
}

interface CsvColumn {
  sourceIndex: number
  name: string
  rawName: string
}

interface CsvSchema {
  width: number
  columns: CsvColumn[]
  metadata: LogMeta['exportMetadata']
}

function parseSchema(header: readonly string[]): CsvSchema {
  const seen = new Set<string>()
  const columns: CsvColumn[] = []
  let timeCount = 0
  let metadata: LogMeta['exportMetadata'] = {}

  header.forEach((raw, sourceIndex) => {
    const trimmed = raw.trim()
    if (!trimmed) throw new PlainCsvParseError(`header column ${sourceIndex + 1} is empty`)
    const key = trimmed.toLocaleLowerCase()
    if (seen.has(key)) throw new PlainCsvParseError(`duplicate header "${trimmed}"`)
    seen.add(key)

    if (trimmed.startsWith('TLS_Metadata/')) {
      metadata = exportMetadataFromHeader(trimmed)
      return
    }

    const isTime = key === 'time' || key === 'timer'
    if (isTime) timeCount++
    columns.push({
      sourceIndex,
      name: key === 'time' ? 'Time' : key === 'timer' ? 'Timer' : trimmed,
      rawName: trimmed,
    })
  })

  if (timeCount === 0) throw new PlainCsvParseError('missing Time or Timer column')
  if (timeCount > 1) throw new PlainCsvParseError('ambiguous Time/Timer columns')
  return { width: header.length, columns, metadata }
}

function inspectCsv(text: string): { schema: CsvSchema; rowCount: number } {
  let schema: CsvSchema | null = null
  let rowCount = 0
  let cells = 0
  visitCsvRows(text, (row) => {
    if (!schema) {
      if (isBlankRow(row)) return
      schema = parseSchema(row)
      return
    }
    if (isBlankRow(row)) return
    if (row.length !== schema.width) {
      throw new PlainCsvParseError(
        `data row ${rowCount + 1} has ${row.length} cells; expected ${schema.width}`,
      )
    }
    rowCount++
    cells += row.length
    if (cells > MAX_PLAIN_CSV_CELLS) {
      throw new PlainCsvParseError(
        `refusing ${cells.toLocaleString()} cells (limit ${MAX_PLAIN_CSV_CELLS.toLocaleString()})`,
      )
    }
  })
  if (!schema) throw new PlainCsvParseError('missing header row')
  if (rowCount === 0) throw new PlainCsvParseError('no data rows')
  return { schema, rowCount }
}

function numberOrNaN(field: string): number {
  const trimmed = field.trim()
  if (trimmed === '') return NaN
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : NaN
}

/**
 * Parse a generic UTF-8 CSV log. The first nonblank row is the header, exactly
 * one Time/Timer column is required, and every other header becomes a channel.
 */
export function parsePlainCsv(text: string): LogSession {
  const { schema, rowCount } = inspectCsv(text)
  const data = schema.columns.map(() => new Float32Array(rowCount))
  let headerSeen = false
  let targetRow = 0

  visitCsvRows(text, (row) => {
    if (!headerSeen) {
      if (isBlankRow(row)) return
      headerSeen = true
      return
    }
    if (isBlankRow(row)) return
    // inspectCsv already establishes the width and full row count; retain this
    // guard so a future parser change cannot silently write a ragged row.
    if (row.length !== schema.width) throw new PlainCsvParseError('inconsistent data row width')
    schema.columns.forEach((column, index) => {
      data[index][targetRow] = numberOrNaN(row[column.sourceIndex])
    })
    targetRow++
  })
  if (targetRow !== rowCount) throw new PlainCsvParseError('data changed while parsing')

  const channels: Channel[] = schema.columns.map((column, index) => ({
    name: column.name,
    rawName: column.rawName,
    description: undefined,
    data: data[index],
  }))
  return new LogSession(channels, {
    formatId: 'csv',
    createdDate: null,
    headerInfo: {},
    exportMetadata: schema.metadata,
  })
}
