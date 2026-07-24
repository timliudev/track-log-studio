import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TOUCH_DRAG_DELAY,
  exceedsMoveThreshold,
  advanceOnMove,
  advanceOnTimeout,
  advanceOnSecondPointer,
} from '@/domain/layout/touchDragDelay'

describe('exceedsMoveThreshold', () => {
  it('is false with no movement at all', () => {
    expect(exceedsMoveThreshold(100, 100, 100, 100)).toBe(false)
  })

  it('is false for movement strictly under the default 10px threshold', () => {
    expect(exceedsMoveThreshold(100, 100, 105, 100)).toBe(false)
    expect(exceedsMoveThreshold(100, 100, 100, 109)).toBe(false)
  })

  it('is false exactly AT the threshold (strict >, not >=)', () => {
    expect(exceedsMoveThreshold(0, 0, 10, 0)).toBe(false)
  })

  it('is true just past the threshold', () => {
    expect(exceedsMoveThreshold(0, 0, 10.1, 0)).toBe(true)
  })

  it('measures straight-line (hypot) distance, not per-axis — a diagonal move can exceed the threshold even if each axis alone would not', () => {
    // dx=8, dy=8 -> hypot ≈ 11.31, over the 10px default even though neither
    // axis alone is.
    expect(exceedsMoveThreshold(0, 0, 8, 8)).toBe(true)
  })

  it('honours a custom config', () => {
    const loose = { delayMs: 300, moveThresholdPx: 50 }
    expect(exceedsMoveThreshold(0, 0, 40, 0, loose)).toBe(false)
    expect(exceedsMoveThreshold(0, 0, 60, 0, loose)).toBe(true)
  })

  it('the default config matches DESIGN.md §8 (300ms / 10px)', () => {
    expect(DEFAULT_TOUCH_DRAG_DELAY).toEqual({ delayMs: 300, moveThresholdPx: 10 })
  })
})

describe('advanceOnMove (B61 — scroll-intent cancellation while the long-press timer is pending)', () => {
  it('stays pending when movement is within the threshold', () => {
    expect(advanceOnMove('pending', 100, 100, 105, 100)).toBe('pending')
  })

  it('cancels once movement exceeds the threshold (finger is scrolling, not holding)', () => {
    expect(advanceOnMove('pending', 100, 100, 100, 150)).toBe('cancelled')
  })

  it('is a no-op once already armed — the gesture has been handed off to the grid, this state machine no longer owns subsequent movement', () => {
    expect(advanceOnMove('armed', 0, 0, 999, 999)).toBe('armed')
  })

  it('is a no-op once already cancelled — cancellation is a terminal state, it never re-arms from a move back within the threshold', () => {
    expect(advanceOnMove('cancelled', 0, 0, 0, 0)).toBe('cancelled')
  })
})

describe('advanceOnTimeout (B61 — long-press delay elapsing)', () => {
  it('arms a still-pending gesture (the hold succeeded)', () => {
    expect(advanceOnTimeout('pending')).toBe('armed')
  })

  it('does NOT resurrect an already-cancelled gesture just because the timer also happened to fire', () => {
    expect(advanceOnTimeout('cancelled')).toBe('cancelled')
  })

  it('is idempotent on an already-armed state', () => {
    expect(advanceOnTimeout('armed')).toBe('armed')
  })
})

describe('a realistic gesture sequence', () => {
  it('hold-still-then-drag: pending -> (moves under threshold) -> armed', () => {
    let state: ReturnType<typeof advanceOnMove> = 'pending'
    // Tiny jitter while holding still, well under 10px.
    state = advanceOnMove(state, 50, 50, 52, 51)
    expect(state).toBe('pending')
    // Timer elapses before any disqualifying movement.
    state = advanceOnTimeout(state)
    expect(state).toBe('armed')
  })

  it('quick-swipe-to-scroll: pending -> (moves past threshold) -> cancelled, timer firing afterwards changes nothing', () => {
    let state: ReturnType<typeof advanceOnMove> = 'pending'
    state = advanceOnMove(state, 50, 50, 50, 90) // 40px vertical swipe
    expect(state).toBe('cancelled')
    // The setTimeout callback in the real component still fires later (it
    // isn't cancelled synchronously in every code path) — must not un-cancel.
    state = advanceOnTimeout(state)
    expect(state).toBe('cancelled')
  })

  it('second-finger-during-pending: pending -> (second pointerdown) -> cancelled, timer firing afterwards changes nothing', () => {
    let state: ReturnType<typeof advanceOnMove> = 'pending'
    state = advanceOnSecondPointer(state)
    expect(state).toBe('cancelled')
    state = advanceOnTimeout(state)
    expect(state).toBe('cancelled')
  })
})

describe('advanceOnSecondPointer (B102b — a second finger touches down mid-gesture)', () => {
  it('cancels a still-pending single-finger hold (the second finger means this is not a plain long-press anymore)', () => {
    expect(advanceOnSecondPointer('pending')).toBe('cancelled')
  })

  it('is a no-op once already armed — this module has already handed off by then, see the export doc', () => {
    expect(advanceOnSecondPointer('armed')).toBe('armed')
  })

  it('is a no-op once already cancelled — terminal state', () => {
    expect(advanceOnSecondPointer('cancelled')).toBe('cancelled')
  })
})
