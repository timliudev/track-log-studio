import type { LogaFormat } from './formats/types'
import { super2Format } from './formats/super2'
import { superXFormat } from './formats/superX'
import { raceAmpFormat } from './formats/raceAmp'
import { mxAppFormat } from './formats/mxApp'

/**
 * Registry of known .loga formats. To support a new ECU header, implement a
 * LogaFormat and add it here — nothing else in the pipeline changes.
 *
 * 經測試支援的 .loga 來源 / Tested log sources:
 *   1. RC super2   — 透過 SpeedTuning 2 回讀          → super2
 *   2. RC superX   — 透過 SpeedTuningX 回讀           → superX
 *   3. aRacer X tune App — 透過分享功能輸出 log        → mxApp
 *   4. aRacer Logger 2.5 Module — 透過 Logger2 Reader 讀出 → raceAmp
 *
 * 理論上可支援但尚未實測 / Expected to work via the existing parsers but untested:
 *   1. RC super
 *   2. RC superXX
 *   3. RC mini X
 *   4. RC mini XX
 *   5. aRacer Race Module 3
 */
export const FORMATS: readonly LogaFormat[] = [
  super2Format,
  superXFormat,
  raceAmpFormat,
  mxAppFormat,
]

/** Find the first format that recognises the given first line, if any. */
export function detectFormat(firstLine: string): LogaFormat | undefined {
  return FORMATS.find((f) => f.matches(firstLine))
}
