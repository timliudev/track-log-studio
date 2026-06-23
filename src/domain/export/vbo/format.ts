/**
 * Number formatting helpers for the VBO writer. The padded helpers reproduce
 * C/Python printf field semantics (minimum width, never truncating a value that
 * is already wider) so the output lines up with the loga2vbo.py golden files.
 */

/** Zero-padded non-negative integer (truncates toward zero, like int()). */
export function padInt(value: number, width: number): string {
  return Math.trunc(value).toString().padStart(width, '0')
}

/**
 * printf "%0<width>.<decimals>f", optionally forcing a leading '+' on
 * non-negative values. Zero-pads between the sign and the digits; if the value
 * is already wider than `width` it is returned in full (printf min-width rule).
 */
export function padFloat(
  value: number,
  width: number,
  decimals: number,
  plus = false,
): string {
  const neg = value < 0
  const sign = neg ? '-' : plus ? '+' : ''
  let body = Math.abs(value).toFixed(decimals)
  const pad = width - sign.length - body.length
  if (pad > 0) body = '0'.repeat(pad) + body
  return sign + body
}

/**
 * VBO data-cell number format, ported from fmt_num() in loga2vbo.py: integers
 * print without a decimal point; otherwise up to 4 decimals with trailing zeros
 * (and a bare trailing dot) stripped. Non-finite values collapse to 0.
 */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Number.isInteger(v)) return String(v)
  const s = v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return s === '' || s === '-' ? '0' : s
}
