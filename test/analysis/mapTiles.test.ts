import { describe, it, expect } from 'vitest'
import {
  OSM_MIN_ZOOM,
  OSM_MAX_ZOOM,
  TILE_SIZE,
  clampTileZoom,
  selectTileZoom,
  computeTileRange,
  wrapTileX,
  tileKey,
  TileLruCache,
  findAncestorPlaceholder,
  lonToTileX,
  latToTileY,
  tileXToLon,
  tileYToLat,
} from '@/domain/analysis/mapTiles'

describe('clampTileZoom', () => {
  it('clamps into [0, 19] by default', () => {
    expect(clampTileZoom(-5)).toBe(0)
    expect(clampTileZoom(25)).toBe(19)
    expect(clampTileZoom(10.4)).toBe(10)
    expect(clampTileZoom(10.6)).toBe(11)
  })

  it('honours a tighter caller-supplied range (e.g. data-extent bound)', () => {
    expect(clampTileZoom(3, 5, 12)).toBe(5)
    expect(clampTileZoom(20, 5, 12)).toBe(12)
    expect(clampTileZoom(8, 5, 12)).toBe(8)
  })

  it('falls back to minZ for non-finite input', () => {
    expect(clampTileZoom(NaN)).toBe(OSM_MIN_ZOOM)
    expect(clampTileZoom(Infinity, 2, 10)).toBe(2)
  })
})

describe('selectTileZoom', () => {
  it('increases as the viewport zooms in (lonSpan shrinks) for a fixed pixel width', () => {
    const wide = selectTileZoom(800, 0.05)
    const narrow = selectTileZoom(800, 0.05 / 8) // 8x zoom -> 3 more OSM levels
    expect(narrow).toBeGreaterThan(wide)
    expect(narrow - wide).toBe(3)
  })

  it('matches the exact log2 formula at a level that lands on an integer', () => {
    // At z, one TILE_SIZE-px tile covers 360/2^z degrees; choosing
    // viewportPxWidth == TILE_SIZE and lonSpan == 360/2^z should select z exactly.
    for (const z of [0, 5, 10, 15, 19]) {
      const lonSpan = 360 / 2 ** z
      expect(selectTileZoom(TILE_SIZE, lonSpan)).toBe(z)
    }
  })

  it('clamps to OSM_MAX_ZOOM when the computed level would exceed it', () => {
    expect(selectTileZoom(4000, 0.0000001)).toBe(OSM_MAX_ZOOM)
  })

  it('clamps to OSM_MIN_ZOOM when the computed level would go negative', () => {
    expect(selectTileZoom(10, 5000)).toBe(OSM_MIN_ZOOM)
  })

  it('respects a tighter data-extent bound passed by the caller', () => {
    expect(selectTileZoom(4000, 0.0000001, OSM_MIN_ZOOM, 12)).toBe(12)
  })

  it('returns minZ for degenerate (non-positive) width or span', () => {
    expect(selectTileZoom(0, 1)).toBe(OSM_MIN_ZOOM)
    expect(selectTileZoom(100, 0)).toBe(OSM_MIN_ZOOM)
    expect(selectTileZoom(100, -1)).toBe(OSM_MIN_ZOOM)
  })
})

describe('computeTileRange', () => {
  it('covers the full world at zoom 0 (single tile)', () => {
    // 179.9 (not exactly 180) so the antimeridian edge itself doesn't floor
    // into tile index 1 — a viewport genuinely spanning the whole world at
    // z=0 is still entirely within the single (0,0) tile.
    const r = computeTileRange(0, -179.9, -85, 179.9, 85)
    expect(r).toEqual({ x0: 0, x1: 0, y0: 0, y1: 0 })
  })

  it('is order-independent for the two corner points', () => {
    const a = computeTileRange(5, 10, 20, -10, -20)
    const b = computeTileRange(5, -10, -20, 10, 20)
    expect(a).toEqual(b)
  })

  it('clamps y into [0, 2^z - 1] at the poles (no wraparound on the Y axis)', () => {
    const r = computeTileRange(3, -10, -89, 10, 89)
    expect(r.y0).toBe(0)
    expect(r.y1).toBe(2 ** 3 - 1)
  })

  it('produces a tight single-tile range for a small viewport at high zoom', () => {
    const z = 15
    const lon = 135.001
    const lat = 35.001
    // A tiny span entirely inside one tile at z=15.
    const r = computeTileRange(z, lon, lat, lon + 0.00001, lat + 0.00001)
    expect(r.x1 - r.x0).toBeLessThanOrEqual(1)
    expect(r.y1 - r.y0).toBeLessThanOrEqual(1)
  })

  it('round-trips tile corner conversions (tileXToLon/tileYToLat invert lonToTileX/latToTileY)', () => {
    const z = 10
    const x = 123
    const y = 456
    expect(lonToTileX(tileXToLon(x, z), z)).toBeCloseTo(x, 6)
    expect(latToTileY(tileYToLat(y, z), z)).toBeCloseTo(y, 6)
  })
})

