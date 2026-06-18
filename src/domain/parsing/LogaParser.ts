import type { Channel } from '@/domain/model/types'
import { LogSession } from '@/domain/model/LogSession'
import { canonicalName, descriptionOf } from './canonical'
import { detectFormat } from './HeaderDetector'

/** Progress callback: receives a fraction in [0, 1]. */
export type ParseProgress = (fraction: number) => void

/** Thrown when no registered format recognises the file. */
export class UnknownLogaFormatError extends Error {
  constructor(firstLine: string) {
    super(
      `Unrecognized .loga format (first line: ${JSON.stringify(
        firstLine.slice(0, 80),
      )})`,
    )
    this.name = 'UnknownLogaFormatError'
  }
}

/**
 * Parse raw .loga text into a LogSession (column-store of Float32 channels).
 *
 * Strategy for large files (samples up to ~54 MB): a single split into lines,
 * one pass to count rows, then one pass to fill pre-allocated typed arrays —
 * no per-row object allocation. Blank/unparseable cells become NaN; ragged
 * rows (extra trailing fields) are tolerated.
 */
export function parseLoga(text: string, onProgress?: ParseProgress): LogSession {
  const lines = text.split(/\r?\n/)
  const firstLine = lines[0] ?? ''
  const format = detectFormat(firstLine)
  if (!format) throw new UnknownLogaFormatError(firstLine)

  const header = format.parseHeader(lines)

  // Drop trailing empty column names (some formats end the name row with a
  // trailing comma). Interior columns are preserved.
  const rawColumns = header.rawColumns.slice()
  while (rawColumns.length > 0 && rawColumns[rawColumns.length - 1].trim() === '') {
    rawColumns.pop()
  }
  const colCount = rawColumns.length
  if (colCount === 0) throw new Error('No columns found in .loga header')

  // Pass 1: count non-empty data rows so arrays can be pre-allocated.
  let rowCount = 0
  for (let i = header.dataStartLine; i < lines.length; i++) {
    if (lines[i].length > 0 && lines[i].trim().length > 0) rowCount++
  }

  const arrays: Float32Array[] = rawColumns.map(() => new Float32Array(rowCount))

  // Pass 2: fill.
  const span = Math.max(1, lines.length - header.dataStartLine)
  let r = 0
  for (let i = header.dataStartLine; i < lines.length; i++) {
    const line = lines[i]
    if (line.length === 0 || line.trim().length === 0) continue
    const fields = line.split(',')
    for (let c = 0; c < colCount; c++) {
      arrays[c][r] = c < fields.length ? parseField(fields[c]) : NaN
    }
    r++
    if (onProgress && (r & 0x3fff) === 0) {
      onProgress((i - header.dataStartLine) / span)
    }
  }
  onProgress?.(1)

  const channels: Channel[] = rawColumns.map((raw, c) => ({
    name: canonicalName(raw),
    rawName: raw.trim(),
    description: descriptionOf(raw),
    data: arrays[c],
  }))

  return new LogSession(channels, {
    formatId: format.id,
    createdDate: header.createdDate,
    headerInfo: header.headerInfo,
  })
}

/** Parse one CSV field to a number; '' / non-numeric → NaN. */
function parseField(s: string): number {
  if (s.length === 0) return NaN
  // Number() handles surrounding spaces and returns NaN for non-numeric input,
  // which is exactly the "missing value" sentinel we want.
  return Number(s)
}
