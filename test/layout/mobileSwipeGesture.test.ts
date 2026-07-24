import { describe, it, expect } from 'vitest'
import {
  resolveSwipeTarget,
  pendingTouchIntent,
  SWIPE_SLOP_PX,
  SWIPE_TRIGGER_PX,
} from '@/domain/layout/mobileSwipeGesture'

describe('resolveSwipeTarget', () => {
  const ids = ['map', 'chart-1', 'gear', 'laptable']

  it('advances to the NEXT id when dx is negative (finger moved left) past the trigger', () => {
    expect(resolveSwipeTarget(ids, 'chart-1', -SWIPE_TRIGGER_PX - 1)).toBe('gear')
  })

  it('goes to the PREVIOUS id when dx is positive (finger moved right) past the trigger', () => {
    expect(resolveSwipeTarget(ids, 'chart-1', SWIPE_TRIGGER_PX + 1)).toBe('map')
  })

  it('is a no-op below the trigger distance, either direction', () => {
    expect(resolveSwipeTarget(ids, 'chart-1', SWIPE_TRIGGER_PX - 1)).toBeNull()
    expect(resolveSwipeTarget(ids, 'chart-1', -(SWIPE_TRIGGER_PX - 1))).toBeNull()
    expect(resolveSwipeTarget(ids, 'chart-1', 0)).toBeNull()
  })

  it('is a no-op exactly AT the trigger (strict >, not >=)', () => {
    expect(resolveSwipeTarget(ids, 'chart-1', SWIPE_TRIGGER_PX)).toBeNull()
    expect(resolveSwipeTarget(ids, 'chart-1', -SWIPE_TRIGGER_PX)).toBeNull()
  })

  it('is a no-op swiping past the LAST tab — no wrap-around (v1)', () => {
    expect(resolveSwipeTarget(ids, 'laptable', -SWIPE_TRIGGER_PX - 1)).toBeNull()
  })

  it('is a no-op swiping past the FIRST tab — no wrap-around (v1)', () => {
    expect(resolveSwipeTarget(ids, 'map', SWIPE_TRIGGER_PX + 1)).toBeNull()
  })

  it('is a no-op when currentId is not in ids (defensive)', () => {
    expect(resolveSwipeTarget(ids, 'not-a-tab', -SWIPE_TRIGGER_PX - 1)).toBeNull()
  })

  it('is a no-op for a single-tab list in either direction', () => {
    expect(resolveSwipeTarget(['only'], 'only', -SWIPE_TRIGGER_PX - 1)).toBeNull()
    expect(resolveSwipeTarget(['only'], 'only', SWIPE_TRIGGER_PX + 1)).toBeNull()
  })

  it('honours a custom trigger threshold', () => {
    expect(resolveSwipeTarget(ids, 'chart-1', -21, 20)).toBe('gear')
    expect(resolveSwipeTarget(ids, 'chart-1', -19, 20)).toBeNull()
  })
})

describe('pendingTouchIntent (re-exported for the swipe gesture)', () => {
  it('stays pending inside the slop', () => {
    expect(pendingTouchIntent({ x: 0, y: 0 }, { x: 3, y: 3 }, SWIPE_SLOP_PX)).toBe('pending')
  })

  it('resolves to pan for dominant horizontal motion past the slop', () => {
    expect(pendingTouchIntent({ x: 0, y: 0 }, { x: 30, y: 2 }, SWIPE_SLOP_PX)).toBe('pan')
  })

  it('resolves to scroll for dominant vertical motion past the slop', () => {
    expect(pendingTouchIntent({ x: 0, y: 0 }, { x: 2, y: 30 }, SWIPE_SLOP_PX)).toBe('scroll')
  })
})
