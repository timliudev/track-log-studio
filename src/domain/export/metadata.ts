import { normalizeSuspensionConfig, type SuspensionConfig } from '@/domain/units/suspension'

export interface CvtTuningNote {
  readonly label: string
  readonly value: string
}

export interface ExportMetadata {
  readonly cvtNotes?: readonly CvtTuningNote[]
  /** A complete, validated copy of the user's suspension calibration. */
  readonly suspensionCalibration?: SuspensionConfig
}

const HEADER_PREFIX = 'TLS_Metadata/'

/** Keep only meaningful, bounded strings before metadata reaches a writer. */
export function normalizeExportMetadata(metadata: ExportMetadata | null | undefined): ExportMetadata {
  const cvtNotes = (metadata?.cvtNotes ?? [])
    .map((note) => ({ label: String(note.label).slice(0, 200), value: String(note.value).slice(0, 1000) }))
    .filter((note) => note.value.trim() !== '')
    .slice(0, 50)
  const suspensionCalibration = normalizeSuspensionConfig(metadata?.suspensionCalibration)
  return {
    ...(cvtNotes.length > 0 ? { cvtNotes } : {}),
    ...(suspensionCalibration ? { suspensionCalibration } : {}),
  }
}

/** Add the current calibration without dropping annotations already owned by a file. */
export function withSuspensionCalibration(
  metadata: ExportMetadata | null | undefined,
  calibration: SuspensionConfig,
): ExportMetadata {
  return normalizeExportMetadata({ ...metadata, suspensionCalibration: calibration })
}

/** ASCII-safe payload suitable for NMEA, VBO comments, and CSV headers. */
export function encodeExportMetadata(metadata: ExportMetadata | null | undefined): string | null {
  const normalized = normalizeExportMetadata(metadata)
  if (!normalized.cvtNotes?.length && !normalized.suspensionCalibration) return null
  return encodeURIComponent(JSON.stringify({
    v: 1,
    ...(normalized.cvtNotes ? { cvtNotes: normalized.cvtNotes } : {}),
    ...(normalized.suspensionCalibration ? { suspensionCalibration: normalized.suspensionCalibration } : {}),
  }))
}

export function decodeExportMetadata(payload: string | null | undefined): ExportMetadata {
  if (!payload) return {}
  try {
    const parsed = JSON.parse(decodeURIComponent(payload)) as {
      v?: unknown
      cvtNotes?: unknown
      suspensionCalibration?: unknown
    }
    if (parsed.v !== 1) return {}
    return normalizeExportMetadata({
      cvtNotes: (Array.isArray(parsed.cvtNotes) ? parsed.cvtNotes : [])
        .filter((note): note is { label: unknown; value: unknown } => note != null && typeof note === 'object')
        .map((note) => ({ label: String(note.label ?? ''), value: String(note.value ?? '') })),
      suspensionCalibration: parsed.suspensionCalibration as SuspensionConfig,
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
