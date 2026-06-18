/**
 * A single detected lap: a half-open span of sample indices plus its duration.
 * Laps are produced by the detectors in `@/domain/analysis/laps` and live
 * between two consecutive start/finish boundaries.
 */
export interface Lap {
  /** 0-based lap ordinal in detection order. */
  index: number
  /** Sample index where this lap starts (inclusive). */
  startIdx: number
  /** Sample index where this lap ends (exclusive end = next lap's startIdx). */
  endIdx: number
  /** Lap duration in milliseconds. */
  lapTimeMs: number
}
