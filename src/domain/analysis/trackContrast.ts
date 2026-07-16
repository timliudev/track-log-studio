import type { MapBackgroundKind } from './mapBackground'

export type Rgb = readonly [number, number, number]

export interface TrackContrastPalette {
  /** Narrow centre stroke. */
  inner: string
  /** Wider stroke painted first, visible where the centre blends in. */
  casing: string
}

export const TRACK_CONTRAST_DARK = '#111111'
export const TRACK_CONTRAST_LIGHT = '#ffffff'

function srgbToLinear(value: number): number {
  const c = Math.min(255, Math.max(0, value)) / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance in [0, 1]. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2])
}

/** Parse the CSS colour forms used by this app's theme variables. */
export function parseCssRgb(value: string): Rgb | null {
  const input = value.trim().toLowerCase()
  const short = /^#([0-9a-f]{3})$/.exec(input)
  if (short) {
    return [
      Number.parseInt(short[1][0] + short[1][0], 16),
      Number.parseInt(short[1][1] + short[1][1], 16),
      Number.parseInt(short[1][2] + short[1][2], 16),
    ]
  }
  const hex = /^#([0-9a-f]{6})$/.exec(input)
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16),
    ]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(input)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

/** Mean luminance of a small RGBA sample, alpha-composited over the actual
 * canvas background colour for uncovered parts of a positioned image. */
export function meanCompositedLuminance(pixels: ArrayLike<number>, fallback: Rgb): number | null {
  if (pixels.length < 4) return null
  let total = 0
  let count = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = Math.min(1, Math.max(0, pixels[i + 3] / 255))
    total += relativeLuminance([
      pixels[i] * alpha + fallback[0] * (1 - alpha),
      pixels[i + 1] * alpha + fallback[1] * (1 - alpha),
      pixels[i + 2] * alpha + fallback[2] * (1 - alpha),
    ])
    count++
  }
  return count > 0 ? total / count : null
}

/**
 * Pick the centre colour from the actual/safely-known background brightness.
 * OSM and satellite use provider-style priors because reading cross-origin
 * tile pixels would taint the main canvas. The opposite-colour casing is
 * always present, so mixed imagery remains visible even when its local patch
 * differs from the average/prior.
 */
export function resolveTrackContrast(
  kind: MapBackgroundKind,
  sampledLuminance: number | null,
  canvasLuminance: number,
): TrackContrastPalette {
  const luminance = kind === 'osm'
    ? 0.82
    : kind === 'satellite'
      ? 0.22
      : kind === 'image'
        ? (sampledLuminance ?? canvasLuminance)
        : canvasLuminance
  return luminance >= 0.45
    ? { inner: TRACK_CONTRAST_DARK, casing: TRACK_CONTRAST_LIGHT }
    : { inner: TRACK_CONTRAST_LIGHT, casing: TRACK_CONTRAST_DARK }
}
