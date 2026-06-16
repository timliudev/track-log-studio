import type { LogaFormatId } from '@/domain/model/types'

/** Result of parsing a file's header / structure (before numeric data). */
export interface HeaderParseResult {
  /** Raw column names in column order (still `Canonical/說明` form). */
  readonly rawColumns: string[]
  /** Index into the `lines` array where data rows begin. */
  readonly dataStartLine: number
  readonly createdDate: Date | null
  readonly headerInfo: Record<string, string>
}

/**
 * A pluggable .loga header format. Detection is by first line; structure
 * parsing returns where the columns and data live. Numeric parsing is shared
 * in LogaParser so every format builds the same column-store.
 */
export interface LogaFormat {
  readonly id: LogaFormatId
  /** True if this format recognises the file, based on its first line. */
  matches(firstLine: string): boolean
  /** Parse header / structure from all lines of the file. */
  parseHeader(lines: string[]): HeaderParseResult
}
