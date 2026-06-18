/**
 * Parse the "Created Date" header value across the formats seen in the wild.
 * Returns null if none of the known shapes match. Local time is assumed (the
 * logs carry no timezone); only used for display and the NMEA date field.
 *
 * Known shapes:
 *   - "2021/9/19 12:20:04"           (Super2 / RaceAMP, 24h)
 *   - "6/21/2025 5:15:07 PM"         (SuperX, 12h AM/PM)
 *   - "2025/4/20 下午 05:21:15"       (RaceAMP, Chinese AM/PM: 上午=AM 下午=PM)
 */
export function parseCreatedDate(value: string): Date | null {
  const v = value.trim()

  // 2025/4/20 [上午|下午] 05:21:15
  const zh = v.match(
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(上午|下午)\s+(\d{1,2}):(\d{2}):(\d{2})$/,
  )
  if (zh) {
    const [, y, mo, d, ampm, h, mi, s] = zh
    let hour = Number(h)
    if (ampm === '下午' && hour < 12) hour += 12
    if (ampm === '上午' && hour === 12) hour = 0
    return makeDate(+y, +mo, +d, hour, +mi, +s)
  }

  // YYYY/M/D H:M:S (24h)
  const iso = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso
    return makeDate(+y, +mo, +d, +h, +mi, +s)
  }

  // M/D/YYYY h:m:s AM|PM
  const us = v.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i,
  )
  if (us) {
    const [, mo, d, y, h, mi, s, ap] = us
    let hour = Number(h)
    const pm = ap.toUpperCase() === 'PM'
    if (pm && hour < 12) hour += 12
    if (!pm && hour === 12) hour = 0
    return makeDate(+y, +mo, +d, hour, +mi, +s)
  }

  return null
}

function makeDate(
  year: number,
  month1: number,
  day: number,
  hour: number,
  min: number,
  sec: number,
): Date {
  // month1 is 1-based.
  return new Date(year, month1 - 1, day, hour, min, sec)
}
