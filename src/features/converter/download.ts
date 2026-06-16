import { zipSync, strToU8 } from 'fflate'

/** Trigger a browser download for a Blob. */
function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Download a single text file (e.g. one .nmea). */
export function downloadText(name: string, content: string): void {
  downloadBlob(name, new Blob([content], { type: 'application/octet-stream' }))
}

/**
 * Download multiple files as one ZIP. Preferred for batches — sequential
 * per-file downloads get blocked/prompted by some browsers and iOS Safari.
 */
export function downloadZip(
  zipName: string,
  files: { name: string; content: string }[],
): void {
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.name] = strToU8(f.content)
  const zipped = zipSync(entries, { level: 6 })
  downloadBlob(zipName, new Blob([zipped as BlobPart], { type: 'application/zip' }))
}
