import type { LogaFormat } from './formats/types'
import { super2Format } from './formats/super2'
import { superXFormat } from './formats/superX'
import { raceAmpFormat } from './formats/raceAmp'

/**
 * Registry of known .loga formats. To support a new ECU header, implement a
 * LogaFormat and add it here — nothing else in the pipeline changes.
 */
export const FORMATS: readonly LogaFormat[] = [
  super2Format,
  superXFormat,
  raceAmpFormat,
]

/** Find the first format that recognises the given first line, if any. */
export function detectFormat(firstLine: string): LogaFormat | undefined {
  return FORMATS.find((f) => f.matches(firstLine))
}
