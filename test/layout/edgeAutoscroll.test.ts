import { describe, it, expect } from 'vitest'
import { DEFAULT_EDGE_AUTOSCROLL_CONFIG, edgeAutoscrollVelocity } from '@/domain/layout/edgeAutoscroll'

describe('edgeAutoscrollVelocity (B102a — edge-autoscroll ramp while dragging a card)', () => {
  it('the default config is a 64px dead-zone / 16px-per-frame top speed', () => {
    expect(DEFAULT_EDGE_AUTOSCROLL_CONFIG).toEqual({ edgePx: 64, maxVelocityPxPerFrame: 16 })
  })

  it('is 0 in the dead zone (well clear of both edges)', () => {
    expect(edgeAutoscrollVelocity(400, 0, 800)).toBe(0)
  })

  it('is 0 exactly at the dead-zone boundary (strict <, not <=, matching touchDragDelay\'s convention)', () => {
    expect(edgeAutoscrollVelocity(64, 0, 800)).toBe(0)
    expect(edgeAutoscrollVelocity(736, 0, 800)).toBe(0)
  })

  it('ramps up (negative = scroll up) just inside the top edge zone', () => {
    const v = edgeAutoscrollVelocity(63, 0, 800)
    expect(v).toBeLessThan(0)
    expect(v).toBeGreaterThan(-16)
  })

  it('ramps up (positive = scroll down) just inside the bottom edge zone', () => {
    const v = edgeAutoscrollVelocity(737, 0, 800)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThan(16)
  })

  it('hits max velocity exactly at the physical top edge', () => {
    expect(edgeAutoscrollVelocity(0, 0, 800)).toBe(-16)
  })

  it('hits max velocity exactly at the physical bottom edge', () => {
    expect(edgeAutoscrollVelocity(800, 0, 800)).toBe(16)
  })

  it('clamps to max velocity even when the pointer is dragged past the viewport edge (negative distance)', () => {
    expect(edgeAutoscrollVelocity(-50, 0, 800)).toBe(-16)
    expect(edgeAutoscrollVelocity(850, 0, 800)).toBe(16)
  })

  it('is symmetric around the midpoint for a given distance from either edge', () => {
    const top = edgeAutoscrollVelocity(20, 0, 800)
    const bottom = edgeAutoscrollVelocity(780, 0, 800)
    expect(bottom).toBeCloseTo(-top, 10)
  })

  it('honours a non-zero viewportTop (offset viewport)', () => {
    // Same 64px config, viewport now [100, 900) instead of [0, 800).
    expect(edgeAutoscrollVelocity(100, 100, 800)).toBe(-16)
    expect(edgeAutoscrollVelocity(900, 100, 800)).toBe(16)
    expect(edgeAutoscrollVelocity(500, 100, 800)).toBe(0)
  })

  it('honours a custom config', () => {
    const loose = { edgePx: 20, maxVelocityPxPerFrame: 40 }
    expect(edgeAutoscrollVelocity(30, 0, 800, loose)).toBe(0)
    expect(edgeAutoscrollVelocity(10, 0, 800, loose)).toBeLessThan(0)
    expect(edgeAutoscrollVelocity(0, 0, 800, loose)).toBe(-40)
  })

  it('resolves an overlapping dead zone (viewport shorter than 2x edgePx) to whichever edge is closer', () => {
    // viewportHeight=100, edgePx=64 -> both zones cover the whole viewport.
    // A point at y=30 is closer to the top (30) than the bottom (70).
    const v = edgeAutoscrollVelocity(30, 0, 100)
    expect(v).toBeLessThan(0)
  })

  it('breaks an exact-centre tie in an overlapping dead zone by scrolling down', () => {
    // viewportHeight=100 -> centre is y=50, equidistant (50/50) from both edges.
    const v = edgeAutoscrollVelocity(50, 0, 100)
    expect(v).toBeGreaterThan(0)
  })

  it('is 0 for a non-positive viewportHeight (defensive guard, never NaN/Infinity)', () => {
    expect(edgeAutoscrollVelocity(0, 0, 0)).toBe(0)
    expect(edgeAutoscrollVelocity(0, 0, -10)).toBe(0)
  })

  it('is 0 for a non-positive edgePx config (defensive guard)', () => {
    expect(edgeAutoscrollVelocity(0, 0, 800, { edgePx: 0, maxVelocityPxPerFrame: 16 })).toBe(0)
  })
})
