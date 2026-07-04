import type { LogSession } from '@/domain/model/LogSession'
import { Rc3NmeaExporter } from './rc3Nmea/Rc3NmeaExporter'
import { LEGACY_PY_MAPPING, type Rc3Mapping } from './rc3Nmea/mapping'
import { convertToVbo } from './vbo/VboExporter'
import { convertToCsv } from './csv/CsvExporter'

/** One output file produced by an ExportFormat. */
export interface ExportArtifact {
  /** Filename suffix appended to the source stem, e.g. '' or '_ct'. */
  readonly suffix: string
  /** Output file extension without the dot, e.g. 'nmea' or 'vbo'. */
  readonly ext: string
  readonly content: string
}

/** Format-specific options threaded through to the underlying exporter. */
export interface ExportOptions {
  /** RC3 slot mapping; only consulted by the NMEA/RC3 format. */
  readonly mapping?: Rc3Mapping
  /** Clock anchor for synthesized timestamps; defaults to `new Date()`. */
  readonly now?: Date
}

/**
 * Strategy for turning any loaded {@link LogSession} into one or more
 * downloadable files — the export-side counterpart of `domain/import/Importer`.
 * A single normalized session (named channels + GPS via `makeFixResolver`) is
 * the only required input, so any imported source (loga/nmea/vbo/rcz/xrk/rcnx)
 * can produce any registered output format.
 *
 * Deliberately excludes the .loga "save modified" flow (`LogaWriter.patchLogaText`):
 * that patches the ORIGINAL loga text in place and only makes sense for a loga
 * source, so it stays a separate, loga-only code path.
 */
export interface ExportFormat {
  /** Stable identifier, e.g. 'nmea' or 'vbo'. */
  readonly id: string
  /** Output file extension without the dot, used as the default artifact ext. */
  readonly fileExtension: string
  /** Produce one or more artifacts from a session. `sourceName` is the
   * original file name, used for the stem and any embedded attribution. */
  exportSession(session: LogSession, sourceName: string, options?: ExportOptions): ExportArtifact[]
}

const rc3Exporter = new Rc3NmeaExporter()

const nmeaFormat: ExportFormat = {
  id: 'nmea',
  fileExtension: 'nmea',
  exportSession(session, _sourceName, options) {
    const content = rc3Exporter.export(session, options?.mapping ?? LEGACY_PY_MAPPING, options?.now)
    return [{ suffix: '', ext: 'nmea', content }]
  },
}

const vboFormat: ExportFormat = {
  id: 'vbo',
  fileExtension: 'vbo',
  exportSession(session, sourceName, options) {
    return convertToVbo(session, sourceName, options?.now).map((a) => ({
      suffix: a.suffix,
      ext: a.ext,
      content: a.content,
    }))
  },
}

const csvFormat: ExportFormat = {
  id: 'csv',
  fileExtension: 'csv',
  exportSession(session) {
    return convertToCsv(session).map((a) => ({
      suffix: a.suffix,
      ext: a.ext,
      content: a.content,
    }))
  },
}

/** Registry of known export formats. */
export const EXPORT_FORMATS: readonly ExportFormat[] = [nmeaFormat, vboFormat, csvFormat]

/** Look up a registered export format by id, or undefined if unknown. */
export function getExportFormat(id: string): ExportFormat | undefined {
  return EXPORT_FORMATS.find((f) => f.id === id)
}
