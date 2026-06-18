import type { GpsTrack } from '@/domain/analysis/gpsTrack'

/**
 * A reversible geo <-> canvas-pixel mapping fitted to a track. Both the track
 * renderer and the start/finish line dragging share this single source of
 * truth so the line and the polyline live in the same coordinate frame.
 */
export interface MapProjection {
  /** Geographic lat/lon (decimal degrees) -> canvas pixel (CSS px). */
  toPixel(lat: number, lon: number): { x: number; y: number }
  /** Canvas pixel (CSS px) -> geographic lat/lon (decimal degrees). */
  toGeo(px: number, py: number): { lat: number; lon: number }
}

/**
 * Fit a projection to the track's valid-fix bounds within a w x h canvas
 * (CSS px) with `pad` margin. Reproduces TrackMap.draw()'s original math: a
 * cos(latMean) longitude scaling, uniform scale to fit, centring offsets and a
 * flipped Y so north is up. Returns null when there are fewer than two valid
 * fixes (nothing to fit).
 */
export function fitProjection(
  track: GpsTrack,
  w: number,
  h: number,
  pad: number,
): MapProjection | null {
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  let count = 0
  for (let i = 0; i < track.valid.length; i++) {
    if (!track.valid[i]) continue
    count++
    if (track.lat[i] < minLat) minLat = track.lat[i]
    if (track.lat[i] > maxLat) maxLat = track.lat[i]
    if (track.lon[i] < minLon) minLon = track.lon[i]
    if (track.lon[i] > maxLon) maxLon = track.lon[i]
  }
  if (count < 2) return null

  const cosLat = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
  const spanX = Math.max((maxLon - minLon) * cosLat, 1e-9)
  const spanY = Math.max(maxLat - minLat, 1e-9)
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY)
  const offX = (w - spanX * scale) / 2
  const offY = (h - spanY * scale) / 2

  return {
    toPixel(lat: number, lon: number): { x: number; y: number } {
      return {
        x: offX + (lon - minLon) * cosLat * scale,
        y: h - (offY + (lat - minLat) * scale), // flip Y
      }
    },
    toGeo(px: number, py: number): { lat: number; lon: number } {
      return {
        lat: minLat + (h - py - offY) / scale,
        lon: minLon + (px - offX) / (cosLat * scale),
      }
    },
  }
}
