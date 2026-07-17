export interface CvtTuningNote {
  readonly label: string
  readonly value: string
}

export interface ExportMetadata {
  readonly cvtNotes?: readonly CvtTuningNote[]
}

const HEADER_PREFIX = 'TLS_Metadata/'

/** Keep only meaningful, bounded strings before metadata reaches a writer. */
export function normalizeExportMetadata(metadata: ExportMetadata | null | undefined): ExportMetadata {
  const cvtNotes = (metadata?.cvtNotes ?? [])
    .map((note) => ({ label: String(note.label).slice(0, 200), value: String(note.value).slice(0, 1000) }))
    .filter((note) => note.value.trim() !== '')
    .slice(0, 50)
  return cvtNotes.length > 0 ? { cvtNotes } : {}
}

/** ASCII-safe payload suitable for NMEA, VBO comments, and CSV headers. */
export function encodeExportMetadata(metadata: ExportMetadata | null | undefined): string | null {
  const normalized = normalizeExportMetadata(metadata)
  if (!normalized.cvtNotes?.length) return null
  return encodeURIComponent(JSON.stringify({ v: 1, cvtNotes: normalized.cvtNotes }))
}

export function decodeExportMetadata(payload: string | null | undefined): ExportMetadata {
  if (!payload) return {}
  try {
    const parsed = JSON.parse(decodeURIComponent(payload)) as { v?: unknown; cvtNotes?: unknown }
    if (parsed.v !== 1 || !Array.isArray(parsed.cvtNotes)) return {}
    return normalizeExportMetadata({
      cvtNotes: parsed.cvtNotes
        .filter((note): note is { label: unknown; value: unknown } => note != null && typeof note === 'object')
        .map((note) => ({ label: String(note.label ?? ''), value: String(note.value ?? '') })),
    })
  } catch {
    return {}
  }
}

export function exportMetadataHeader(metadata: ExportMetadata | null | undefined): string | null {
  const payload = encodeExportMetadata(metadata)
  return payload ? `${HEADER_PREFIX}${payload}` : null
}

export function exportMetadataFromHeader(header: string): ExportMetadata {
  return header.startsWith(HEADER_PREFIX) ? decodeExportMetadata(header.slice(HEADER_PREFIX.length)) : {}
}
