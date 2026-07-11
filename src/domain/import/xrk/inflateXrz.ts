import { Unzlib } from 'fflate'

/**
 * Safety cap on total inflated bytes from one `.xrz`. Real `.xrk` samples run
 * up to ~54 MB uncompressed; anything far beyond that from a small `.xrz`
 * input is almost certainly a decompression bomb that would OOM the tab. Same
 * cap and defence shape as {@link extractLogFiles} in `../zip.ts`.
 */
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024 // 512 MB

/** Compressed-input chunk size fed to the streaming inflater. */
const PUSH_CHUNK = 1024 * 1024 // 1 MB

/** True if `bytes` starts with a valid zlib (RFC 1950) header, e.g. `.xrz`. */
export function isZlibMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 2) return false
  const cmf = bytes[0]
  const flg = bytes[1]
  return (cmf & 0x0f) === 8 && (cmf * 256 + flg) % 31 === 0
}

/**
 * Inflate a `.xrz` (zlib-wrapped `.xrk`) byte buffer back into raw `.xrk`
 * bytes, per docs/specs/XRK-FORMAT-SPEC.md §7.1.
 *
 * Security: the compressed bytes are fed to the streaming inflater in small
 * chunks and the running uncompressed total is checked between chunks, same
 * shape as the zip-bomb guard in `../zip.ts`. This bounds memory for large
 * `.xrz` inputs; a small, highly-compressible one can still expand a lot
 * within a single chunk before the cap trips (zlib carries no upfront
 * declared-size field to check against, unlike zip's central directory).
 */
export function inflateXrz(bytes: Uint8Array, maxBytes: number = MAX_UNCOMPRESSED_BYTES): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  const inf = new Unzlib((chunk) => {
    total += chunk.length
    if (total > maxBytes) {
      throw new Error(
        `Refusing to inflate .xrz: uncompressed size exceeds the ` +
          `${Math.round(maxBytes / (1024 * 1024))} MB safety limit (possible decompression bomb)`,
      )
    }
    chunks.push(chunk)
  })
  for (let off = 0; off < bytes.length; off += PUSH_CHUNK) {
    const end = Math.min(off + PUSH_CHUNK, bytes.length)
    inf.push(bytes.subarray(off, end), end >= bytes.length)
  }
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.length
  }
  return out
}
