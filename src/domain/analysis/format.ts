/**
 * Format a lap duration in milliseconds as `m:ss.mmm` (e.g. 92345 → "1:32.345").
 * Negative inputs are clamped to 0. Minutes are not zero-padded; seconds and
 * milliseconds are.
 */
export function formatLapTime(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const millis = total % 1000
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}
