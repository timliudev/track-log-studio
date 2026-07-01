/**
 * Identifier for each recognised .loga header variant. This is the subset of
 * `LogMeta.formatId` values produced by .loga parsing (see LogaParser /
 * HeaderDetector); other importers may produce their own formatId strings.
 */
export type LogaFormatId = 'super2' | 'superX' | 'raceAmp' | 'mxApp' | 'nmea'

/**
 * A single named data column, stored as a typed array for memory efficiency.
 * Blank / unparseable cells are stored as NaN so consumers can distinguish
 * "no value" from a genuine 0.
 */
export interface Channel {
  /** Canonical name, e.g. 'RPM' (the part before '/'). */
  readonly name: string
  /** Original raw header, e.g. 'RPM/引擎轉速'. */
  readonly rawName: string
  /** Description part after '/', if any, e.g. '引擎轉速'. */
  readonly description: string | undefined
  /** One value per sample row. */
  readonly data: Float32Array
}

/** Header-derived metadata about a parsed log. */
export interface LogMeta {
  /**
   * Importer-specific format identifier. Widened to `string` so new importers
   * (e.g. VBO) can supply their own ids; .loga parsing produces the
   * `LogaFormatId` subset.
   */
  readonly formatId: string
  readonly createdDate: Date | null
  /** Extra header key/values (e.g. ECU SN, Hardware ID, Table ID). */
  readonly headerInfo: Readonly<Record<string, string>>
}
