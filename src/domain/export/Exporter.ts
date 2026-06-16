import type { LogSession } from '@/domain/model/LogSession'

/**
 * Strategy interface for turning a parsed log into a downloadable text format.
 * Adding a new output format (e.g. a different RaceChrono revision or a CSV)
 * means implementing this — the rest of the app stays unchanged.
 */
export interface Exporter {
  /** Stable identifier, e.g. 'racechrono-rc3-nmea'. */
  readonly id: string
  /** Output file extension without the dot, e.g. 'nmea'. */
  readonly fileExtension: string
  /** Produce the full file content. */
  export(session: LogSession): string
}
