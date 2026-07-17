import { unzipSync, type UnzipFileInfo } from 'fflate'
import { allImportExtensions } from './formatDefinitions'

/** A log file extracted from a zip: base name plus its raw bytes. */
export interface ExtractedLog {
  name: string
  data: Uint8Array
}

/**
 * Safety cap on total uncompressed bytes pulled from one archive. Real logs are
 * tens of MB at most (the largest sample is ~54 MB); anything far beyond that is
 * almost certainly a decompression ("zip") bomb that would OOM the tab.
 */
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024 // 512 MB

/**
 * Extract the .loga / .nmea entries from a zip archive (e.g. the aRacer x Tune
 * Android app's "share" export, which wraps a single .loga). Returns an empty
 * array when the archive holds no log file.
 *
 * Security: the input is an untrusted file (a user may open a .zip shared by a
 * third party), so we defend against the standard zip attacks:
 *  - **Zip bomb / decompression bomb**: the fflate `filter` runs BEFORE each
 *    entry is inflated, so we read its declared `originalSize` and refuse the
 *    archive once the running total exceeds {@link MAX_UNCOMPRESSED_BYTES} — a
 *    tiny zip never gets to expand into gigabytes in memory.
 *  - **Zip slip / path traversal**: entry paths are reduced to their base name
 *    (`split('/').pop()`), so a crafted `../../etc/...` name can't escape. We
 *    never touch the filesystem anyway — entries become in-memory Files.
 *  - **Extension allowlist**: only entries whose extension is registered in the
 *    importer registry ({@link allImportExtensions}, e.g. `.loga` / `.nmea`) are
 *    inflated; everything else (scripts, READMEs, executables) is skipped.
 *
 * @param maxBytes total uncompressed budget; defaults to the 512 MB safety cap.
 */
export function extractLogFiles(
  bytes: Uint8Array,
  maxBytes: number = MAX_UNCOMPRESSED_BYTES,
): ExtractedLog[] {
  let totalUncompressed = 0
  const allowed = allImportExtensions().map((e) => `.${e}`)

  const filter = (file: UnzipFileInfo): boolean => {
    const lower = file.name.toLowerCase()
    if (!allowed.some((ext) => lower.endsWith(ext))) return false
    totalUncompressed += file.originalSize
    if (totalUncompressed > maxBytes) {
      throw new Error(
        `Refusing to extract zip: uncompressed size exceeds the ` +
          `${Math.round(maxBytes / (1024 * 1024))} MB safety limit (possible zip bomb)`,
      )
    }
    return true
  }

  const entries = unzipSync(bytes, { filter })
  const out: ExtractedLog[] = []
  for (const [path, data] of Object.entries(entries)) {
    out.push({ name: path.split('/').pop() || path, data })
  }
  return out
}