describe('wrapTileX', () => {
  it('leaves in-range indices unchanged', () => {
    expect(wrapTileX(3, 4)).toBe(3) // 2^4=16, 3 already in range
  })

  it('wraps negative and overflowing indices around the antimeridian', () => {
    const z = 4 // max = 16
    expect(wrapTileX(-1, z)).toBe(15)
    expect(wrapTileX(16, z)).toBe(0)
    expect(wrapTileX(17, z)).toBe(1)
  })
})

describe('tileKey', () => {
  it('produces a stable, distinct key per (kind, z, x, y)', () => {
    expect(tileKey('osm', 5, 1, 2)).toBe('osm/5/1/2')
    expect(tileKey('osm', 5, 1, 2)).not.toBe(tileKey('satellite', 5, 1, 2))
    expect(tileKey('osm', 5, 1, 2)).not.toBe(tileKey('osm', 6, 1, 2))
  })
})

describe('TileLruCache', () => {
  it('stores and retrieves values', () => {
    const cache = new TileLruCache<string>(3)
    cache.set('a', 'A')
    expect(cache.get('a')).toBe('A')
    expect(cache.has('a')).toBe(true)
    expect(cache.has('missing')).toBe(false)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts the least-recently-USED entry (not just least-recently-inserted) once capacity is exceeded', () => {
    const cache = new TileLruCache<string>(2)
    cache.set('a', 'A')
    cache.set('b', 'B')
    cache.get('a') // touch 'a' -> 'b' is now the oldest
    cache.set('c', 'C') // should evict 'b', not 'a'
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('c')).toBe(true)
    expect(cache.size).toBe(2)
  })

  it('re-inserting an existing key updates it without growing size or eviction order weirdness', () => {
    const cache = new TileLruCache<number>(2)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(2)
  })

  it('never exceeds capacity across many insertions', () => {
    const cache = new TileLruCache<number>(5)
    for (let i = 0; i < 100; i++) cache.set(`k${i}`, i)
    expect(cache.size).toBe(5)
    // The most recent 5 keys should all still be present.
    for (let i = 95; i < 100; i++) expect(cache.has(`k${i}`)).toBe(true)
  })

  it('delete and clear remove entries', () => {
    const cache = new TileLruCache<number>(3)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.delete('a')
    expect(cache.has('a')).toBe(false)
    expect(cache.size).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
  })

  it('throws for a non-positive capacity', () => {
    expect(() => new TileLruCache(0)).toThrow()
    expect(() => new TileLruCache(-1)).toThrow()
  })
})

describe('findAncestorPlaceholder', () => {
  it('returns null when no ancestor is cached', () => {
    expect(findAncestorPlaceholder(10, 5, 5, () => false)).toBeNull()
  })

  it('finds the nearest cached ancestor one level up and computes the correct source crop', () => {
    // Requested tile (10, 5, 5); its parent at z=9 is (2, 2) (5 >> 1 = 2).
    // Within that parent, tile (5,5) is the [1,1] quadrant (5 - 2*2 = 1).
    const cached = new Set(['9/2/2'])
    const hit = findAncestorPlaceholder(10, 5, 5, (z, x, y) => cached.has(`${z}/${x}/${y}`))
    expect(hit).toEqual({ z: 9, x: 2, y: 2, srcSize: TILE_SIZE / 2, srcX: TILE_SIZE / 2, srcY: TILE_SIZE / 2 })
  })

  it('prefers the CLOSEST ancestor (least zoomed-out) when multiple levels are cached', () => {
    const cached = new Set(['9/2/2', '5/0/0'])
    const hit = findAncestorPlaceholder(10, 5, 5, (z, x, y) => cached.has(`${z}/${x}/${y}`))
    expect(hit?.z).toBe(9)
  })

  it('walks further up when the immediate parent is not cached', () => {
    // Grandparent at z=8 is (5>>2, 5>>2) = (1, 1).
    const cached = new Set(['8/1/1'])
    const hit = findAncestorPlaceholder(10, 5, 5, (z, x, y) => cached.has(`${z}/${x}/${y}`))
    expect(hit).toEqual({ z: 8, x: 1, y: 1, srcSize: TILE_SIZE / 4, srcX: TILE_SIZE / 4, srcY: TILE_SIZE / 4 })
  })

  it('respects maxLevelsUp and stops searching beyond it', () => {
    const cached = new Set(['0/0/0'])
    // Requested (10, 5, 5); only ancestor cached is all the way at z=0, 10 levels up.
    expect(findAncestorPlaceholder(10, 5, 5, (z, x, y) => cached.has(`${z}/${x}/${y}`), 5)).toBeNull()
    expect(findAncestorPlaceholder(10, 5, 5, (z, x, y) => cached.has(`${z}/${x}/${y}`), 10)).toEqual({
      z: 0,
      x: 0,
      y: 0,
      srcSize: TILE_SIZE / 2 ** 10,
      srcX: 5 * (TILE_SIZE / 2 ** 10),
      srcY: 5 * (TILE_SIZE / 2 ** 10),
    })
  })

  it('never searches below OSM_MIN_ZOOM even with a huge maxLevelsUp', () => {
    const calls: number[] = []
    findAncestorPlaceholder(3, 1, 1, (z) => {
      calls.push(z)
      return false
    }, 100)
    expect(Math.min(...calls)).toBeGreaterThanOrEqual(OSM_MIN_ZOOM)
    expect(calls.length).toBe(3) // z=2,1,0 only
  })
})
