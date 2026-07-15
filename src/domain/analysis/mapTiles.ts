/**
 * Pure OSM/XYZ raster-tile math for TrackMap's tile background layer (B54
 * fix). Everything here is canvas- and network-free and unit-testable:
 * picking the OSM zoom level that matches the current on-screen scale,
 * computing which tile x/y range covers the visible viewport, an in-memory
 * LRU-ish tile cache keyed by "z/x/y", and finding a lower-resolution
 * ANCESTOR tile to use as a scaled placeholder while the exact tile is still
 * loading (so zooming never flashes to a blank background).
 *
 * Root cause of B54: the old inline code in TrackMap.vue recomputed the OSM
 * zoom level correctly on every draw(), but (a) fired a real network request
 * on EVERY wheel tick with no settle debounce — a fast zoom gesture spawns a
 * burst of concurrent requests across several zoom levels, which is both
 * wasteful and enough to trip OSM's tile-usage rate limiting — and (b) drew
 * nothing at all for a tile cell whose exact (z, x, y) wasn't cached yet
 * (rather than falling back to a coarser cached tile), so any delayed/
 * rate-limited fetch showed as a blank hole instead of a stale-but-present
 * placeholder. A persistently-failing tile also had no "give up" flag, so it
 * was silently retried on every subsequent draw() (every animation frame
 * during a pan/zoom gesture) — a retry storm that only makes the rate
 * limiting worse. This module supplies the pieces needed to fix all three:
 * a settle-aware zoom/x/y calculation, a capped cache the component can walk
 * for ancestor fallbacks, and (in TrackMap.vue) a per-tile failed flag.
 */

/** OpenStreetMap's documented valid zoom range. */
export const OSM_MIN_ZOOM = 0
export const OSM_MAX_ZOOM = 19

/** Standard XYZ raster tile edge length in px. */
export const TILE_SIZE = 256

// ── lon/lat <-> fractional tile coordinate (Web Mercator / EPSG:3857 XYZ) ──

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z
}

export function latToTileY(lat: number, z: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const r = (clamped * Math.PI) / 180
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

export function tileYToLat(y: number, z: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
}

/** Clamps a zoom level to OSM's valid integer range (default 0..19), rounding first. */
export function clampTileZoom(z: number, minZ: number = OSM_MIN_ZOOM, maxZ: number = OSM_MAX_ZOOM): number {
  if (!Number.isFinite(z)) return minZ
  return Math.max(minZ, Math.min(maxZ, Math.round(z)))
}

/**
 * Picks the OSM zoom level whose native tile resolution best matches the
 * current on-screen scale: at zoom z, one TILE_SIZE-px tile covers
 * 360 / 2^z degrees of longitude, so the natural level for a viewport of
 * `viewportPxWidth` CSS px spanning `lonSpan` degrees of longitude is the z
 * solving `viewportPxWidth / lonSpan == TILE_SIZE * 2^z / 360`. Clamped to
 * `[minZ, maxZ]` (OSM's valid range by default, or a tighter data-extent
 * bound the caller passes in). Degenerate input (non-positive span/width)
 * returns `minZ` rather than NaN/Infinity.
 */
export function selectTileZoom(
  viewportPxWidth: number,
  lonSpan: number,
  minZ: number = OSM_MIN_ZOOM,
  maxZ: number = OSM_MAX_ZOOM,
): number {
  if (!(viewportPxWidth > 0) || !(lonSpan > 0)) return minZ
  const raw = Math.log2((viewportPxWidth * 360) / (TILE_SIZE * lonSpan))
  return clampTileZoom(raw, minZ, maxZ)
}

export interface TileRange {
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * Visible tile x/y range at zoom `z` covering two opposite-corner geo points
 * (order-independent). X is left unwrapped (may be negative or >= 2^z near
 * the antimeridian — wrap with {@link wrapTileX} when reading the cache/URL);
 * Y is clamped into `[0, 2^z - 1]` since Web Mercator has no pole wraparound.
 */
export function computeTileRange(z: number, lon0: number, lat0: number, lon1: number, lat1: number): TileRange {
  const max = 2 ** z
  const xa = lonToTileX(lon0, z)
  const xb = lonToTileX(lon1, z)
  const ya = latToTileY(lat0, z)
  const yb = latToTileY(lat1, z)
  return {
    x0: Math.floor(Math.min(xa, xb)),
    x1: Math.floor(Math.max(xa, xb)),
    y0: Math.max(0, Math.floor(Math.min(ya, yb))),
    y1: Math.min(max - 1, Math.floor(Math.max(ya, yb))),
  }
}

/** Wraps a tile-x index into `[0, 2^z)` (antimeridian wraparound). */
export function wrapTileX(x: number, z: number): number {
  const max = 2 ** z
  return ((x % max) + max) % max
}

/** Stable cache/URL key for one tile of one provider ("kind"). */
export function tileKey(kind: string, z: number, x: number, y: number): string {
  return `${kind}/${z}/${x}/${y}`
}

/**
 * A small in-memory LRU cache: `set`/`get` refresh recency, and once the
 * entry count exceeds `capacity` the least-recently-used entries are evicted.
 * Generic over the stored value (an `HTMLImageElement` in TrackMap.vue;
 * plain values in tests) so it's exercisable without a real DOM/Image.
 */
export class TileLruCache<T> {
  private readonly map = new Map<string, T>()

  constructor(private readonly capacity: number) {
    if (!(capacity > 0)) throw new Error('TileLruCache capacity must be > 0')
  }

  get size(): number {
    return this.map.size
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  /** Returns the cached value, marking it most-recently-used, or undefined. */
  get(key: string): T | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  /** Inserts/updates a value as most-recently-used, evicting the oldest
   *  entries beyond `capacity`. */
  set(key: string, value: T): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}

export interface AncestorPlaceholder {
  /** The cached ancestor tile's own coordinates. */
  z: number
  x: number
  y: number
  /** Side length (px, in the ancestor image's own TILE_SIZE-px space) of the
   *  square region that covers the requested tile's footprint. */
  srcSize: number
  /** Top-left of that region within the ancestor image. */
  srcX: number
  srcY: number
}

/**
 * Walks UP the tile pyramid from `(z, x, y)` — z-1, z-2, … — looking for the
 * nearest cached ANCESTOR tile (`hasTile` returns true) that fully covers the
 * requested tile's footprint, up to `maxLevelsUp` levels. Returns the source
 * rectangle (in the ancestor's own TILE_SIZE-px image space) that should be
 * cropped and stretched to fill the requested tile's screen cell — i.e. the
 * standard "show the coarser tile scaled up while the exact one loads"
 * fallback used by most raster map viewers. Returns null if no ancestor
 * within range is cached (or `z` is already at the top).
 */
export function findAncestorPlaceholder(
  z: number,
  x: number,
  y: number,
  hasTile: (z: number, x: number, y: number) => boolean,
  maxLevelsUp = 8,
): AncestorPlaceholder | null {
  const limit = Math.min(maxLevelsUp, z - OSM_MIN_ZOOM)
  for (let d = 1; d <= limit; d++) {
    const factor = 2 ** d
    const az = z - d
    const ax = Math.floor(x / factor)
    const ay = Math.floor(y / factor)
    if (hasTile(az, ax, ay)) {
      const srcSize = TILE_SIZE / factor
      return {
        z: az,
        x: ax,
        y: ay,
        srcSize,
        srcX: (x - ax * factor) * srcSize,
        srcY: (y - ay * factor) * srcSize,
      }
    }
  }
  return null
}
