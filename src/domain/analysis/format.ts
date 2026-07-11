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

/**
 * Format a per-lap metric value (channel aggregation, built-in #/distance,
 * etc.): '—' for NaN (not computable), finer precision for small magnitudes.
 * Shared by the primary LapTable and any comparison-recording lap table so a
 * value reads identically wherever it's shown.
 */
export function formatMetricValue(v: number): string {
  if (Number.isNaN(v)) return '—'
  return Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)
}

/**
 * Format a sector/delta time (ms) as seconds: '—' for NaN, a leading sign
 * (`+`/`-`) only when `signed` (delta columns), unsigned otherwise (sector
 * columns, which are always non-negative durations).
 */
export function formatMsColumn(v: number, signed: boolean): string {
  if (Number.isNaN(v)) return '—'
  const sec = v / 1000
  const text = Math.abs(sec).toFixed(3)
  if (!signed) return text
  return sec > 0 ? `+${text}` : sec < 0 ? `-${text}` : text
}
