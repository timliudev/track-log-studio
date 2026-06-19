/**
 * Pure formatters for chart axis tick labels. No state, no clock/timezone reads —
 * every input is supplied by the caller so the same input always yields the same
 * label (keeps the chart axes purely derived from the immutable session).
 */

/**
 * Format an elapsed duration as `m:ss`, or `h:mm:ss` when at least one hour.
 * Seconds are zero-padded; minutes are zero-padded only in the `h:mm:ss` form.
 * Non-finite or negative input renders as an em dash.
 * @param seconds elapsed time in seconds (rounded to whole seconds)
 */
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const ss = total % 60
  const totalMinutes = Math.floor(total / 60)
  const mm = totalMinutes % 60
  const hh = Math.floor(totalMinutes / 60)
  const pad = (v: number): string => v.toString().padStart(2, '0')
  if (total >= 3600) return `${hh}:${pad(mm)}:${pad(ss)}`
  return `${totalMinutes}:${pad(ss)}`
}

/**
 * Format a distance in metres, auto-switching to kilometres at >= 1000 m.
 * Kilometres show up to 2 decimals with trailing zeros trimmed (1500 → '1.5 km',
 * 2000 → '2 km'); metres are rounded whole (500 → '500 m'). Non-finite → em dash.
 * @param meters distance in metres
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—'
  if (Math.abs(meters) >= 1000) {
    const km = meters / 1000
    const trimmed = parseFloat(km.toFixed(2))
    return `${trimmed} km`
  }
  return `${Math.round(meters)} m`
}

/**
 * Format an absolute UTC instant as a local wall-clock `HH:mm:ss` for a given
 * timezone offset. The offset is applied by shifting the instant and then reading
 * the UTC parts — this avoids the host browser's own timezone being applied a
 * second time. Non-finite input → em dash.
 * @param absoluteUtcMs milliseconds since the Unix epoch (UTC)
 * @param offsetMinutes minutes east of UTC (e.g. UTC+8 = 480)
 */
export function formatClock(absoluteUtcMs: number, offsetMinutes: number): string {
  if (!Number.isFinite(absoluteUtcMs) || !Number.isFinite(offsetMinutes)) return '—'
  const shifted = absoluteUtcMs + offsetMinutes * 60000
  const d = new Date(shifted)
  const pad = (v: number): string => v.toString().padStart(2, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}
