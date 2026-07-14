import { describe, it, expect } from 'vitest'
import { isEdgeGestureZone } from '@/domain/layout/edgeGesture'

describe('isEdgeGestureZone', () => {
  it('is true right at the left edge', () => {
    expect(isEdgeGestureZone(0, 360)).toBe(true)
  })

  it('is true right at the right edge', () => {
    expect(isEdgeGestureZone(360, 360)).toBe(true)
  })

  it('is true within the inset on either side', () => {
    expect(isEdgeGestureZone(5, 360)).toBe(true)
    expect(isEdgeGestureZone(355, 360)).toBe(true)
    expect(isEdgeGestureZone(8, 360)).toBe(true) // inclusive boundary
    expect(isEdgeGestureZone(352, 360)).toBe(true) // inclusive boundary
  })

  it('is false comfortably inside the viewport', () => {
    expect(isEdgeGestureZone(9, 360)).toBe(false)
    expect(isEdgeGestureZone(180, 360)).toBe(false)
    expect(isEdgeGestureZone(351, 360)).toBe(false)
  })

  it('honours a custom inset', () => {
    expect(isEdgeGestureZone(20, 360, 24)).toBe(true)
    expect(isEdgeGestureZone(25, 360, 24)).toBe(false)
  })

  it('is false for a non-positive viewport width or inset (defensive)', () => {
    expect(isEdgeGestureZone(0, 0)).toBe(false)
    expect(isEdgeGestureZone(0, -10)).toBe(false)
    expect(isEdgeGestureZone(0, 360, 0)).toBe(false)
    expect(isEdgeGestureZone(0, 360, -5)).toBe(false)
  })
})
