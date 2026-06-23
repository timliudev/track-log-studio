import type { LogSession } from '@/domain/model/LogSession'

/** What the registry inspects before committing to an importer. */
export interface ImportCandidate {
  /** Lower-cased file name, e.g. 'run01.loga'. */
  readonly fileName: string
  /** First few KB of the file decoded as text, for content sniffing. */
  readonly headText: string
  /** The same first few KB as raw bytes, for binary-format magic sniffing. */
  readonly headBytes: Uint8Array
}

export type ImportProgress = (fraction: number) => void

/** Fields common to every importer, regardless of text/binary input. */
interface BaseImporter {
  /** Stable importer id, e.g. 'loga', 'nmea', 'vbo', 'rcz'. */
  readonly id: string
  /** Accepted extensions WITHOUT the dot, e.g. ['loga']. */
  readonly extensions: readonly string[]
  /**
   * True if this importer recognises the file. Extension is a hint; sniff
   * headText / headBytes for the authoritative answer when the extension is
   * ambiguous.
   */
  detect(candidate: ImportCandidate): boolean
}

/**
 * Importer whose source is decoded text (e.g. .loga, .nmea, .vbo). The whole
 * file text is parsed into a LogSession. Must be async-capable and report
 * progress in [0,1]. Throw on unrecognised/invalid content.
 */
export interface TextImporter extends BaseImporter {
  readonly binary?: false
  parse(text: string, onProgress?: ImportProgress): LogSession | Promise<LogSession>
}

/**
 * Importer whose source is raw bytes (e.g. a zip-based .rcz). The whole file is
 * read as a Uint8Array and parsed into a LogSession. Must be async-capable and
 * report progress in [0,1]. Throw on unrecognised/invalid content.
 */
export interface BinaryImporter extends BaseImporter {
  readonly binary: true
  parseBinary(bytes: Uint8Array, onProgress?: ImportProgress): LogSession | Promise<LogSession>
}

/**
 * Strategy for turning a supported file into the internal LogSession model.
 * Either a {@link TextImporter} (decoded text input) or a {@link BinaryImporter}
 * (raw bytes input), discriminated by the `binary` flag.
 */
export type Importer = TextImporter | BinaryImporter
