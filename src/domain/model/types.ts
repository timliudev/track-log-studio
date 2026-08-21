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
  /** Physical unit supplied or unambiguously defined by the source format. */
  readonly unit?: string
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
  /** Portable annotations recovered from an exported source file. */
  readonly exportMetadata?: import('@/domain/export/metadata').ExportMetadata
  /**
   * Epoch (ms) of the FIRST master-clock sample, when the importer can supply
   * one more precise than `createdDate` — currently only the `.rcz` importer
   * (`session.json`'s `firstTimestamp`, exposed as `parseRczCore.ts`'s `t0`).
   * `createdDate` for `.rcz` is the session's `timeCreated` (when RaceChrono
   * opened the session, e.g. the moment the app was launched), which can
   * differ from the first actual data sample by several seconds — see B126.
   * `VboExporter.ts` prefers this over `createdDate` for the VBO time-of-day
   * base when no `GPS_UTC_*` channel is present; `createdDate`'s own meaning
   * (the "File created on …" stamp) is unaffected.
   */
  readonly firstSampleEpochMs?: number
  /**
   * Session/session-name string recovered from the source file, when the
   * format carries one — currently only the `.vbo` importer's `[session
   * data]` `name` line (B135). Purely informational (no display wiring is
   * assumed); undefined when the source has none.
   */
  readonly sessionName?: string
  /**
   * Start/finish line recovered from the source file itself, when the format
   * carries one — currently only the `.vbo` importer's `[laptiming]` `Start`
   * line (B135, RaceChrono/`u6can`-exported VBOs). `useLaps.ts` seeds this as
   * a fallback, below any user-stored (idb-persisted) line but above the
   * generic `defaultLine()` placeholder. Undefined when the source has none.
   */
  readonly startFinishLine?: { a: { lat: number; lon: number }; b: { lat: number; lon: number } }
}
