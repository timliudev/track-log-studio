/** B22 map-background settings; image bytes themselves live in IndexedDB. */
export type MapBackgroundKind = 'none' | 'image' | 'osm' | 'satellite'

export interface ImageAlignment {
  x: number
  y: number
  scale: number
}

export interface MapBackgroundSettings {
  kind: MapBackgroundKind
  imageId: string | null
  alignment: ImageAlignment
  /** Mapbox token, localStorage only. Never included in exports or telemetry. */
  satelliteApiKey: string
}

export const MAX_BACKGROUND_IMAGE_BYTES = 10 * 1024 * 1024
export const BACKGROUND_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'] as const

export function defaultMapBackgroundSettings(): MapBackgroundSettings {
  return { kind: 'none', imageId: null, alignment: { x: 0, y: 0, scale: 1 }, satelliteApiKey: '' }
}

/** Reject untrusted uploads before they are decoded or stored. */
export function validateBackgroundImage(file: Pick<File, 'type' | 'size'>): string | null {
  if (!BACKGROUND_IMAGE_TYPES.includes(file.type as (typeof BACKGROUND_IMAGE_TYPES)[number])) return 'type'
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_BACKGROUND_IMAGE_BYTES) return 'size'
  return null
}

export function parseMapBackgroundSettings(raw: string | null): MapBackgroundSettings {
  if (!raw) return defaultMapBackgroundSettings()
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return defaultMapBackgroundSettings()
    const v = value as Partial<MapBackgroundSettings>
    const kind: MapBackgroundKind = ['none', 'image', 'osm', 'satellite'].includes(String(v.kind))
      ? v.kind as MapBackgroundKind
      : 'none'
    const a = v.alignment as Partial<ImageAlignment> | undefined
    const x = a?.x
    const y = a?.y
    const scale = a?.scale
    return {
      kind,
      imageId: typeof v.imageId === 'string' ? v.imageId : null,
      alignment: {
        x: Number.isFinite(x) ? x! : 0,
        y: Number.isFinite(y) ? y! : 0,
        scale: Number.isFinite(scale) ? Math.min(8, Math.max(0.1, scale!)) : 1,
      },
      satelliteApiKey: typeof v.satelliteApiKey === 'string' ? v.satelliteApiKey : '',
    }
  } catch {
    return defaultMapBackgroundSettings()
  }
}
