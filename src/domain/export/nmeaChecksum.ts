/**
 * NMEA 0183 checksum: XOR of every byte between '$' and '*' (exclusive),
 * rendered as two uppercase hex digits. Bodies here are ASCII.
 */
export function nmeaChecksum(body: string): string {
  let cs = 0
  for (let i = 0; i < body.length; i++) {
    cs ^= body.charCodeAt(i)
  }
  return cs.toString(16).toUpperCase().padStart(2, '0')
}

/** Wrap a sentence body as `$body*CS\r\n`. */
export function makeSentence(body: string): string {
  return `$${body}*${nmeaChecksum(body)}\r\n`
}
